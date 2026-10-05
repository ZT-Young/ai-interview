import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { requestContext } from '@/lib/api/guard'
import { assertRateLimit, clientKeyFromRequest } from '@/lib/observability/rate-limit'
import { loginAdmin } from '@/lib/services/handlers/auth-service'
import { ADMIN_SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/session'
import { loginSchema } from '@/lib/validators/auth'

/**
 * POST /api/auth/admin/login —— **管理端专用登录**，与用户端 `/api/auth/login` 完全分离。
 *
 * 三个刻意的设计：
 * 1. **独立的限流桶**（`auth.admin_login`）：后台登录被撞库不应该消耗用户端的额度，
 *    反过来也一样。
 * 2. **写独立的 Cookie**（`ai_interview_admin_session`）：管理员可同时持有两端会话，
 *    互不顶掉。
 * 3. **失败文案与用户端一致**：账号不存在 / 密码错误 / 不是管理员 ——
 *    三者返回同一句「账号或密码不正确」。提示「你不是管理员」等于帮攻击者确认
 *    该账号存在（且能登用户端），这是典型的账号枚举口子。
 */
export const POST = apiHandler(async (request: Request) => {
  assertRateLimit('auth.admin_login', clientKeyFromRequest(request))

  const input = await parseJsonBody(request, loginSchema)
  const { user, token, expiresAt } = await loginAdmin(input, requestContext(request))

  const response = ok({ user })
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(),
    expires: expiresAt,
  })
  return response
})

export const dynamic = 'force-dynamic'
