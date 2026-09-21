import { sql } from 'drizzle-orm'
import {
  boolean,
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

import { membershipLevelEnum } from './enums'

/**
 * users —— 用户
 * 字段、约束与索引见 docs/DATA_MODEL.md §3.1。
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 登录凭证，存小写规范化值 */
    email: varchar('email', { length: 255 }).notNull(),
    /** scrypt 哈希，格式见 lib/auth/password.ts。禁止明文 */
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 100 }),
    avatarUrl: text('avatar_url'),

    membership: membershipLevelEnum('membership').notNull().default('free'),
    /** 剩余免费面试次数 */
    freeCredits: integer('free_credits').notNull().default(1),

    /** Phase 1 无邮件服务，留空表示待验证 */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** 同意条款时间戳（AGENTS.md §7 C1） */
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),

    /**
     * 管理员标识（管理后台访问控制）。
     *
     * **只能手动改库提升**：系统不提供任何自我提权接口，
     * 注册流程也不会接受该字段（见 lib/validators/auth.ts）。
     */
    isAdmin: boolean('is_admin').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** 软删除（AGENTS.md §7 C3），NULL 表示有效 */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // 软删除后邮箱可复用
    emailUnique: uniqueIndex('users_email_unique')
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    membershipIdx: index('users_membership_idx').on(table.membership),
    createdAtIdx: index('users_created_at_idx').on(table.createdAt),
    freeCreditsCheck: check('users_free_credits_non_negative', sql`${table.freeCredits} >= 0`),
  }),
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
