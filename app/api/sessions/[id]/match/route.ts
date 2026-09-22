import { eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { interviewSessions, jobJds, resumes } from '@/db/schema'
import { notFound, serviceUnavailable, upstreamError, validationError } from '@/lib/api/errors'
import { requireUser } from '@/lib/api/guard'
import { ownedByActive } from '@/lib/api/ownership'
import { apiHandler, ok } from '@/lib/api/respond'
import type { JdData, ResumeData } from '@/lib/ai/schemas/parse'
import type { LlmPort } from '@/lib/parsing/llm-port'
import { OpenAiCompatibleLlm } from '@/lib/parsing/llm-port'
import { matchResumeToJd } from '@/lib/services/handlers/match-service'

interface RouteContext {
  params: { id: string }
}

/**
 * ⚠️ **路由文件只能导出 HTTP 处理函数**（见同目录 plan/route.ts 的说明）。
 * 这里曾导出 `__setMatchPortsForTest`，会让 Next 生成的路由类型校验失败
 * （`pnpm typecheck` / `pnpm build` 报 `OmitWithTag` 不兼容），且该导出无人使用。
 */

/**
 * POST /api/sessions/:id/match —— 生成简历与 JD 的匹配分析。
 *
 * 出题（计划生成）需要 `match_analysis` 作为输入，因此这是生成计划的前置步骤。
 * 结果写入 `interview_sessions.match_analysis`。
 */
export const POST = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const db = getDb()

  const sessionRows = await db
    .select()
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, context.params.id, user.id))
    .limit(1)

  const session = sessionRows[0]
  // 归属校验：他人会话一律 404，不泄露资源是否存在
  if (!session) throw notFound('面试会话不存在')

  if (!session.resumeId || !session.jobJdId) {
    throw validationError('生成匹配分析需要同时关联简历与岗位 JD')
  }

  const resumeRows = await db.select().from(resumes).where(eq(resumes.id, session.resumeId)).limit(1)
  const jdRows = await db.select().from(jobJds).where(eq(jobJds.id, session.jobJdId)).limit(1)
  const resume = resumeRows[0]
  const jobJd = jdRows[0]

  if (!resume || resume.parseStatus !== 'success' || !resume.parsedData) {
    throw validationError('简历尚未解析成功，请先确认解析结果')
  }
  if (!jobJd || jobJd.parseStatus !== 'success' || !jobJd.parsedData) {
    throw validationError('岗位 JD 尚未解析成功，请先确认解析结果')
  }

  // matchResumeToJd 只依赖 LLM 端口，不触碰对象存储
  const parsed = await matchResumeToJd(
    { llm: new OpenAiCompatibleLlm() },
    {
      jd: jobJd.parsedData as JdData,
      resume: resume.parsedData as ResumeData,
    },
  )

  if (!parsed.ok) {
    if (parsed.code === 'ai_unavailable') {
      throw serviceUnavailable(parsed.error.userMessage)
    }
    throw upstreamError(parsed.error.userMessage)
  }

  await db
    .update(interviewSessions)
    .set({ matchAnalysis: parsed.data, updatedAt: new Date() })
    .where(ownedByActive(interviewSessions, session.id, user.id))

  return ok({ sessionId: session.id, matchAnalysis: parsed.data, model: parsed.model })
})

export const dynamic = 'force-dynamic'
