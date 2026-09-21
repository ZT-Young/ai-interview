import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { interviewSessions, questions } from './interview-sessions'

/**
 * evaluations —— 逐题评分
 * 见 docs/DATA_MODEL.md §3.7。
 *
 * evidence_quotes 非空由 CHECK 约束强制 —— 「评分必须引用回答证据」（AGENTS.md §6.1 N6）
 * 因此在数据库层无法绕过。
 */
export const evaluations = pgTable(
  'evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => interviewSessions.id, { onDelete: 'cascade' }),

    /** 六维分：{"job_match":4,"professional":3,...}，每项 0–5 */
    dimensionScores: jsonb('dimension_scores').notNull(),
    /** 该题折算分（0–100），公式见 lib/ai/scoring.ts */
    questionScore: numeric('question_score', { precision: 4, scale: 1 }).notNull(),

    feedback: text('feedback').notNull(),
    /** 证据引用：[{"quote":"...","reason":"..."}] */
    evidenceQuotes: jsonb('evidence_quotes').notNull(),

    /**
     * 该题的**参考答案**：基于候选人真实简历经历、按 STAR 组织的示范回答。
     *
     * 与 `feedback` 里拼进去的「改进要点」语义不同：
     * - 改进要点回答「你缺什么、该怎么补」
     * - 参考答案回答「这题可以这样答」
     *
     * 可空：历史数据没有该字段，且模型未产出时不应阻塞评分落库。
     */
    referenceAnswer: text('reference_answer'),

    aiModel: varchar('ai_model', { length: 100 }),
    /** prompt 版本，供审计（AGENTS.md §7 C6） */
    promptVersion: varchar('prompt_version', { length: 30 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    questionUnique: uniqueIndex('evaluations_question_unique').on(table.questionId),
    sessionIdx: index('evaluations_session_idx').on(table.sessionId),
    scoreRangeCheck: check(
      'evaluations_question_score_range',
      sql`${table.questionScore} >= 0 AND ${table.questionScore} <= 100`,
    ),
    evidenceRequiredCheck: check(
      'evaluations_evidence_required',
      sql`jsonb_typeof(${table.evidenceQuotes}) = 'array' AND jsonb_array_length(${table.evidenceQuotes}) > 0`,
    ),
  }),
)

export type Evaluation = typeof evaluations.$inferSelect
export type NewEvaluation = typeof evaluations.$inferInsert
