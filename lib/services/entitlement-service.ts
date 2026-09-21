import { and, eq, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { payments, users } from '@/db/schema'
import { notFound } from '@/lib/api/errors'
import type { MembershipLevel } from '@/lib/services/membership-service'

/**
 * 权益服务 —— **权益判定的单一真源**。
 *
 * 安全约束（AGENTS.md 与任务要求）：
 * - 权益**只在服务端计算**；前端传来的任何「我已付费/我是会员」都不可信
 * - 前端只用于展示（决定按钮显隐），真正的门禁在每个 API 内重新计算
 *
 * 免费 / 付费边界（docs/UI.md §5.6）：
 * | 能力 | 免费 | 付费 |
 * |---|---|---|
 * | 完整面试次数 | 1 次（`free_credits`） | 无限 |
 * | 报告 | 简版（总分/六维/优势/基础建议） | 详细（逐题反馈/证据/参考回答/风险点） |
 * | 语音面试 | ✗ | ✓ |
 */

/** 免费额度消耗的凭证类型 */
export const FREE_TRIAL_UNLOCK_TYPE = 'free_trial'

/** 免费用户可用的完整面试次数（默认值，与 users.free_credits 初始值一致） */
export const DEFAULT_FREE_TRIAL = 1

export interface EntitlementInput {
  membership: MembershipLevel
  /** 免费额度**余额**（users.free_credits） */
  freeCredits: number
  /** 已消耗的免费额度次数（来自 payments 聚合） */
  consumedFreeTrials: number
}

export interface Entitlements {
  membership: MembershipLevel
  /** 是否为付费会员（无限次数 + 全部高级能力） */
  isMember: boolean
  /** 免费额度余额（会员为 0，因为不再需要） */
  freeCreditsLeft: number
  /** 已消耗的免费额度次数 */
  consumedFreeTrials: number
  /** 是否可无限次面试 */
  unlimitedInterviews: boolean
  /** 是否还能发起一次完整面试 */
  canStartInterview: boolean
  /** 是否可查看**详细**报告（否则只有简版） */
  reportDetail: boolean
  /** 是否可使用语音面试 */
  voiceInterview: boolean
}

/**
 * **纯函数**权益计算（可离线单测，不触库）。
 *
 * 会员：无限次数 + 详细报告 + 语音。
 * 免费：额度余额 > 0 才能开始面试；报告始终为简版；无语音。
 */
export function computeEntitlements(input: EntitlementInput): Entitlements {
  const isMember = input.membership !== 'free'
  const freeCreditsLeft = Math.max(0, input.freeCredits)

  return {
    membership: input.membership,
    isMember,
    freeCreditsLeft: isMember ? 0 : freeCreditsLeft,
    consumedFreeTrials: Math.max(0, input.consumedFreeTrials),
    unlimitedInterviews: isMember,
    canStartInterview: isMember || freeCreditsLeft > 0,
    reportDetail: isMember,
    voiceInterview: isMember,
  }
}

/** 读取某用户已消耗的免费额度次数（成功发放的 free_trial 凭证数） */
export async function countConsumedFreeTrials(userId: string): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(payments)
    .where(
      and(
        eq(payments.userId, userId),
        eq(payments.unlockType, FREE_TRIAL_UNLOCK_TYPE),
        eq(payments.status, 'paid'),
      ),
    )

  return Number(rows[0]?.value ?? 0)
}

/** 读取某用户当前权益（服务端权威） */
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const db = getDb()

  const rows = await db
    .select({ membership: users.membership, freeCredits: users.freeCredits })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const user = rows[0]
  if (!user) throw notFound('用户不存在')

  const consumed = await countConsumedFreeTrials(userId)

  return computeEntitlements({
    membership: user.membership as MembershipLevel,
    freeCredits: user.freeCredits,
    consumedFreeTrials: consumed,
  })
}

/**
 * 某份报告是否已解锁（详细报告）。
 *
 * 判定依据：会员，或该报告有一条 `unlock_type='report' AND status='paid'` 的订单。
 * 注意：**不看 `reports.is_unlocked` 字段本身**，因为它可能与订单不一致；
 * 订单才是权威凭证。
 */
export async function hasReportUnlock(userId: string, reportId: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.userId, userId),
        eq(payments.reportId, reportId),
        eq(payments.unlockType, 'report'),
        eq(payments.status, 'paid'),
      ),
    )
    .limit(1)

  return Boolean(rows[0])
}
