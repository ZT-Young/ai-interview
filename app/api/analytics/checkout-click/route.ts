import { z } from 'zod'

import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { assertRateLimit } from '@/lib/observability/rate-limit'
import { trackEvent } from '@/lib/observability/analytics'

/**
 * POST /api/analytics/checkout-click —— 付费意愿埋点（前端上报）。
 *
 * 这是**唯一**由前端触发的埋点事件：「点击」只发生在浏览器，服务端看不到。
 * 但必须明确边界（docs/product/METRICS.md §2.2）：
 *
 * - **只用于分析意愿，不作为任何权益依据**。权益只看 `payment_succeeded`，
 *   而这个事件可以被伪造（用户能自己发请求），若拿它判定权益就是越权入口。
 * - 事件名**写死**为 `pay_checkout_clicked`：不接受调用方传事件名，
 *   否则这个路由就成了任意埋点的开放代理。
 * - `product_id` / `source_page` 走白名单枚举，避免任意字符串污染事件表。
 *
 * 免费模式下没有付费入口（`FREE_MODE` 关闭了会员页与订单页），
 * 因此该事件实际不会触发；路由保留是为了恢复收费时前端无需改动。
 */
const bodySchema = z.object({
  productId: z.string().min(1).max(40),
  sourcePage: z.enum(['report', 'membership', 'orders', 'redeem']),
})

export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  assertRateLimit('analytics.checkout_click', `user:${user.id}`)

  const input = await parseJsonBody(request, bodySchema)

  await trackEvent('pay_checkout_clicked', {
    userId: user.id,
    properties: {
      product_id: input.productId,
      source_page: input.sourcePage,
    },
  })

  // 埋点不影响业务：永远返回成功，也不回传任何业务数据
  return ok({ tracked: true })
})

export const dynamic = 'force-dynamic'
