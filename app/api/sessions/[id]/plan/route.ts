import { z } from 'zod'

import { requireUser } from '@/lib/api/guard'
import { serviceUnavailable, upstreamError } from '@/lib/api/errors'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import {
  createDefaultPlanPorts,
  generatePlan,
  getSessionPlan,
} from '@/lib/services/plan-service'

interface RouteContext {
  params: { id: string }
}

/**
 * ⚠️ **路由文件只能导出 HTTP 处理函数**（GET/POST/… 与 `dynamic` 等配置）。
 *
 * 这里曾经导出 `__setPlanPortsForTest` 供测试注入端口，Next.js 生成的路由类型
 * （`.next/types/app/api/.../route.ts` 里的 `OmitWithTag<typeof import(...)>`）
 * 会把「多余的导出」判为类型错误，**导致 `pnpm build` / `pnpm typecheck` 失败**。
 * 而且那个导出实际无人使用（测试都是直接调用 service 并传入端口），
 * 因此直接删除；需要注入时应在 service 层暴露注入点。
 */

/**
 * GET /api/sessions/:id/plan —— 获取面试计划。
 * 归属校验在 getSessionPlan 内完成（他人会话返回 404）。
 */
export const GET = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const plan = await getSessionPlan(user.id, context.params.id)
  return ok(plan)
})

const generateBodySchema = z.object({
  /** 已有题目时需显式传 true 才覆盖，避免误删用户已答题 */
  regenerate: z.boolean().optional().default(false),
  config: z
    .object({
      maxQuestions: z.number().int().min(8).max(12).optional(),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    })
    .optional(),
})

/**
 * POST /api/sessions/:id/plan —— 生成面试计划。
 *
 * - 成功 200
 * - LLM 未配置/不可用 → 503
 * - 生成结果不满足配额或合规要求 → 502（重试一次后仍不达标）
 */
export const POST = apiHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, generateBodySchema)

  const result = await generatePlan(user.id, context.params.id, createDefaultPlanPorts(), {
    regenerate: input.regenerate,
    config: input.config,
  })

  if (!result.ok) {
    if (result.code === 'ai_unavailable') {
      throw serviceUnavailable(result.error.userMessage)
    }
    throw upstreamError(result.error.userMessage, { violations: result.violations })
  }

  return ok({
    sessionId: result.sessionId,
    total: result.total,
    quota: result.quota,
    plan: result.plan,
    questions: result.questions,
    model: result.model,
    attempts: result.attempts,
  })
})

export const dynamic = 'force-dynamic'
