import type { MembershipLevel } from '@/lib/services/handlers/membership-service'

/**
 * 商品目录 —— **服务端定价与权益的单一真源**。
 *
 * 安全约束（AGENTS.md 与任务要求）：
 * - 价格与权益**只在本表定义**，绝不从前端请求体读取
 * - 前端下单只传 `productId`；金额与发放内容由服务端查表决定
 * - 回调发放权益时同样按此表执行，因此伪造回调也无法改变发放内容
 */

export const PRODUCT_IDS = ['report_unlock', 'package_10', 'subscription_monthly'] as const
export type ProductId = (typeof PRODUCT_IDS)[number]

/** 权益发放方式 */
export type Grant =
  | { kind: 'unlock_report' }
  | { kind: 'add_credits'; credits: number }
  | { kind: 'upgrade_membership'; level: MembershipLevel }

export interface Product {
  id: ProductId
  name: string
  description: string
  /** 金额（分）—— 服务端权威定价 */
  amountCents: number
  currency: string
  /** 对应的 orders.unlock_type */
  unlockType: 'report' | 'package' | 'subscription'
  grant: Grant
  /** 是否为订阅制（V1 不做续费，仅记录等级） */
  recurring: boolean
}

export const PRODUCTS: Record<ProductId, Product> = {
  report_unlock: {
    id: 'report_unlock',
    name: '解锁本份报告',
    description: '解锁当前这份面试报告的完整内容：逐题反馈、评分证据、参考回答、简历风险点。',
    amountCents: 990,
    currency: 'CNY',
    unlockType: 'report',
    grant: { kind: 'unlock_report' },
    recurring: false,
  },
  package_10: {
    id: 'package_10',
    name: '10 次面试包',
    description: '增加 10 次完整模拟面试次数，并解锁全部报告的详细内容。',
    amountCents: 4900,
    currency: 'CNY',
    unlockType: 'package',
    grant: { kind: 'add_credits', credits: 10 },
    recurring: false,
  },
  subscription_monthly: {
    id: 'subscription_monthly',
    name: '月度会员',
    description: '无限次模拟面试、详细报告与语音面试。',
    amountCents: 3900,
    currency: 'CNY',
    unlockType: 'subscription',
    grant: { kind: 'upgrade_membership', level: 'plus' },
    recurring: true,
  },
}

export function isProductId(value: string): value is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(value)
}

/** 按 id 取商品；不存在返回 null（调用方据此拒绝，而不是给默认值） */
export function getProduct(productId: string): Product | null {
  return isProductId(productId) ? PRODUCTS[productId] : null
}

/** 列出全部商品（供会员页展示价格与权益） */
export function listProducts(): Product[] {
  return PRODUCT_IDS.map((id) => PRODUCTS[id])
}
