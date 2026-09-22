import { and, desc, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { payments, users } from '@/db/schema'
import { notFound } from '@/lib/api/errors'

/**
 * 会员与订单服务 —— ③ 领域服务层。
 *
 * **当前范围**：只做展示（docs/design/UI.md §6）。
 * 支付渠道与免费次数规则仍为 TBD（AGENTS.md §9.2），因此
 * 本模块**不含**下单、渠道跳转与回调；`payments` 表已是最终结构，接入时无需迁移。
 */

export type MembershipLevel = 'free' | 'plus' | 'pro'

export const MEMBERSHIP_LABELS: Record<MembershipLevel, string> = {
  free: '免费用户',
  plus: '会员',
  pro: '高级会员',
}

/** 权益对照表：**必须与 docs/design/UI.md §5.6 的免费/付费边界一致** */
export const BENEFIT_MATRIX: Array<{ feature: string; free: boolean; member: boolean }> = [
  { feature: '面试总分与岗位匹配度', free: true, member: true },
  { feature: '六维得分与雷达图', free: true, member: true },
  { feature: '优势与基础训练建议', free: true, member: true },
  { feature: '逐题反馈与评分证据', free: false, member: true },
  { feature: '参考回答（改进要点）', free: false, member: true },
  { feature: '简历风险点', free: false, member: true },
  { feature: '完整训练建议', free: false, member: true },
]

export interface MembershipView {
  membership: MembershipLevel
  membershipLabel: string
  freeCredits: number
  emailVerified: boolean
  /** 支付渠道是否已接入；未接入时 UI 不得给出可完成的购买路径 */
  paymentEnabled: boolean
  benefits: typeof BENEFIT_MATRIX
}

export interface OrderView {
  id: string
  unlockType: string
  amountCents: number
  currency: string
  status: string
  /** 渠道订单号**脱敏**后展示（不暴露完整标识） */
  providerOrderMasked: string | null
  createdAt: string
  paidAt: string | null
}

/** 渠道订单号脱敏：保留前 4 位与后 4 位 */
export function maskProviderOrderId(value: string | null): string | null {
  if (!value) return null
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

export async function getMembership(userId: string): Promise<MembershipView> {
  const db = getDb()
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)

  const user = rows[0]
  if (!user) throw notFound('用户不存在')

  return {
    membership: user.membership as MembershipLevel,
    membershipLabel: MEMBERSHIP_LABELS[user.membership as MembershipLevel] ?? user.membership,
    freeCredits: user.freeCredits,
    emailVerified: user.emailVerifiedAt !== null,
    // 渠道未定：恒为 false，接入后改为读环境变量
    paymentEnabled: false,
    benefits: BENEFIT_MATRIX,
  }
}

export async function listOrders(userId: string, limit = 50): Promise<OrderView[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    unlockType: row.unlockType,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
    providerOrderMasked: maskProviderOrderId(row.providerOrderId),
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
  }))
}

/** 列表计数（用于「历史记录」等分页展示） */
export async function countOrders(userId: string): Promise<number> {
  const db = getDb()
  const rows = await db.select({ id: payments.id }).from(payments).where(eq(payments.userId, userId))
  return rows.length
}
