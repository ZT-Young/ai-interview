import { cookies } from 'next/headers'

import { apiHandler, ok } from '@/lib/api/respond'
import { requestContext } from '@/lib/api/guard'
import { logout } from '@/lib/services/handlers/auth-service'
import { ADMIN_SESSION_COOKIE_NAME } from '@/lib/auth/session'

/**
 * POST /api/auth/admin/logout —— 退出**管理端**会话。
 *
 * 与用户端 `/api/auth/logout` 分开：只吊销管理端 Cookie 对应的那条会话，
 * 用户端的登录态不受影响（管理员退出后台后，用户侧仍应保持登录）。
 */
export const POST = apiHandler(async (request: Request) => {
  const token = cookies().get(ADMIN_SESSION_COOKIE_NAME)?.value
  await logout(token, requestContext(request))

  const response = ok({ success: true })
  response.cookies.delete(ADMIN_SESSION_COOKIE_NAME)
  return response
})

export const dynamic = 'force-dynamic'
