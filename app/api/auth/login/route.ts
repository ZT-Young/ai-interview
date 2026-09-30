import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { requestContext } from '@/lib/api/guard'
import { assertRateLimit, clientKeyFromRequest } from '@/lib/observability/rate-limit'
import { login } from '@/lib/services/handlers/auth-service'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/session'
import { loginSchema } from '@/lib/validators/auth'

/**
 * POST /api/auth/login —— 用户名 / 手机号 / 邮箱 + 密码或验证码登录。
 *
 * `identifier` 由服务端判定类型（先手机号、再邮箱、其余当用户名）；
 * `mode` 决定凭证：`password` 或 `code`。
 * 账号不存在与凭证错误的响应完全一致（防账号枚举，见 auth-service.login）。
 */
export const POST = apiHandler(async (request: Request) => {
  // 限流：防暴力破解（按 IP）。见 lib/observability/rate-limit.ts
  assertRateLimit('auth.login', clientKeyFromRequest(request))

  const input = await parseJsonBody(request, loginSchema)
  const { user, token, expiresAt } = await login(input, requestContext(request))

  const response = ok({ user })
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(),
    expires: expiresAt,
  })
  return response
})

export const dynamic = 'force-dynamic'
