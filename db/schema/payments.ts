import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { paymentStatusEnum, unlockTypeEnum } from './enums'
import { reports } from './reports'
import { users } from './users'

/**
 * payments —— 订单、会员、次数
 * 见 docs/DATA_MODEL.md §3.9。
 *
 * 会员与次数分离（AGENTS.md §5）：unlock_type 决定授予方式，
 * report → 解锁单份报告；package → 累加 users.free_credits；subscription → 升级 users.membership。
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** unlock_type='report' 时必填 */
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),

    unlockType: unlockTypeEnum('unlock_type').notNull(),
    /** 以「分」为单位的整数金额，避免浮点误差 */
    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
    status: paymentStatusEnum('status').notNull().default('pending'),

    /** 支付渠道；具体渠道为 TBD，见 docs/ARCHITECTURE.md §7 */
    provider: text('provider'),
    /** 渠道订单号，用于回调幂等 */
    providerOrderId: text('provider_order_id'),
    /** 本次授予的面试次数（package） */
    creditsGranted: integer('credits_granted').notNull().default(0),
    paidAt: timestamp('paid_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 支付回调幂等
    providerOrderUnique: uniqueIndex('payments_provider_order_unique')
      .on(table.provider, table.providerOrderId)
      .where(sql`${table.providerOrderId} IS NOT NULL`),
    // 同一报告不重复解锁
    reportUnlockUnique: uniqueIndex('payments_report_unlock_unique')
      .on(table.reportId)
      .where(sql`${table.unlockType} = 'report' AND ${table.status} = 'paid'`),
    userIdx: index('payments_user_idx').on(table.userId, table.createdAt),
    statusIdx: index('payments_status_idx').on(table.status),
    amountCheck: check('payments_amount_non_negative', sql`${table.amountCents} >= 0`),
    creditsCheck: check(
      'payments_credits_non_negative',
      sql`${table.creditsGranted} >= 0`,
    ),
    reportRequiredCheck: check(
      'payments_report_required_for_report_unlock',
      sql`${table.unlockType} <> 'report' OR ${table.reportId} IS NOT NULL`,
    ),
  }),
)

export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert
