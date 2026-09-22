import { and, eq, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, payments, reports, users } from '@/db/schema'
import { conflict, notFound, validationError } from '@/lib/api/errors'
import { getProduct, type Product } from '@/lib/payments/products'
import { newProviderOrderId } from '@/lib/payments/provider'

import { FREE_TRIAL_UNLOCK_TYPE } from './entitlement-service'

/**
 * 支付服务 —— 下单、免费额度消耗、权益发放。
 *
 * 核心安全与一致性要求：
 * 1. **金额与权益来自服务端商品目录**，请求体只提供 productId
 * 2. **发放幂等**：以 `payments.status` 为闸门，配合 `(provider, provider_order_id)`
 *    唯一索引，重复回调不会二次发放
 * 3. **发放与凭证更新在同一事务内**，避免「凭证已付但权益没发」
 * 4. 免费额度消耗也写入 `payments`（`unlock_type = 'free_trial'`），
 *    使免费与付费共用一张凭证表，对账与审计完整
 */

/** 免费用户可消耗的额度上限（与 users.free_credits 初始值 1 一致） */
export const FREE_TRIAL_LIMIT = 1

export interface OrderView {
  id: string
  productId: string | null
  unlockType: string
  amountCents: number
  currency: string
  status: string
  provider: string | null
  providerOrderId: string | null
  createdAt: string
  paidAt: string | null
}

function toOrderView(row: typeof payments.$inferSelect, productId: string | null): OrderView {
  return {
    id: row.id,
    productId,
    unlockType: row.unlockType,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
  }
}

/**
 * 折扣/自定价格一律不允许：金额只能来自商品目录。
 *
 * 说明：`payments` 表没有 product_id 列，因此复用 `provider` 列记录**商品标识**
 * （V1 只有 mock 渠道，渠道信息不影响对账；接入真实渠道时可加列或改为
 * `provider = 'wechat'` 并通过金额+unlock_type 反推）。
 */
export async function createOrder(
  userId: string,
  productId: string,
  meta: { reportId?: string } = {},
): Promise<{ order: OrderView; providerOrderId: string }> {
  const product: Product | null = getProduct(productId)
  if (!product) throw validationError(`未知商品：${productId}`)

  const db = getDb()

  // 单报告解锁必须指向自己的报告（归属校验）
  if (product.grant.kind === 'unlock_report') {
    if (!meta.reportId) throw validationError('解锁报告需要提供 reportId')

    const rows = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.id, meta.reportId), eq(reports.userId, userId)))
      .limit(1)

    if (!rows[0]) throw notFound('报告不存在')
  }

  const providerOrderId = newProviderOrderId()

  const inserted = await db
    .insert(payments)
    .values({
      userId,
      reportId: product.grant.kind === 'unlock_report' ? (meta.reportId ?? null) : null,
      unlockType: product.unlockType,
      amountCents: product.amountCents,
      currency: product.currency,
      status: 'pending',
      // 复用为商品标识，回调时据它核验金额
      provider: product.id,
      providerOrderId,
      creditsGranted: product.grant.kind === 'add_credits' ? product.grant.credits : 0,
    })
    .returning()

  const row = inserted[0]
  if (!row) throw conflict('订单创建失败')

  return { order: toOrderView(row, product.id), providerOrderId }
}

/* ------------------------------------------------------------------ *
 * 权益发放（幂等）
 * ------------------------------------------------------------------ */

export interface GrantResult {
  /** 本次是否真的发放了权益（false 表示此前已发放，属于重复回调） */
  granted: boolean
  reason?: 'already_paid' | 'payment_not_found' | 'amount_mismatch'
  paymentId?: string
  reportId?: string | null
}

/**
 * 按支付凭证发放权益。**幂等**。
 *
 * 幂等闸门有两层：
 * 1. 先查 `payments.status`：已 paid 直接返回 `granted: false`
 * 2. 发放与置为 paid 在同一事务；并把 `status='pending'` 作为更新条件，
 *    并发下只有一个事务能更新成功（乐观锁）
 */
export async function grantEntitlement(paymentId: string): Promise<GrantResult> {
  const db = getDb()

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
    const payment = rows[0]
    if (!payment) return { granted: false, reason: 'payment_not_found' as const }

    // 幂等闸门 ①：已支付过的凭证不再发放
    if (payment.status === 'paid') {
      return {
        granted: false,
        reason: 'already_paid' as const,
        paymentId: payment.id,
        reportId: payment.reportId,
      }
    }

    // 幂等闸门 ②：带 status='pending' 条件更新，并发时只有一个成功
    const updated = await tx
      .update(payments)
      .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'pending')))
      .returning({ id: payments.id })

    if (!updated[0]) {
      // 并发回调抢先完成了发放
      return {
        granted: false,
        reason: 'already_paid' as const,
        paymentId: payment.id,
        reportId: payment.reportId,
      }
    }

    // 按 unlock_type 发放（金额与内容以服务端记录为准）
    switch (payment.unlockType) {
      case 'report': {
        if (!payment.reportId) throw conflict('单报告解锁缺少 reportId')
        await tx
          .update(reports)
          .set({ isUnlocked: true, unlockedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(reports.id, payment.reportId), eq(reports.userId, payment.userId)))
        break
      }
      case 'package': {
        if (payment.creditsGranted > 0) {
          await tx
            .update(users)
            .set({
              freeCredits: sql`${users.freeCredits} + ${payment.creditsGranted}`,
              updatedAt: new Date(),
            })
            .where(eq(users.id, payment.userId))
        }
        break
      }
      case 'subscription': {
        await tx
          .update(users)
          .set({ membership: 'plus', updatedAt: new Date() })
          .where(eq(users.id, payment.userId))
        break
      }
      default:
        // free_trial 等类型没有额外发放动作（凭证据实已记录消耗）
        break
    }

    await tx.insert(auditLogs).values({
      actorId: payment.userId,
      action: 'payment.granted',
      targetType: 'payment',
      targetId: payment.id,
      metadata: JSON.stringify({
        unlock_type: payment.unlockType,
        amount_cents: payment.amountCents,
        credits_granted: payment.creditsGranted,
        product: payment.provider,
      }),
    })

    return {
      granted: true,
      paymentId: payment.id,
      reportId: payment.reportId,
    }
  })
}

/* ------------------------------------------------------------------ *
 * 免费额度消耗
 * ------------------------------------------------------------------ */

/**
 * 消耗一次免费额度（生成报告时调用，见 docs/design/UI.md §5.6）。
 *
 * 校验顺序（全部服务端）：
 * 1. 会员不受限，不消耗
 * 2. 已消耗次数达到上限 → 拒绝
 * 3. 余额不足 → 拒绝
 * 4. 同一报告已有消耗记录 → 幂等返回（不重复扣）
 */
export async function consumeFreeTrial(
  userId: string,
  reportId: string,
): Promise<{ consumed: boolean; remaining: number; reason?: 'member' | 'limit_reached' | 'already_consumed' }> {
  const db = getDb()

  return db.transaction(async (tx) => {
    const userRows = await tx
      .select({ membership: users.membership, freeCredits: users.freeCredits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const user = userRows[0]
    if (!user) throw notFound('用户不存在')

    // 会员不消耗免费额度
    if (user.membership !== 'free') {
      return { consumed: false, remaining: 0, reason: 'member' as const }
    }

    // 幂等：该报告已消耗过则不再扣（重复生成报告不会重复消耗）
    const existing = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.userId, userId),
          eq(payments.reportId, reportId),
          eq(payments.unlockType, FREE_TRIAL_UNLOCK_TYPE),
        ),
      )
      .limit(1)

    if (existing[0]) {
      return { consumed: false, remaining: user.freeCredits, reason: 'already_consumed' as const }
    }

    // 注意：这里必须在**事务内**统计，否则会另开连接读到旧数据
    const consumedRows = await tx
      .select({ value: sql<number>`count(*)` })
      .from(payments)
      .where(
        and(
          eq(payments.userId, userId),
          eq(payments.unlockType, FREE_TRIAL_UNLOCK_TYPE),
          eq(payments.status, 'paid'),
        ),
      )

    const consumedCount = Number(consumedRows[0]?.value ?? 0)
    if (consumedCount >= FREE_TRIAL_LIMIT) {
      return { consumed: false, remaining: user.freeCredits, reason: 'limit_reached' as const }
    }

    if (user.freeCredits <= 0) {
      return { consumed: false, remaining: 0, reason: 'limit_reached' as const }
    }

    // 凭证 + 扣减余额，同一事务
    await tx.insert(payments).values({
      userId,
      reportId,
      unlockType: FREE_TRIAL_UNLOCK_TYPE,
      // 免费额度金额为 0；CHECK 约束要求 >= 0
      amountCents: 0,
      currency: 'CNY',
      status: 'paid',
      provider: 'free',
      paidAt: new Date(),
      creditsGranted: 0,
    })

    const updated = await tx
      .update(users)
      .set({ freeCredits: sql`${users.freeCredits} - 1`, updatedAt: new Date() })
      .where(and(eq(users.id, userId), sql`${users.freeCredits} > 0`))
      .returning({ freeCredits: users.freeCredits })

    if (!updated[0]) {
      // 并发下余额已被扣完 —— 事务回滚，凭证也不会落库
      throw conflict('免费次数不足')
    }

    await tx.insert(auditLogs).values({
      actorId: userId,
      action: 'credit.free_trial_consumed',
      targetType: 'report',
      targetId: reportId,
      metadata: JSON.stringify({ remaining: updated[0].freeCredits }),
    })

    return { consumed: true, remaining: updated[0].freeCredits }
  })
}
