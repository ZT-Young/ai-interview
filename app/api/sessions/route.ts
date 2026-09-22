import { apiHandler, created, ok, parseJsonBody, parsePagination } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { createSession, listSessions } from '@/lib/services/handlers/session-service'
import { createSessionSchema } from '@/lib/validators/session'

/** GET /api/sessions —— 仅列出当前用户的面试会话（历史记录） */
export const GET = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const url = new URL(request.url)
  const page = parsePagination(url.searchParams)

  const { items, total } = await listSessions(user.id, page)
  return ok({ items, total, limit: page.limit, offset: page.offset })
})

/**
 * POST /api/sessions —— 创建面试会话。
 * 会校验 resumeId / jobJdId 确实属于当前用户，防止越权引用他人资料。
 */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, createSessionSchema)
  const session = await createSession(user.id, input)
  return created({ session })
})

export const dynamic = 'force-dynamic'
