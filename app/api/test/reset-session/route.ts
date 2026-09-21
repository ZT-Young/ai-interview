import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  answers,
  interviewMessages,
  interviewSessions,
  questions,
  reports,
} from '@/db/schema'
import { notFound, unauthorized } from '@/lib/api/errors'
import { apiHandler, ok } from '@/lib/api/respond'

/**
 * POST /api/test/reset-session —— **仅用于 E2E** 把一个会话重置回
 * 「计划已生成、尚未开始」（status=planned, phase=READY, 无答题、无消息）。
 *
 * 为什么需要它：面试房间的多个用例会推进**同一个**会话的状态机
 * （答一题、跳过、结束面试）。若每个用例都从头跑「解析简历 → 匹配 → 出题」，
 * 会依赖真实 S3/LLM 且极慢；若共用会话状态，用例之间就会互相污染
 * （先跑的用例结束了面试，后面的用例再点「请求提示」必然超时）。
 * 因此提供一个显式重置入口，让每个用例都从确定状态开始。
 *
 * 三重保护：
 * 1. **生产环境一律 404**（`NODE_ENV === 'production'` 时该入口不存在）
 * 2. 必须配置 `E2E_RESET_TOKEN`，否则 404（未配置 = 功能关闭）
 * 3. 必须带 `x-e2e-reset-token` 且与配置一致（定长时间比较），否则 401
 *
 * 它不绕过任何业务规则：只清理**该会话自己**的答题与消息，并把阶段复位，
 * 不触碰金额、权益或他人数据。
 */
export const POST = apiHandler(async (request: Request) => {
  if (process.env.NODE_ENV === 'production') throw notFound()

  const expected = process.env.E2E_RESET_TOKEN
  if (!expected) throw notFound()

  const provided = request.headers.get('x-e2e-reset-token') ?? ''
  if (!timingSafeEqual(provided, expected)) throw unauthorized('E2E 重置密钥不正确')

  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown
    cleanupCreatedAfter?: unknown
    /** 只清理 draft 会话，**不重置**目标会话状态（历史记录类用例需要） */
    cleanupOnly?: unknown
  } | null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null
  if (!sessionId) throw notFound()

  const cleanupOnly = body?.cleanupOnly === true

  const db = getDb()
  const sessionRows = await db
    .select({ id: interviewSessions.id, userId: interviewSessions.userId })
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sessionId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) throw notFound('会话不存在')

  /**
   * 清理该账号在指定时间之后新建的**其它无报告会话**（软删除）。
   *
   * 为什么需要：E2E 的「再次训练」用例每次都会新建一个会话，且从不清理。
   * 这些 draft 会话会不断堆积，最终把真正的报告会话挤出 `/sessions` 的
   * 首页（分页上限 50 条），导致「从历史记录进入旧报告」用例找不到入口——
   * 实测就因此失败过，且现象看起来像 seed 数据损坏，实际只是列表翻页。
   *
   * ⚠️ 为什么是**软删除**而不是 `DELETE`：
   * `payments.report_id` 对 `interview_sessions` 是 `ON DELETE SET NULL`，
   * 而表上有 CHECK `payments_report_required_for_report_unlock`
   * （unlock_type='report' 时 report_id 必须非空）。硬删会话会触发
   * `SET NULL` → 违反 CHECK → 整个删除失败（实测报 23514）。
   * 置 `deletedAt` 既能把这些会话从列表移除（`ownedByActive` 会过滤），
   * 又不动支付与报告数据。
   *
   * 另外只清理**没有报告**的会话：报告是 seed 用例的依赖，不能误删。
   */
  let cleaned = 0
  if (typeof body?.cleanupCreatedAfter === 'string') {
    const threshold = new Date(body.cleanupCreatedAfter)
    if (!Number.isNaN(threshold.getTime())) {
      const reportSessionIds = await db
        .select({ sessionId: reports.sessionId })
        .from(reports)
        .where(eq(reports.userId, session.userId))
      const keep = new Set(reportSessionIds.map((row) => row.sessionId))

      const candidates = await db
        .select({ id: interviewSessions.id })
        .from(interviewSessions)
        .where(
          and(
            eq(interviewSessions.userId, session.userId),
            ne(interviewSessions.id, sessionId),
            gte(interviewSessions.createdAt, threshold),
            isNull(interviewSessions.deletedAt),
          ),
        )

      const toRemove = candidates.map((row) => row.id).filter((id) => !keep.has(id))
      if (toRemove.length > 0) {
        const updated = await db
          .update(interviewSessions)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(inArray(interviewSessions.id, toRemove))
          .returning({ id: interviewSessions.id })
        cleaned = updated.length
      }
    }
  }

  /**
   * ⚠️ `cleanupOnly` 时**必须跳过重置**。
   *
   * 历史记录类用例调用本接口只是为了清理 draft 会话，它们依赖的「报告会话」
   * 必须保持 `status='completed'`（列表只在 completed 时渲染「查看报告」入口）。
   * 早期实现只要带了 `cleanupCreatedAfter` 就顺带重置状态，把报告会话改成了
   * `planned/READY`，于是在「从历史记录进入旧报告」用例里找不到入口而失败——
   * 现象看起来像 seed 数据损坏，实际是本接口把一个「清理」调用做成了「重置」调用。
   */
  if (!cleanupOnly) {
    await db.transaction(async (tx) => {
      // 该会话下的全部题目 id（含追问），用于精确清理答题与评分
      const questionRows = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.sessionId, sessionId))

      for (const row of questionRows) {
        await tx.delete(answers).where(eq(answers.questionId, row.id))
      }

      await tx.delete(interviewMessages).where(eq(interviewMessages.sessionId, sessionId))

      await tx
        .update(interviewSessions)
        .set({
          status: 'planned',
          phase: 'READY',
          currentQuestionId: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(interviewSessions.id, sessionId))
    })
  }

  return ok({ reset: true, sessionId, cleanedSessions: cleaned })
})

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return diff === 0
}

export const dynamic = 'force-dynamic'
