import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { startInterview } from '@/lib/services/handlers/orchestration-service'

import type { SessionRouteContext } from '../_shared'

/**
 * POST /api/sessions/:id/start —— 开始面试。
 *
 * 前置：会话已有面试计划（questions 非空）。
 * 效果：status planned → in_progress，phase → READY → 抛出第一题。
 * 本路由不调用 LLM，因此无需端口注入。
 */
export const POST = apiHandler(async (_request: Request, context: SessionRouteContext) => {
  const user = await requireUser()
  const step = await startInterview(user.id, context.params.id)
  return ok(step)
})

export const dynamic = 'force-dynamic'
