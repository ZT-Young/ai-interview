import { cookies } from 'next/headers'

import { apiHandler, ok } from '@/lib/api/respond'
import { requestContext } from '@/lib/api/guard'
import { logout } from '@/lib/services/handlers/auth-service'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'

/**
 * POST /api/auth/logout —— 退出登录。
 * 置 revoked_at 使会话立即失效（这正是选择数据库会话而非 JWT 的原因）。
 * 幂等：未登录时同样返回 200，避免暴露登录状态。
 */
export const POST = apiHandler(async (request: Request) => {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value
  await logout(token, requestContext(request))

  const response = ok({ success: true })
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
