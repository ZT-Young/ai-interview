import { inet, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

import { consentTypeEnum } from './enums'
import { users } from './users'

/**
 * consents —— 同意记录（AGENTS.md §7 C1/C2）
 * 见 docs/engineering/DATA_MODEL.md §3.12。未同意不得创建面试会话。
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

/**
 * 当前条款版本；条款内容变更时必须同步更新此常量以重新征得同意。
 *
 * v2：隐私政策新增行为埋点章节（处理目的变更），必须与
 * `lib/legal/documents.ts` 的 `LEGAL_VERSION` 保持一致 —— 两处不一致会出现
 * 「用户同意的是 v1、展示的却是 v2」的合规缺口。
 */
export const CURRENT_CONSENT_VERSION = 'v2'
