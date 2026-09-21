import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { validationError } from '@/lib/api/errors'
import {
  deleteSession,
  getSession,
  transitionSession,
  updateSession,
} from '@/lib/services/session-service'
import { SESSION_STATUSES, type SessionStatus } from '@/lib/services/session-state'
import { updateSessionSchema } from '@/lib/validators/session'

interface RouteContext {
  params: { id: string }
}

/** GET /api/sessions/:id */
export const GET = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const session = await getSession(user.id, context.params.id)
  return ok({ session })
})

/** PATCH /api/sessions/:id —— 更新简历/JD 关联或面试配置 */
export const PATCH = apiHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, updateSessionSchema)
  const session = await updateSession(user.id, context.params.id, input)
  return ok({ session })
})

/**
 * DELETE /api/sessions/:id?status=in_progress
 * 带 status 参数时执行状态迁移（非法迁移返回 422）；不带则软删除。
 */
export const DELETE = apiHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser()
  const url = new URL(request.url)
  const next = url.searchParams.get('status')

  if (next) {
    if (!SESSION_STATUSES.includes(next as SessionStatus)) {
      throw validationError(`未知状态：${next}`, { allowed: SESSION_STATUSES })
    }
    const session = await transitionSession(user.id, context.params.id, next as SessionStatus)
    return ok({ session })
  }

  await deleteSession(user.id, context.params.id)
  return ok({ success: true })
})

export const dynamic = 'force-dynamic'
