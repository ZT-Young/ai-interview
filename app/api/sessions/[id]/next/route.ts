import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { getNextQuestion } from '@/lib/services/handlers/orchestration-service'

import type { SessionRouteContext } from '../_shared'

/**
 * GET /api/sessions/:id/next —— 获取下一题。
 *
 * 用于页面刷新后恢复进度：优先返回尚未回答的主问题；
 * 若全部答完则返回 `finished: true` 并把会话置为 FINISHED。
 */
export const GET = apiHandler(async (_request: Request, context: SessionRouteContext) => {
  const user = await requireUser()
  const step = await getNextQuestion(user.id, context.params.id)
  return ok(step)
})

export const dynamic = 'force-dynamic'
