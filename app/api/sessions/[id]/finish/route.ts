import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { finishInterview } from '@/lib/services/orchestration-service'

import type { SessionRouteContext } from '../_shared'

/**
 * POST /api/sessions/:id/finish —— 结束面试。
 *
 * 效果：phase → FINISHED，status → completed，写入 finished_at。
 * 报告生成（REPORTING）属于后续阶段，本路由不产出报告。
 */
export const POST = apiHandler(async (_request: Request, context: SessionRouteContext) => {
  const user = await requireUser()
  const result = await finishInterview(user.id, context.params.id)
  return ok(result)
})

export const dynamic = 'force-dynamic'
