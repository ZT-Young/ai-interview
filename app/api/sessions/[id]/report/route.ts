import { requireUser } from '@/lib/api/guard'
import { serviceUnavailable, upstreamError } from '@/lib/api/errors'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { listEvaluations } from '@/lib/services/handlers/evaluation-service'
import { generateReport, getReportBySession } from '@/lib/services/handlers/report-service'

import {
  reportBodySchema,
  resolveEvaluationPorts,
  type SessionRouteContext,
} from '../_evaluation-shared'

/**
 * GET /api/sessions/:id/report —— 读取报告。
 *
 * 未解锁时，付费字段的内容**不会出现在响应中**（只返回 `lockedSections` 字段名），
 * 避免把付费内容一并发给前端。
 */
export const GET = apiHandler(async (_request: Request, context: SessionRouteContext) => {
  const user = await requireUser()
  const { report, isUnlocked, lockedSections, matchScore, baseSuggestions } =
    await getReportBySession(user.id, context.params.id)

  const evaluations = isUnlocked ? await listEvaluations(user.id, context.params.id) : []

  return ok({ report, isUnlocked, lockedSections, matchScore, baseSuggestions, evaluations })
})

/**
 * POST /api/sessions/:id/report —— 生成报告。
 *
 * 前置：已有逐题评分（分数由服务端从 evaluations 聚合，保证可回溯）。
 * 幂等：已有报告需显式 `regenerate: true`。
 * 成功后编排阶段推进到 REPORTING。
 */
export const POST = apiHandler(async (request: Request, context: SessionRouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, reportBodySchema)

  const result = await generateReport(user.id, context.params.id, resolveEvaluationPorts(), {
    regenerate: input.regenerate,
  })

  if (!result.ok) {
    if (result.code === 'ai_unavailable') throw serviceUnavailable(result.message)
    throw upstreamError(result.message, { violations: result.violations })
  }

  return ok({ report: result.report, attempts: result.attempts, dropped: result.dropped })
})

export const dynamic = 'force-dynamic'
