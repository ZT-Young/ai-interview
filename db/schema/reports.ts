import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { interviewSessions } from './interview-sessions'
import { users } from './users'

/**
 * reports —— 总报告
 * 见 docs/engineering/DATA_MODEL.md §3.8。
 *
 * 四要素（highlights / issues / reference_answers / next_steps）为 NOT NULL
 * —— 强制满足 AGENTS.md §6.1 N7「报告必须区分亮点、问题、参考回答、下一步建议」。
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => interviewSessions.id, { onDelete: 'cascade' }),
    /** 冗余归属列，用于免 JOIN 权限校验 */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 总分 0–100 */
    totalScore: numeric('total_score', { precision: 5, scale: 1 }).notNull(),
    /** 六维汇总分，每项 0–5 */
    dimensionScores: jsonb('dimension_scores').notNull(),

    /** 免费可见 */
    highlights: jsonb('highlights').notNull().default([]),
    /** 付费解锁 */
    issues: jsonb('issues').notNull().default([]),
    /** 付费解锁 */
    referenceAnswers: jsonb('reference_answers').notNull().default([]),
    /** 付费解锁 */
    nextSteps: jsonb('next_steps').notNull().default([]),
    /** 简历疑点（来自简历解析的 risks，仅归纳不得新增）—— docs/engineering/AI_PROMPTS.md §7 */
    resumeRisks: jsonb('resume_risks').notNull().default([]),
    summary: text('summary'),

    /** 付费解锁标记；权威值见 payments 表 */
    isUnlocked: boolean('is_unlocked').notNull().default(false),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionUnique: uniqueIndex('reports_session_unique').on(table.sessionId),
    userIdx: index('reports_user_idx').on(table.userId, table.createdAt),
    scoreRangeCheck: check(
      'reports_total_score_range',
      sql`${table.totalScore} >= 0 AND ${table.totalScore} <= 100`,
    ),
    highlightsArrayCheck: check(
      'reports_highlights_array',
      sql`jsonb_typeof(${table.highlights}) = 'array'`,
    ),
    issuesArrayCheck: check('reports_issues_array', sql`jsonb_typeof(${table.issues}) = 'array'`),
    referenceAnswersArrayCheck: check(
      'reports_reference_answers_array',
      sql`jsonb_typeof(${table.referenceAnswers}) = 'array'`,
    ),
    nextStepsArrayCheck: check(
      'reports_next_steps_array',
      sql`jsonb_typeof(${table.nextSteps}) = 'array'`,
    ),
    resumeRisksArrayCheck: check(
      'reports_resume_risks_array',
      sql`jsonb_typeof(${table.resumeRisks}) = 'array'`,
    ),
  }),
)

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
