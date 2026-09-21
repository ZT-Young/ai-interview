import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * ai_call_logs —— AI 调用与错误日志（合并为一张表）
 *
 * 为什么合并：两者字段高度重合，错误只是 `status = 'error'` 的行；
 * 拆两张表会带来同步问题（一次失败调用要不要写两处）。
 *
 * **PII 最小化（硬要求）**：
 * - 绝不记录简历/JD 原文、提示词全文、模型响应全文
 * - 只记元数据：操作类型、模型、耗时、token 用量、错误摘要
 * - `error_message` 写入前由 `sanitizeLogText()` 截断并剔除换行，避免整段 prompt 泄漏
 */
export const aiCallLogs = pgTable(
  'ai_call_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 发起用户；系统级调用可为空 */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    /** 业务操作：parse_jd / parse_resume / match / plan / follow_up / hint / evaluate / report */
    operation: varchar('operation', { length: 40 }).notNull(),
    /** 模型标识（来自 LLM_MODEL，非密钥） */
    model: varchar('model', { length: 100 }),
    status: varchar('status', { length: 16 }).notNull(),

    durationMs: integer('duration_ms'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),

    /** 关联资源，便于从日志跳转到具体会话/报告 */
    sessionId: uuid('session_id'),

    errorCode: varchar('error_code', { length: 40 }),
    /** 已脱敏/截断的错误摘要（见 sanitizeLogText） */
    errorMessage: text('error_message'),

    promptVersion: varchar('prompt_version', { length: 30 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdIdx: index('ai_call_logs_created_idx').on(table.createdAt),
    statusIdx: index('ai_call_logs_status_idx').on(table.status, table.createdAt),
    operationIdx: index('ai_call_logs_operation_idx').on(table.operation, table.createdAt),
    userIdx: index('ai_call_logs_user_idx').on(table.userId, table.createdAt),
  }),
)

export type AiCallLog = typeof aiCallLogs.$inferSelect
export type NewAiCallLog = typeof aiCallLogs.$inferInsert

/** 日志文本上限（字符） */
export const LOG_TEXT_MAX_LENGTH = 500

/**
 * 日志文本脱敏：去除换行、截断超长内容。
 *
 * 防止上游把整段 prompt 或响应体塞进错误信息 —— 那是把用户简历原文写进日志的常见路径。
 *
 * 对象会被 JSON 序列化而不是 `String()`：否则得到 `[object Object]`，
 * 日志里完全看不出错误内容。
 */
export function sanitizeLogText(value: unknown): string | null {
  if (value === null || value === undefined) return null

  let text: string
  if (typeof value === 'string') {
    text = value
  } else if (typeof value === 'object') {
    try {
      text = JSON.stringify(value) ?? ''
    } catch {
      // 循环引用等无法序列化的情况：退回类型名，避免抛错
      text = '[unserializable]'
    }
  } else {
    text = String(value)
  }

  const singleLine = text.replace(/\s+/g, ' ').trim()
  if (singleLine.length === 0) return null

  return singleLine.length > LOG_TEXT_MAX_LENGTH
    ? `${singleLine.slice(0, LOG_TEXT_MAX_LENGTH)}…`
    : singleLine
}
