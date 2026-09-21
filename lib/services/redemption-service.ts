import { and, eq, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, redemptionCodes } from '@/db/schema'
import { conflict, notFound, validationError } from '@/lib/api/errors'
import { getProduct, type Product } from '@/lib/payments/products'
import { hashRedemptionCode, normalizeRedemptionCode } from '@/lib/payments/redemption-code'

import { createOrder, grantEntitlement, type OrderView } from './payment-service'

/**
 * 兑换码服务 —— V1 的支付替代方案（渠道选定前的过渡，见 AGENTS.md §9.2）。
 *
 * 安全要点：
 * - **明文不入库**：只比对 SHA-256 哈希
 * - `product_id` 决定金额与权益，**请求体只提供兑换码**
 * - 核销用 `used_count < max_usages` 作为更新条件（乐观锁），防并发超发
 * - 发放走 `grantEntitlement`，与支付回调同一条路径，因此天然幂等
 */

export interface RedeemResult {
  order: OrderView
  product: Product
  /** 兑换码剩余可用次数 */
  remainingUsages: number
}

export async function redeemCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const normalized = normalizeRedemptionCode(rawCode)
  if (normalized.length < 6) throw validationError('兑换码格式不正确')

  const codeHash = hashRedemptionCode(normalized)
  const db = getDb()

  // ① 校验并原子核销（乐观锁：并发下只有一个事务能成功）
  const consumed = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(redemptionCodes)
      .where(eq(redemptionCodes.codeHash, codeHash))
      .limit(1)

    const code = rows[0]
    if (!code) throw notFound('兑换码无效')
    if (code.disabled) throw conflict('兑换码已停用')
    if (code.expiresAt && code.expiresAt.getTime() < Date.now()) throw conflict('兑换码已过期')
    if (code.usedCount >= code.maxUsages) throw conflict('兑换码已被使用完')

    const updated = await tx
      .update(redemptionCodes)
      .set({ usedCount: sql`${redemptionCodes.usedCount} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(redemptionCodes.id, code.id),
          sql`${redemptionCodes.usedCount} < ${redemptionCodes.maxUsages}`,
        ),
      )
      .returning({ usedCount: redemptionCodes.usedCount, maxUsages: redemptionCodes.maxUsages })

    if (!updated[0]) throw conflict('兑换码已被使用完')

    return {
      productId: code.productId,
      remainingUsages: updated[0].maxUsages - updated[0].usedCount,
    }
  })

  // ② 商品必须存在 —— 防止运营误配导致「发出去了但不知道发了什么」
  const product = getProduct(consumed.productId)
  if (!product) throw validationError(`兑换码对应的商品不存在：${consumed.productId}`)

  // ③ 生成订单，然后交给 `grantEntitlement` 统一发放。
  //
  // ⚠️ 不要把订单先改成 paid 再调用 `grantEntitlement`：
  // 该函数的第一道幂等闸门就是「status 已是 paid → 不再发放」（防重复回调超发），
  // 先置 paid 会让它直接返回 `already_paid`，**权益永远发不出去**
  // （次数包不加次数、订阅不升会员），而订单看起来却是成功的。
  // 兑换码要复用与支付回调完全相同的发放路径，因此这里保持订单为 pending，
  // 由 `grantEntitlement` 自己完成「置 paid + 发放」这一步。
  const { order } = await createOrder(userId, product.id)

  const granted = await grantEntitlement(order.id)

  await db.insert(auditLogs).values({
    actorId: userId,
    action: 'payment.redeemed',
    targetType: 'payment',
    targetId: order.id,
    metadata: JSON.stringify({ product_id: product.id, granted: granted.granted }),
  })

  return {
    order: { ...order, status: 'paid', paidAt: new Date().toISOString() },
    product,
    remainingUsages: consumed.remainingUsages,
  }
}
