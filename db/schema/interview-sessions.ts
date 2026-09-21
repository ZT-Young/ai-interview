import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import {
  MAX_QUESTION_DEPTH,
  messageRoleEnum,
  messageTypeEnum,
  orchestrationPhaseEnum,
  questionSourceEnum,
  questionTypeEnum,
  scoreDimensionEnum,
  sessionStatusEnum,
} from './enums'
import { jobJds } from './job-jds'
import { resumes } from './resumes'
import { users } from './users'

/**
 * interview_sessions —— 面试会话
 * 见 docs/DATA_MODEL.md §3.4。状态迁移规则由 lib/services/session-service.ts 强制。
 */
export const interviewSessions = pgTable(
  'interview_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SET NULL：用户删除简历/JD 时保留会话历史
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    jobJdId: uuid('job_jd_id').references(() => jobJds.id, { onDelete: 'set null' }),

    status: sessionStatusEnum('status').notNull().default('draft'),
    /**
     * 编排阶段（微观）。与 status 的区别见 docs/ARCHITECTURE.md §3.6.1。
     * 面试未开始时为 IDLE；开始后由 orchestration-service 推进。
     */
    phase: orchestrationPhaseEnum('phase').notNull().default('IDLE'),
    /** 当前正在提问/等待回答的题目；用于恢复中断的面试 */
    currentQuestionId: uuid('current_question_id'),
    phaseUpdatedAt: timestamp('phase_updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** 面试配置：{ durationMin, maxQuestions, difficulty } */
    config: jsonb('config').notNull().default({}),
    matchAnalysis: jsonb('match_analysis'),
    /** 面试计划（各环节题目配额） */
    plan: jsonb('plan'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userStatusIdx: index('sessions_user_status_idx').on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    userCreatedIdx: index('sessions_user_created_idx').on(table.userId, table.createdAt),
    // 完成态必须有结束时间
    finishedAtCheck: check(
      'sessions_finished_at_required',
      sql`${table.status} <> 'completed' OR ${table.finishedAt} IS NOT NULL`,
    ),
  }),
)

/**
 * questions —— 问题（含追问链）
 * 见 docs/DATA_MODEL.md §3.5。
 *
 * depth：主问题 0，追问 1，追问的追问 2 —— 上限 2 由 CHECK 约束兜底（AGENTS.md §2 第 7 步）。
 * rootId：指向所属主问题，使「每道主问题最多 2 层追问」可在 SQL 层按组校验。
 */
export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => interviewSessions.id, { onDelete: 'cascade' }),
    /** 追问父级；主问题为 NULL */
    parentId: uuid('parent_id').references((): AnyPgColumn => questions.id, {
      onDelete: 'cascade',
    }),
    /** 所属主问题；主问题自身为 NULL。使「每主问题最多 2 层追问」可按组校验 */
    rootId: uuid('root_id').references((): AnyPgColumn => questions.id, {
      onDelete: 'cascade',
    }),

    depth: smallint('depth').notNull().default(0),
    /** 会话内展示顺序（含追问，全局递增） */
    orderIndex: smallint('order_index').notNull(),

    type: questionTypeEnum('type').notNull(),
    source: questionSourceEnum('source').notNull(),
    content: text('content').notNull(),
    /** 考察意图（简短说明），便于生成反馈 */
    intent: text('intent'),
    /**
     * 考察维度 —— 复用六维枚举（AGENTS.md §6.2），
     * 与 Phase 4 的 evaluations.dimension_scores 天然对齐。
     * 见 docs/AI_PROMPTS.md §4.2。
     */
    dimension: scoreDimensionEnum('dimension').notNull(),
    /** 期望要点：["...", "..."]（2-5 条），供候选人自查 */
    expectedPoints: jsonb('expected_points').notNull().default([]),
    /** 该题是否允许追问；false 时追问链深度上限为 0 */
    followUpAllowed: boolean('follow_up_allowed').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionOrderUnique: uniqueIndex('questions_session_order_unique').on(
      table.sessionId,
      table.orderIndex,
    ),
    sessionIdx: index('questions_session_idx').on(table.sessionId, table.orderIndex),
    rootIdx: index('questions_root_idx').on(table.rootId, table.depth),
    depthRangeCheck: check(
      'questions_depth_range',
      sql`${table.depth} >= 0 AND ${table.depth} <= ${sql.raw(String(MAX_QUESTION_DEPTH))}`,
    ),
    depthParentCheck: check(
      'questions_depth_parent_consistent',
      sql`(${table.depth} = 0 AND ${table.parentId} IS NULL) OR (${table.depth} > 0 AND ${table.parentId} IS NOT NULL)`,
    ),
  }),
)

/**
 * answers —— 用户回答
 * 见 docs/DATA_MODEL.md §3.6。user_id 为冗余归属列，用于免 JOIN 权限校验。
 */
export const answers = pgTable(
  'answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 回答正文（语音时为 ASR 转写文本） */
    content: text('content').notNull(),
    source: text('source').notNull().default('text'),
    /** 语音原件 key，保留以便复查 */
    audioStorageKey: text('audio_storage_key'),
    /** 回答耗时（毫秒） */
    durationMs: integer('duration_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 一题一答（V1 不支持重复作答）
    questionUnique: uniqueIndex('answers_question_unique').on(table.questionId),
    userIdx: index('answers_user_idx').on(table.userId),
    durationCheck: check(
      'answers_duration_non_negative',
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`,
    ),
    sourceCheck: check('answers_source_valid', sql`${table.source} IN ('text', 'voice')`),
  }),
)

export type InterviewSession = typeof interviewSessions.$inferSelect
export type NewInterviewSession = typeof interviewSessions.$inferInsert
export type Question = typeof questions.$inferSelect
export type NewQuestion = typeof questions.$inferInsert
export type Answer = typeof answers.$inferSelect
export type NewAnswer = typeof answers.$inferInsert

/**
 * interview_messages —— 面试对话的**全部消息**
 * 见 docs/ARCHITECTURE.md §3.6.4。
 *
 * 与 answers 的分工：
 * - 本表存 AI 与用户的每条消息（提问/追问/提示/系统提示/回答/跳过），用于完整回溯；
 * - `answers` 仍是**用户回答的权威表**（question_id 唯一），供评分与报告使用。
 */
export const interviewMessages = pgTable(
  'interview_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => interviewSessions.id, { onDelete: 'cascade' }),
    /** 关联题目；系统提示等可为空 */
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'cascade' }),

    role: messageRoleEnum('role').notNull(),
    type: messageTypeEnum('type').notNull(),
    content: text('content').notNull(),

    /** 追问原因（仅 follow_up 消息有值） */
    followUpReason: varchar('follow_up_reason', { length: 20 }),
    /** 追问依据的回答片段（模型输出的 focus） */
    focus: text('focus'),
    /** 附加信息：模型名、prompt 版本、被过滤项等 */
    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 按时间回放整场对话
    sessionCreatedIdx: index('interview_messages_session_created_idx').on(
      table.sessionId,
      table.createdAt,
    ),
    questionIdx: index('interview_messages_question_idx').on(table.questionId),
  }),
)

export type InterviewMessage = typeof interviewMessages.$inferSelect
export type NewInterviewMessage = typeof interviewMessages.$inferInsert
