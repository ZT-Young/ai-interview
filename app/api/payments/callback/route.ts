import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getDb } from '@/db/client'
import { payments } from '@/db/schema'
import { errorResponse, upstreamError, validationError } from '@/lib/api/errors'
import { ok } from '@/lib/api/respond'
import { getProduct } from '@/lib/payments/products'
import { verifyCallbackSignature } from '@/lib/payments/provider'
import { assertRateLimit, clientKeyFromRequest } from '@/lib/observability/rate-limit'
import { grantEntitlement } from '@/lib/services/payment-service'

/**
 * POST /api/payments/callback —— 支付渠道回调。
 *
 * **这是全项目最需要防御的接口**，安全要求（AGENTS.md §7、任务要求）：
 *
 * 1. **不要求登录**：回调来自渠道服务器，不是浏览器会话
 * 2. **必须验签**：HMAC-SHA256，密钥只在服务端；验签失败一律 401
 * 3. **金额以服务端订单为准**：回调报文里的金额只用于比对，
 *    不一致直接拒绝（防止「付 1 分钱解锁 99 元商品」）
 * 4. **幂等**：同一 `(provider, provider_order_id)` 重复回调只发放一次；
 *    重复请求返回 200 + `granted: false`，让渠道停止重试
 * 5. **不做未授权发放**：找不到本地订单时返回 200 + `ignored`，
 *    不创建订单、不发放权益（防止伪造回调凭空造权益）
 */

const callbackBodySchema = z.object({
  providerOrderId: z.string().min(1).max(128),
  amountCents: z.number().int().min(0),
  /** 仅处理 success 状态；其它状态记录但不发放 */
  status: z.string().min(1).max(32),
  signature: z.string().min(16).max(256),
})

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 限流：渠道可能重试，额度较宽；按来源 IP（未登录接口）
    assertRateLimit('payments.callback', clientKeyFromRequest(request))

    const raw = await request.text()

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      throw validationError('回调报文不是合法 JSON')
    }

    const result = callbackBodySchema.safeParse(parsedJson)
    if (!result.success) {
      throw validationError('回调参数不合法', {
        issues: result.error.issues.map((issue) => issue.path.join('.')),
      })
    }

    const body = result.data
    const provider = 'mock'

    // ① 验签（不信任任何未签名的字段）
    const signatureOk = verifyCallbackSignature({
      provider,
      providerOrderId: body.providerOrderId,
      amountCents: body.amountCents,
      status: body.status,
      signature: body.signature,
    })

    if (!signatureOk) {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: '回调签名校验失败' } },
        { status: 401 },
      )
    }

    const db = getDb()

    // ② 找到本地订单；**找不到就忽略**，不凭空创建
    const rows = await db
      .select()
      .from(payments)
      .where(
        and(eq(payments.provider, 'mock'), eq(payments.providerOrderId, body.providerOrderId)),
      )
      .limit(1)

    const payment = rows[0]
    if (!payment) {
      return ok({ received: true, granted: false, reason: 'order_not_found' })
    }

    // ③ 幂等：已支付过 → 直接返回成功，不再发放
    if (payment.status === 'paid') {
      return ok({ received: true, granted: false, reason: 'already_paid', paymentId: payment.id })
    }

    // ④ 非成功状态只更新订单状态，不发放
    if (body.status !== 'success') {
      await db
        .update(payments)
        .set({
          status: body.status === 'failed' ? 'failed' : 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id))

      return ok({ received: true, granted: false, reason: `status_${body.status}` })
    }

    // ⑤ 金额必须与服务端订单一致（防止篡改金额）
    if (body.amountCents !== payment.amountCents) {
      await db
        .update(payments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(payments.id, payment.id))

      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: '回调金额与订单不一致，已拒绝发放',
          },
        },
        { status: 422 },
      )
    }

    // ⑥ 商品必须存在（否则不知道该发什么权益）
    const product = payment.provider ? getProduct(payment.provider) : null
    if (!product) {
      throw upstreamError('订单对应的商品不存在，无法发放权益')
    }

    // ⑦ 发放（内部还有一道 status 乐观锁，防并发重复发放）
    const granted = await grantEntitlement(payment.id)

    return ok({
      received: true,
      granted: granted.granted,
      reason: granted.reason ?? 'granted',
      paymentId: payment.id,
      reportId: granted.reportId ?? null,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export const dynamic = 'force-dynamic'
