import { and, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { answers, evaluations, interviewSessions, questions } from '@/db/schema'
import { ownedByActive } from '@/lib/api/ownership'
import { notFound, serviceUnavailable, upstreamError } from '@/lib/api/errors'
import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { evaluateAnswer } from '@/lib/services/evaluation-service'

import {
  evaluateBodySchema,
  resolveEvaluationPorts,
  type SessionRouteContext,
} from '../_evaluation-shared'

/**
 * POST /api/sessions/:id/evaluate —— 逐题评分。
 *
 * - 指定 `questionId` 时只评该题
 * - 不指定时对**全部已作答但未评分**的题目逐题评分（部分失败会如实回报）
 * - 幂等：已评分的题需 `regenerate: true` 才会重评
 *
 * 分数由服务端按公式计算；证据必须是回答原文子串，否则该条被剔除（见 docs/AI_PROMPTS.md §6.4）。
 */
export const POST = apiHandler(async (request: Request, context: SessionRouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, evaluateBodySchema)
  const sessionId = context.params.id
  const db = getDb()

  // 归属校验
  const sessionRows = await db
    .select({ id: interviewSessions.id })
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, user.id))
    .limit(1)

  if (!sessionRows[0]) throw notFound('面试会话不存在')

  const ports = resolveEvaluationPorts()

  // 指定单题：失败时返回统一错误结构（502，可重试）
  if (input.questionId) {
    const result = await evaluateAnswer(user.id, sessionId, input.questionId, ports, {
      regenerate: input.regenerate,
    })
    if (!result.ok) {
      if (result.code === 'ai_unavailable') throw serviceUnavailable(result.message)
      throw upstreamError(result.message, { attempts: result.attempts })
    }
    return ok({
      evaluated: 1,
      attempts: result.attempts,
      droppedQuotes: result.droppedQuotes,
      evaluation: result.evaluation,
    })
  }

  // 批量：已作答但未评分的题
  const pending = await db
    .select({ questionId: answers.questionId })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .leftJoin(evaluations, eq(evaluations.questionId, answers.questionId))
    .where(and(eq(questions.sessionId, sessionId), eq(answers.userId, user.id), isNull(evaluations.id)))

  const results: Array<{ questionId: string; ok: boolean; message?: string; attempts?: number }> = []

  for (const row of pending) {
    const result = await evaluateAnswer(user.id, sessionId, row.questionId, ports, {
      regenerate: input.regenerate,
    })
    results.push(
      result.ok
        ? { questionId: row.questionId, ok: true, attempts: result.attempts }
        : { questionId: row.questionId, ok: false, message: result.message, attempts: result.attempts },
    )
  }

  // 批量：返回逐题结果明细，部分失败如实回报（前端可重试失败的题）
  return ok({
    evaluated: results.filter((item) => item.ok).length,
    total: results.length,
    failed: results.filter((item) => !item.ok).length,
    results,
  })
})

export const dynamic = 'force-dynamic'
