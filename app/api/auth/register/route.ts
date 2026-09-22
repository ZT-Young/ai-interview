import { NextResponse } from 'next/server'

import { apiHandler, created, parseJsonBody } from '@/lib/api/respond'
import { requestContext } from '@/lib/api/guard'
import { assertRateLimit, clientKeyFromRequest } from '@/lib/observability/rate-limit'
import { register } from '@/lib/services/handlers/auth-service'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/session'
import { registerSchema } from '@/lib/validators/auth'

/**
 * POST /api/auth/register —— 注册并自动登录。
 * 校验 → 注册（事务内建用户 + 同意记录 + 会话 + 审计）→ 写 Cookie。
 */
export const POST = apiHandler(async (request: Request) => {
  // 限流：防批量注册（按 IP）
  assertRateLimit('auth.register', clientKeyFromRequest(request))

  const input = await parseJsonBody(request, registerSchema)
  const { user, token, expiresAt } = await register(input, requestContext(request))

  const response = created({ user })
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(),
    expires: expiresAt,
  })
  return response
})

export const dynamic = 'force-dynamic'

// 明确禁止其他方法，避免误用
export function GET(): NextResponse {
  return NextResponse.json(
    { error: { code: 'not_found', message: '请使用 POST /api/auth/register' } },
    { status: 405 },
  )
}
