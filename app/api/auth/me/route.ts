import { apiHandler, ok } from '@/lib/api/respond'
import { requestContext, requireUser } from '@/lib/api/guard'
import { deleteUserAccount } from '@/lib/services/handlers/data-rights-service'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'

/** GET /api/auth/me —— 当前登录用户；未登录返回 401。 */
export const GET = apiHandler(async () => {
  const user = await requireUser()
  return ok({ user })
})

/**
 * DELETE /api/auth/me —— 删除账号（AGENTS.md §7 C3）。
 *
 * 效果：软删除账号 + 吊销**全部**会话 + 清理对象存储中的简历原件。
 * 删除后当前 Cookie 立即失效（响应会清除它）。
 *
 * 前端在 `/settings` 提供二次确认（需输入邮箱），此处只做服务端执行。
 */
export const DELETE = apiHandler(async (request: Request) => {
  const user = await requireUser()

  const result = await deleteUserAccount(user.id, requestContext(request))

  const response = ok(result)
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
})

export const dynamic = 'force-dynamic'
