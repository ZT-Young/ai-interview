import { index, inet, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * audit_logs —— 审计日志（AGENTS.md §7 C6）
 * 见 docs/engineering/DATA_MODEL.md §3.10。
 *
 * 禁止在 metadata 中写入密码、令牌明文或个人敏感信息。
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 操作用户；系统操作可为空 */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** 如 auth.register / auth.login / auth.logout / user.delete */
    action: varchar('action', { length: 60 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: uuid('target_id'),
    metadata: text('metadata').notNull().default('{}'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorIdx: index('audit_logs_actor_idx').on(table.actorId, table.createdAt),
    actionIdx: index('audit_logs_action_idx').on(table.action, table.createdAt),
  }),
)

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
