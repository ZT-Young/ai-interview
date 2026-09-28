import { getDb, hasDatabaseUrl } from '@/db/client'
import { analyticsEvents, type AnalyticsEventName } from '@/db/schema/analytics-events'
import { redactFields } from './logger'

/**
 * 产品行为埋点 —— docs/product/METRICS.md §2 的代码实现。
 *
 * 三条硬约束（与文档 §1 埋点原则一致，违反即为 Bug）：
 *
 * 1. **PII 最小化**：properties 只放行为与元数据，**禁止**放简历原文、作答内容、
 *    邮箱、令牌。分数一律用分段（如 `total_score_bucket`）而不是精确分，
 *    否则事件表会变成「用户能力画像」，凭空多出一个隐私面。
 *    写入前过一遍 `redactFields()` 做兜底。
 * 2. **服务端权威**：这里只在服务端写入。`pay_checkout_clicked` 是唯一可由前端
 *    触发的事件（点击只发生在浏览器），但它**不参与任何权益判定**——
 *    权益只看 `payment_succeeded`。
 * 3. **只增不改**：事件写入后不更新、不删除，因此本模块**不提供** update / delete。
 *
 * 与业务事务的关系：**刻意不放在同一个事务里**。埋点失败不能让面试失败，
 * 所以全部 fire-and-forget；调用方用 `void trackEvent(...)`。
 */

export interface TrackInput {
  userId?: string | null
  /** 关联面试会话；非会话类事件可省略 */
  sessionId?: string | null
  /** 事件属性（禁止放 PII） */
  properties?: Record<string, unknown>
  /** 业务发生时刻；省略则用当前时间。不用前端传的时间（防篡改） */
  occurredAt?: Date
}

/**
 * 记录一次事件。
 *
 * 失败只记 error 日志，绝不向上抛 —— 埋点是观测手段，不是业务流程的一环。
 */
export async function trackEvent(name: AnalyticsEventName, input: TrackInput = {}): Promise<void> {
  if (!hasDatabaseUrl()) return

  try {
    const db = getDb()
    await db.insert(analyticsEvents).values({
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      eventName: name,
      occurredAt: input.occurredAt ?? new Date(),
      // 兜底脱敏：即使调用方误传了整个对象，也不会把简历原文写进事件表
      properties: (redactFields(input.properties ?? {}) ?? {}) as Record<string, unknown>,
    })
  } catch (error) {
    console.error('[analytics] 写入事件失败', { event: name, error })
  }
}

/**
 * 分数分段 —— METRICS.md §2.2 要求用分段而非精确分。
 *
 * 精确分留在业务表（reports / evaluations）里，事件表只留分档，
 * 目的就是让事件表即使被读到也无法还原个人能力画像。
 */
export function scoreBucket(score: number | null | undefined): string | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null
  if (score < 60) return '0-59'
  if (score < 75) return '60-74'
  if (score < 90) return '75-89'
  return '90-100'
}
