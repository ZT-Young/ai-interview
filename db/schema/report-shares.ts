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

import { shareKindEnum, shareStatusEnum, shareVisibilityEnum } from './enums'
import { interviewSessions } from './interview-sessions'
import { users } from './users'

/**
 * report_shares —— 候选人主动授权的报告分享（B 端场景 A）。
 *
 * 字段、约束与索引见 docs/engineering/DATA_MODEL.md §3.14，
 * 业务规格见 docs/design/INTERVIEWER_SIDE.md §4。
 *
 * **存在的唯一合法前提**：候选人亲手创建（link）或亲手接受邀请（invite）。
 * 系统不得替候选人自动开放 —— 那是替他做同意决定（AGENTS.md §7 C1）。
 */
export const reportShares = pgTable(
  'report_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** 候选人，即数据主人。所有分享列表与越权校验都锚在这一列 */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * 被分享的那一场面试（报告按 session 查，见 report-service）。
     *
     * **邀请模式下可空**：面试官发起邀请时并不知道候选人练过哪几场
     * （B 端 V1 没有岗位/候选人列表能力），因此要等候选人在接受时挑一场，才写入本列。
     * 「active 必须有 session」由下方 CHECK 兜住，不存在悬空的生效分享。
     */
    sessionId: uuid('session_id').references(() => interviewSessions.id, { onDelete: 'cascade' }),

    kind: shareKindEnum('kind').notNull(),
    status: shareStatusEnum('status').notNull(),

    /**
     * 链接模式的访问令牌 —— **只存 sha256 哈希**，原文仅在返回给候选人的那一刻出现一次（同理会话令牌）。
     * 邀请模式为 NULL：走「受邀人 = `invitedByUserId`」的身份校验，不靠令牌。
     */
    tokenHash: text('token_hash'),
    /**
     * **最终获得查看权的人 = 面试官**（请求方），邀请模式下由其发起、候选人接受后生效。
     *
     * 命名易错提示：`owner_id` 是数据主人（候选人），这一列是**拿到查看权的一方**。
     * 两种模式都用它做访问校验：
     * - invite：必须 `inviteeUserId = 当前登录用户`，否则链接被转发即可越权
     * - link：为 NULL（谁持令牌谁可看，除非另设了访问码）
     */
    inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * 邀请模式下**用于定位候选人**的标识原文（邮箱 / 手机号 / 用户名）。
     *
     * 保留它有两个用途：一是用户还没注册时可据此重发邀请；
     * 二是审计需要留住「面试官当时填的是什么」，事后对得上账。
     */
    inviteeIdentifier: varchar('invitee_identifier', { length: 255 }),

    /** 由**候选人**决定给对方看多少，与付费墙无关 */
    visibility: shareVisibilityEnum('visibility').notNull().default('summary'),
    /** 候选人附言，展示给对方；不得用于承载录用相关表述（前端也不提供那种输入） */
    note: varchar('note', { length: 200 }),

    /** 可选访问码，**只存哈希**；防止链接被转发后无门槛裸奔 */
    accessCodeHash: text('access_code_hash'),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** 撤销时间：优先级高于 expiresAt */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    /** 候选人接受/拒绝邀请的时间 */
    respondedAt: timestamp('responded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex('report_shares_token_unique').on(table.tokenHash),
    ownerIdx: index('report_shares_owner_idx').on(table.ownerId, table.createdAt),
    inviteeIdx: index('report_shares_invitee_idx').on(table.inviteeUserId, table.createdAt),
    viewCountCheck: check('report_shares_view_count_non_negative', sql`${table.viewCount} >= 0`),
    /** 链接模式必须能凭令牌寻址，否则这条分享永远打不开 */
    linkNeedsToken: check(
      'report_shares_link_needs_token',
      sql`${table.kind} <> 'link' OR ${table.tokenHash} IS NOT NULL`,
    ),
    /**
     * 邀请模式必须记录「谁能看」，否则无从做访问校验。
     * （链接模式为 NULL 是合法的：靠令牌寻址。）
     */
    inviteNeedsInvitee: check(
      'report_shares_invite_needs_invitee',
      sql`${table.kind} <> 'invite' OR ${table.inviteeUserId} IS NOT NULL`,
    ),
    /**
     * 生效中的分享必须指向具体的一场面试。
     * 邀请模式下候选人接受时才会挑 session，这条约束防止「接受了但没选报告」的悬空记录。
     */
    activeNeedsSession: check(
      'report_shares_active_needs_session',
      sql`${table.status} <> 'active' OR ${table.sessionId} IS NOT NULL`,
    ),
  }),
)

export type ReportShare = typeof reportShares.$inferSelect
export type NewReportShare = typeof reportShares.$inferInsert
