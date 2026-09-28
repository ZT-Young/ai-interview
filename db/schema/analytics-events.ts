import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * analytics_events —— 产品行为埋点
 *
 * 契约见 docs/product/METRICS.md §2（事件表结构与五个事件的定义）。
 * 该文档是本表的**设计真源**，字段与索引不得与它冲突。
 *
 * 三条硬约束（对应 METRICS.md §1 埋点原则）：
 *
 * 1. **PII 最小化**：properties 只放行为与元数据，
 *    禁止放简历原文、作答内容、邮箱、令牌。分数用**分段**
 *    （total_score_bucket）而不是精确分，避免事件表变成「用户能力画像」。
 * 2. **服务端权威**：关键事件只在服务端记录，不接受前端上报作为权益依据。
 *    `pay_checkout_clicked` 是唯一的前端上报事件（点击只发生在浏览器），
 *    但它不参与任何权益判定。
 * 3. **只增不改**：事件写入后不可更新、不可删除（与审计日志同策略），
 *    因此表上没有 updated 语义，也不要为它写 UPDATE 路径。
 */

/** 事件名白名单 —— 与 METRICS.md §2.2 一一对应，新增事件必须同步文档 */
export const ANALYTICS_EVENTS = [
  'interview_started',
  'interview_completed',
  'report_viewed',
  'pay_checkout_clicked',
  'payment_succeeded',
] as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number]

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** 关联面试会话；非会话类事件（如 pay_checkout_clicked）可为空 */
    sessionId: uuid('session_id'),

    eventName: varchar('event_name', { length: 40 }).notNull(),

    /**
     * 服务端时间，不用前端时间（防篡改）。
     * occurred_at 与 created_at 分开：前者是业务发生时刻（可由调用方指定，
     * 例如报告生成完但晚些才写入），后者是落库时刻。
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    /** 事件属性（禁止放 PII） */
    properties: jsonb('properties').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventIdx: index('analytics_events_event_idx').on(table.eventName, table.occurredAt),
    userIdx: index('analytics_events_user_idx').on(table.userId, table.occurredAt),
    sessionIdx: index('analytics_events_session_idx').on(table.sessionId),
  }),
)

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert
