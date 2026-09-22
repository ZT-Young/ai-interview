import { sql } from 'drizzle-orm'
import {
  check,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * sessions —— 登录会话（注意：业务面试会话是 interview_sessions，两者不可混用）
 * 见 docs/engineering/DATA_MODEL.md §3.11。
 *
 * Cookie 中保存明文 token，本表只保存其 HMAC 哈希，库被读取也无法直接冒用会话。
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** token 的 HMAC-SHA256 哈希（hex） */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 退出登录时置位，实现立即失效 */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    userIdx: index('sessions_user_idx').on(table.userId),
    expiresIdx: index('sessions_expires_idx').on(table.expiresAt),
    // 会话必须晚于创建时间失效
    expiresAfterCreatedCheck: check(
      'sessions_expires_after_created',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  }),
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
