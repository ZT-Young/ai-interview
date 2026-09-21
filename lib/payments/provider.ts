import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * 支付渠道适配层（V1：mock 渠道）。
 *
 * 设计目标：**现在就具备真实渠道所需的验签与幂等骨架**，
 * 将来接 Stripe / 微信 / 支付宝 时只需替换本文件的签名与报文解析，
 * 回调路由此后的业务逻辑（发放权益、幂等检查）无需改动。
 *
 * 安全要点：
 * - 回调**必须验签**，签名密钥只在服务端环境变量中
 * - 验签用常数时间比较，避免时序侧信道
 * - 回调金额与商品**以服务端订单为准**，不信任回调报文里的金额
 */

export const MOCK_PROVIDER = 'mock' as const
export type PaymentProvider = typeof MOCK_PROVIDER | 'stripe' | 'wechat' | 'alipay'

export class PaymentSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentSignatureError'
  }
}

function secret(): string {
  const value = process.env.PAYMENT_WEBHOOK_SECRET
  if (!value || value.length < 16) {
    throw new PaymentSignatureError(
      '[payments] 缺少 PAYMENT_WEBHOOK_SECRET（至少 16 字符），请参考 .env.example 配置。',
    )
  }
  return value
}

/** 渠道是否已配置（未配置时下单接口返回 503，不给出无法完成的购买路径） */
export function isPaymentConfigured(): boolean {
  const value = process.env.PAYMENT_WEBHOOK_SECRET
  return Boolean(value && value.length >= 16)
}

/** 签名原文：`${provider}.${providerOrderId}.${amountCents}.${status}` */
export function buildSignaturePayload(input: {
  provider: string
  providerOrderId: string
  amountCents: number
  status: string
}): string {
  return [input.provider, input.providerOrderId, String(input.amountCents), input.status].join('.')
}

/** 生成签名（服务端内部使用；测试用它构造合法回调） */
export function signCallback(input: {
  provider: string
  providerOrderId: string
  amountCents: number
  status: string
}): string {
  return createHmac('sha256', secret()).update(buildSignaturePayload(input)).digest('hex')
}

/**
 * 验签。
 *
 * 用 `timingSafeEqual` 比较，长度不同直接判失败（`timingSafeEqual` 对不等长会抛错）。
 */
export function verifyCallbackSignature(input: {
  provider: string
  providerOrderId: string
  amountCents: number
  status: string
  signature: string
}): boolean {
  let expected: string
  try {
    expected = signCallback(input)
  } catch {
    return false
  }

  const provided = input.signature.trim().toLowerCase()
  if (provided.length !== expected.length) return false

  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
}

/** 生成渠道订单号（下单时写入 payments.provider_order_id） */
export function newProviderOrderId(): string {
  return `mock_${randomUUID().replace(/-/g, '')}`
}
