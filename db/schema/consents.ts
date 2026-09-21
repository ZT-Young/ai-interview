import { inet, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

import { consentTypeEnum } from './enums'
import { users } from './users'

/**
 * consents —— 同意记录（AGENTS.md §7 C1/C2）
 * 见 docs/DATA_MODEL.md §3.12。未同意不得创建面试会话。
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consentType: consentTypeEnum('consent_type').notNull(),
    /** 条款版本号 */
    version: varchar('version', { length: 20 }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet('ip'),
  },
  (table) => ({
    userTypeVersionUnique: uniqueIndex('consents_user_type_version_unique').on(
      table.userId,
      table.consentType,
      table.version,
    ),
  }),
)

export type Consent = typeof consents.$inferSelect
export type NewConsent = typeof consents.$inferInsert

/** 当前条款版本；条款内容变更时必须同步更新此常量以重新征得同意 */
export const CURRENT_CONSENT_VERSION = 'v1'
