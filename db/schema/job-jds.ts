import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { parseStatusEnum } from './enums'
import { users } from './users'

/**
 * job_jds —— 岗位 JD
 * 见 docs/DATA_MODEL.md §3.3。
 */
export const jobJds = pgTable(
  'job_jds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 200 }),
    company: varchar('company', { length: 200 }),
    sourceUrl: text('source_url'),

    /** JD 原文（粘贴或从文件抽取） */
    rawText: text('raw_text').notNull(),
    /** 结构化要求；JSON Schema 见 docs/AI_PROMPTS.md（待创建） */
    parsedData: jsonb('parsed_data'),
    parseStatus: parseStatusEnum('parse_status').notNull().default('pending'),
    parseError: text('parse_error'),
    /** 抽取元信息，见 docs/AI_PROMPTS.md §4.2 */
    extractionMeta: jsonb('extraction_meta'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('job_jds_user_id_idx').on(table.userId, table.createdAt),
    parseStatusIdx: index('job_jds_parse_status_idx').on(table.parseStatus),
  }),
)

export type JobJd = typeof jobJds.$inferSelect
export type NewJobJd = typeof jobJds.$inferInsert
