import { and, desc, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { resumes } from '@/db/schema'
import { internalError, notFound } from '@/lib/api/errors'
import { ownedByActive } from '@/lib/api/ownership'

import type { CreateResumeInput, UpdateResumeInput } from '@/lib/validators/resume'

/**
 * 简历服务 —— ③ 领域服务层。
 *
 * 所有读写的 WHERE 条件都由 ownedByActive() 生成，**同时包含 id 与 user_id**，
 * 使跨用户访问在查询层就不可能命中（返回 notFound → HTTP 404）。
 */

export type ResumeView = {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  storageKey: string
  rawText: string | null
  parsedData: unknown
  parseStatus: string
  parseError: string | null
  extractionMeta: unknown
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

function toView(row: typeof resumes.$inferSelect): ResumeView {
  return {
    id: row.id,
    fileName: row.fileName,
    fileType: row.fileType,
    fileSize: row.fileSize,
    storageKey: row.storageKey,
    rawText: row.rawText,
    parsedData: row.parsedData,
    parseStatus: row.parseStatus,
    parseError: row.parseError,
    extractionMeta: row.extractionMeta,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listResumes(
  userId: string,
  page: { limit: number; offset: number },
): Promise<{ items: ResumeView[]; total: number }> {
  const db = getDb()
  const rows = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), isNull(resumes.deletedAt)))
    .orderBy(desc(resumes.createdAt))
    .limit(page.limit)
    .offset(page.offset)

  const all = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.userId, userId), isNull(resumes.deletedAt)))

  return { items: rows.map(toView), total: all.length }
}

export async function getResume(userId: string, id: string): Promise<ResumeView> {
  const db = getDb()
  const rows = await db
    .select()
    .from(resumes)
    .where(ownedByActive(resumes, id, userId))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('简历不存在')
  return toView(row)
}

export async function createResume(
  userId: string,
  input: CreateResumeInput,
): Promise<ResumeView> {
  const db = getDb()
  const isPrimary = input.isPrimary ?? false

  return db.transaction(async (tx) => {
    // 每用户至多一份默认简历：先取消其他默认
    if (isPrimary) {
      await tx
        .update(resumes)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(resumes.userId, userId), eq(resumes.isPrimary, true)))
    }

    const inserted = await tx
      .insert(resumes)
      .values({
        userId,
        fileName: input.fileName,
        fileType: input.fileType,
        fileSize: input.fileSize,
        storageKey: input.storageKey,
        isPrimary,
      })
      .returning()

    const row = inserted[0]
    if (!row) throw internalError('简历创建失败')
    return toView(row)
  })
}

export async function updateResume(
  userId: string,
  id: string,
  input: UpdateResumeInput,
): Promise<ResumeView> {
  const db = getDb()

  return db.transaction(async (tx) => {
    // 先确认归属，避免「更新了别人的资源」或泄露存在性
    const existing = await tx
      .select({ id: resumes.id })
      .from(resumes)
      .where(ownedByActive(resumes, id, userId))
      .limit(1)
    if (!existing[0]) throw notFound('简历不存在')

    if (input.isPrimary === true) {
      await tx
        .update(resumes)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(resumes.userId, userId), eq(resumes.isPrimary, true)))
    }

    const updated = await tx
      .update(resumes)
      .set({
        ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
        ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
        ...(input.parsedData !== undefined ? { parsedData: input.parsedData } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        updatedAt: new Date(),
      })
      .where(ownedByActive(resumes, id, userId))
      .returning()

    const row = updated[0]
    if (!row) throw notFound('简历不存在')
    return toView(row)
  })
}

/** 软删除（AGENTS.md §7 C3）。S3 对象清理在后续 Phase 的清理任务中完成。 */
export async function deleteResume(userId: string, id: string): Promise<void> {
  const db = getDb()
  const deleted = await db
    .update(resumes)
    .set({ deletedAt: new Date(), isPrimary: false, updatedAt: new Date() })
    .where(ownedByActive(resumes, id, userId))
    .returning({ id: resumes.id })

  if (!deleted[0]) throw notFound('简历不存在')
}

/** 供会话服务校验「传入的简历确实属于当前用户」 */
export async function requireOwnedResume(userId: string, id: string): Promise<void> {
  const db = getDb()
  const rows = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(ownedByActive(resumes, id, userId))
    .limit(1)
  if (!rows[0]) throw notFound('简历不存在')
}

/**
 * 写入解析结果（成功或失败）。
 *
 * 失败时**必须保留 rawText**，用户才能手动修改（AGENTS.md §2 第 4 步）。
 * parseError 存面向用户的中文提示（见 docs/AI_PROMPTS.md §4.3）。
 */
export async function updateParseState(
  userId: string,
  id: string,
  input: {
    parseStatus: 'pending' | 'processing' | 'success' | 'failed'
    rawText?: string | null
    parsedData?: unknown
    parseError?: string | null
    extractionMeta?: unknown
  },
): Promise<ResumeView> {
  const db = getDb()
  const updated = await db
    .update(resumes)
    .set({
      parseStatus: input.parseStatus,
      ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
      ...(input.parsedData !== undefined ? { parsedData: input.parsedData } : {}),
      ...(input.parseError !== undefined ? { parseError: input.parseError } : {}),
      ...(input.extractionMeta !== undefined ? { extractionMeta: input.extractionMeta } : {}),
      updatedAt: new Date(),
    })
    .where(ownedByActive(resumes, id, userId))
    .returning()

  const row = updated[0]
  if (!row) throw notFound('简历不存在')
  return toView(row)
}
