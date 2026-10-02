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

import { membershipLevelEnum, userRoleEnum } from './enums'

/**
 * users —— 用户
 * 字段、约束与索引见 docs/engineering/DATA_MODEL.md §3.1。
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * 登录凭证，存小写规范化值。
     *
     * **可空**：支持纯手机号注册（验证码登录）的用户，这类账号没有邮箱。
     * 「至少要有邮箱或手机号之一」由下方 `users_credential_present` 检查约束保证。
     */
    email: varchar('email', { length: 255 }),
    /**
     * scrypt 哈希，格式见 lib/auth/password.ts。禁止明文。
     *
     * **可空**：手机号 + 验证码注册的用户可以不设密码，之后只能用验证码登录。
     * 前端在「密码登录」模式下遇到空密码应引导改用验证码（不暴露账号是否存在）。
     */
    passwordHash: text('password_hash'),
    /** 手机号（中国大陆 11 位），可空；用于验证码注册/登录 */
    phone: varchar('phone', { length: 20 }),
    /** 手机号验证时间；NULL 表示尚未验证 */
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    /**
     * 用户名：既用于展示，也可作为登录标识（与邮箱、手机号并列）。
     * 注册时自动生成默认值（手机号用户取尾号四位，其余随机四位），用户可自行修改。
     */
    username: varchar('username', { length: 50 }),
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
     * 产品身份（B 端，DATA_MODEL §2.10）。**V1 为单值列 + 自助切换**：
     * 一个自然人可能同时是求职者与面试官，完整方案是 `organizations + memberships`，
     * 但那需要重写三张主表的归属列与全部查询，V1 收益不足，取舍记录见
     * docs/design/INTERVIEWER_SIDE.md §3。
     *
     * 与 `isAdmin` **正交**：这里管「能用哪一侧的功能」，那边管「能不能进后台」。
     */
    role: userRoleEnum('role').notNull().default('candidate'),

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
    // 软删除后邮箱可复用（NULL 在 Postgres 唯一索引中互不冲突，故纯手机号用户可共存）
    emailUnique: uniqueIndex('users_email_unique')
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    // 手机号与用户名同样只在「未软删除」范围内唯一
    phoneUnique: uniqueIndex('users_phone_unique')
      .on(table.phone)
      .where(sql`${table.deletedAt} IS NULL`),
    usernameUnique: uniqueIndex('users_username_unique')
      .on(table.username)
      .where(sql`${table.deletedAt} IS NULL`),
    membershipIdx: index('users_membership_idx').on(table.membership),
    createdAtIdx: index('users_created_at_idx').on(table.createdAt),
    freeCreditsCheck: check('users_free_credits_non_negative', sql`${table.freeCredits} >= 0`),
    /**
     * 至少要有一个登录标识：否则账号无法被寻址（既不能找回也不能登录）。
     * 邮箱与手机号都已可空，这条约束是唯一兜底。
     */
    credentialPresent: check(
      'users_credential_present',
      sql`${table.email} IS NOT NULL OR ${table.phone} IS NOT NULL`,
    ),
  }),
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
