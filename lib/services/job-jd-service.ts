import { and, desc, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { jobJds } from '@/db/schema'
import { internalError, notFound } from '@/lib/api/errors'
import { ownedByActive } from '@/lib/api/ownership'

import type { CreateJobJdInput, UpdateJobJdInput } from '@/lib/validators/job-jd'

/**
 * 岗位 JD 服务 —— ③ 领域服务层。
 * 权限模型与简历服务一致：查询条件一律包含 user_id。
 */

export type JobJdView = {
  id: string
  title: string | null
  company: string | null
  sourceUrl: string | null
  rawText: string
  parsedData: unknown
  parseStatus: string
  parseError: string | null
  extractionMeta: unknown
  createdAt: string
  updatedAt: string
}

function toView(row: typeof jobJds.$inferSelect): JobJdView {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    sourceUrl: row.sourceUrl,
    rawText: row.rawText,
    parsedData: row.parsedData,
    parseStatus: row.parseStatus,
    parseError: row.parseError,
    extractionMeta: row.extractionMeta,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listJobJds(
  userId: string,
  page: { limit: number; offset: number },
): Promise<{ items: JobJdView[]; total: number }> {
  const db = getDb()
  const rows = await db
    .select()
    .from(jobJds)
    .where(and(eq(jobJds.userId, userId), isNull(jobJds.deletedAt)))
    .orderBy(desc(jobJds.createdAt))
    .limit(page.limit)
    .offset(page.offset)

  const all = await db
    .select({ id: jobJds.id })
    .from(jobJds)
    .where(and(eq(jobJds.userId, userId), isNull(jobJds.deletedAt)))

  return { items: rows.map(toView), total: all.length }
}

export async function getJobJd(userId: string, id: string): Promise<JobJdView> {
  const db = getDb()
  const rows = await db
    .select()
    .from(jobJds)
    .where(ownedByActive(jobJds, id, userId))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('岗位 JD 不存在')
  return toView(row)
}

export async function createJobJd(userId: string, input: CreateJobJdInput): Promise<JobJdView> {
  const db = getDb()
  const inserted = await db
    .insert(jobJds)
    .values({
      userId,
      rawText: input.rawText,
      title: input.title ?? null,
      company: input.company ?? null,
      sourceUrl: input.sourceUrl ?? null,
    })
    .returning()

  const row = inserted[0]
  if (!row) throw internalError('岗位 JD 创建失败')
  return toView(row)
}

export async function updateJobJd(
  userId: string,
  id: string,
  input: UpdateJobJdInput,
): Promise<JobJdView> {
  const db = getDb()
  const updated = await db
    .update(jobJds)
    .set({
      ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.company !== undefined ? { company: input.company } : {}),
      ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.parsedData !== undefined ? { parsedData: input.parsedData } : {}),
      updatedAt: new Date(),
    })
    .where(ownedByActive(jobJds, id, userId))
    .returning()

  const row = updated[0]
  if (!row) throw notFound('岗位 JD 不存在')
  return toView(row)
}

export async function deleteJobJd(userId: string, id: string): Promise<void> {
  const db = getDb()
  const deleted = await db
    .update(jobJds)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(ownedByActive(jobJds, id, userId))
    .returning({ id: jobJds.id })

  if (!deleted[0]) throw notFound('岗位 JD 不存在')
}

/** 供会话服务校验归属 */
export async function requireOwnedJobJd(userId: string, id: string): Promise<void> {
  const db = getDb()
  const rows = await db
    .select({ id: jobJds.id })
    .from(jobJds)
    .where(ownedByActive(jobJds, id, userId))
    .limit(1)
  if (!rows[0]) throw notFound('岗位 JD 不存在')
}

/** 写入解析结果（成功或失败），失败时保留 rawText 供用户手动修改 */
export async function updateParseState(
  userId: string,
  id: string,
  input: {
    parseStatus: 'pending' | 'processing' | 'success' | 'failed'
    title?: string | null
    company?: string | null
    rawText?: string
    parsedData?: unknown
    parseError?: string | null
    extractionMeta?: unknown
  },
): Promise<JobJdView> {
  const db = getDb()
  const updated = await db
    .update(jobJds)
    .set({
      parseStatus: input.parseStatus,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.company !== undefined ? { company: input.company } : {}),
      ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
      ...(input.parsedData !== undefined ? { parsedData: input.parsedData } : {}),
      ...(input.parseError !== undefined ? { parseError: input.parseError } : {}),
      ...(input.extractionMeta !== undefined ? { extractionMeta: input.extractionMeta } : {}),
      updatedAt: new Date(),
    })
    .where(ownedByActive(jobJds, id, userId))
    .returning()

  const row = updated[0]
  if (!row) throw notFound('岗位 JD 不存在')
  return toView(row)
}
