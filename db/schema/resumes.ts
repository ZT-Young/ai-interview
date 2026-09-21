import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { parseStatusEnum } from './enums'
import { users } from './users'

/**
 * resumes —— 简历（文件 + 解析文本 + 结构化信息）
 * 见 docs/DATA_MODEL.md §3.2。
 */
export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    fileName: varchar('file_name', { length: 255 }).notNull(),
    /** pdf / docx / doc / png / jpg / jpeg */
    fileType: varchar('file_type', { length: 20 }).notNull(),
    fileSize: integer('file_size').notNull(),
    /** S3 对象 key（服务端加密存储，AGENTS.md §7 C3） */
    storageKey: text('storage_key').notNull(),

    /** 抽取的原始文本 */
    rawText: text('raw_text'),
    /** 结构化信息；JSON Schema 见 docs/AI_PROMPTS.md（待创建），当前视为不稳定契约 */
    parsedData: jsonb('parsed_data'),
    parseStatus: parseStatusEnum('parse_status').notNull().default('pending'),
    parseError: text('parse_error'),
    /**
     * 抽取元信息：source / text_length / page_count / vision_used /
     * low_confidence_fields / prompt_version / attempts / truncated
     * 见 docs/AI_PROMPTS.md §4.2。
     */
    extractionMeta: jsonb('extraction_meta'),

    isPrimary: boolean('is_primary').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('resumes_user_id_idx').on(table.userId, table.createdAt),
    parseStatusIdx: index('resumes_parse_status_idx').on(table.parseStatus),
    // 每个用户至多一份默认简历
    userPrimaryUnique: uniqueIndex('resumes_user_primary_unique')
      .on(table.userId)
      .where(sql`${table.isPrimary} AND ${table.deletedAt} IS NULL`),
    fileSizeCheck: check('resumes_file_size_positive', sql`${table.fileSize} > 0`),
  }),
)

export type Resume = typeof resumes.$inferSelect
export type NewResume = typeof resumes.$inferInsert
