import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { assertRateLimit, clientKeyFromRequest } from '@/lib/observability/rate-limit'
import { devCodeHint } from '@/lib/auth/verification-code'
import { smsCodeSchema } from '@/lib/validators/auth'

/**
 * POST /api/auth/sms-code —— 请求短信验证码（**模拟**）。
 *
 * 当前未接入短信服务商：只校验手机号格式并做限流，**不会真正下发短信**。
 * 验证码固定值见 `lib/auth/verification-code.ts`，并通过 `hint` 回传给前端展示，
 * 让「这是演示环境」无法被误认为正式功能。
 *
 * 仍然限流的原因：即使不花钱，这个路由也能被用来刷请求；
 * 接入真实短信后更是直接对应资费（见 lib/observability/rate-limit.ts）。
 */
export const POST = apiHandler(async (request: Request) => {
  assertRateLimit('auth.sms_code', clientKeyFromRequest(request))

  const { phone } = await parseJsonBody(request, smsCodeSchema)

  return ok({ sent: true, phone, hint: devCodeHint() })
})

export const dynamic = 'force-dynamic'
