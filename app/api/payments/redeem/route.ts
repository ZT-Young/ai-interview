import { z } from 'zod'

import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { assertRateLimit } from '@/lib/observability/rate-limit'
import { redeemCode } from '@/lib/services/handlers/redemption-service'
import { getEntitlements } from '@/lib/services/handlers/entitlement-service'
import { listOrders } from '@/lib/services/handlers/membership-service'

/**
 * POST /api/payments/redeem —— 兑换码兑换（V1 的支付替代方案）。
 *
 * 安全要点：
 * - 请求体**只提供兑换码**；金额与权益由服务端按 `product_id` 查商品目录决定
 * - 兑换码明文不入库（只比哈希）
 * - 核销用乐观锁（`used_count < max_usages`）防并发超发
 * - 权益发放复用 `grantEntitlement`，因此重复提交同一兑换码不会重复发放
 */
const bodySchema = z.object({
  code: z.string().min(6).max(128),
})

export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  // 限流：防兑换码枚举（按用户维度）
  assertRateLimit('payments.redeem', `user:${user.id}`)

  const input = await parseJsonBody(request, bodySchema)

  const result = await redeemCode(user.id, input.code)

  const [entitlements, orders] = await Promise.all([
    getEntitlements(user.id),
    listOrders(user.id),
  ])

  return ok({
    product: { id: result.product.id, name: result.product.name },
    order: result.order,
    remainingUsages: result.remainingUsages,
    entitlements,
    orders,
  })
})

export const dynamic = 'force-dynamic'
