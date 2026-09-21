import { z } from 'zod'

import { requireUser } from '@/lib/api/guard'
import { serviceUnavailable } from '@/lib/api/errors'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { isPaymentConfigured } from '@/lib/payments/provider'
import { createOrder } from '@/lib/services/payment-service'
import { listOrders } from '@/lib/services/membership-service'
import { getEntitlements } from '@/lib/services/entitlement-service'

/**
 * GET /api/payments/orders —— 当前用户的订单记录 + 权益摘要。
 *
 * 只返回自己的订单（`payments.user_id = 当前用户`），渠道订单号脱敏。
 */
export const GET = apiHandler(async () => {
  const user = await requireUser()
  const [orders, entitlements] = await Promise.all([
    listOrders(user.id),
    getEntitlements(user.id),
  ])

  return ok({
    orders,
    entitlements,
    paymentConfigured: isPaymentConfigured(),
  })
})

const createBodySchema = z.object({
  /** **只传商品标识**；金额与权益由服务端商品目录决定 */
  productId: z.string().min(1).max(64),
  /** 解锁单份报告时必填 */
  reportId: z.string().uuid().optional(),
})

/**
 * POST /api/payments/orders —— 创建订单。
 *
 * 安全：请求体不接受金额、币种、权益字段；价格只能来自服务端商品目录。
 * 渠道未配置时返回 503（不给用户一个无法完成的购买路径）。
 */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, createBodySchema)

  if (!isPaymentConfigured()) {
    throw serviceUnavailable('支付功能尚未开放，请使用兑换码或稍后再试')
  }

  const { order, providerOrderId } = await createOrder(user.id, input.productId, {
    reportId: input.reportId,
  })

  return ok({ order, providerOrderId })
})

export const dynamic = 'force-dynamic'
