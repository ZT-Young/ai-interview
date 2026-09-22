import { and, desc, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { interviewSessions } from '@/db/schema'
import { internalError, notFound, validationError } from '@/lib/api/errors'
import { activeForUser, ownedByActive } from '@/lib/api/ownership'

import { requireOwnedJobJd } from './job-jd-service'
import { requireOwnedResume } from './resume-service'
import { assertTransition, type SessionStatus } from '../state/session'

import {
  DEFAULT_SESSION_CONFIG,
  type CreateSessionInput,
  type SessionConfig,
  type UpdateSessionInput,
} from '@/lib/validators/session'

/**
 * 面试会话服务 —— ③ 领域服务层。
 */

export type SessionView = {
  id: string
  resumeId: string | null
  jobJdId: string | null
  status: SessionStatus
  config: SessionConfig
  matchAnalysis: unknown
  plan: unknown
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

function normalizeConfig(value: unknown): SessionConfig {
  const raw = (value ?? {}) as Partial<SessionConfig>
  return {
    durationMin: raw.durationMin ?? DEFAULT_SESSION_CONFIG.durationMin,
    maxQuestions: raw.maxQuestions ?? DEFAULT_SESSION_CONFIG.maxQuestions,
    difficulty: raw.difficulty ?? DEFAULT_SESSION_CONFIG.difficulty,
  }
}

function toView(row: typeof interviewSessions.$inferSelect): SessionView {
  return {
    id: row.id,
    resumeId: row.resumeId,
    jobJdId: row.jobJdId,
    status: row.status,
    config: normalizeConfig(row.config),
    matchAnalysis: row.matchAnalysis,
    plan: row.plan,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listSessions(
  userId: string,
  page: { limit: number; offset: number },
): Promise<{ items: SessionView[]; total: number }> {
  const db = getDb()
  const rows = await db
    .select()
    .from(interviewSessions)
    .where(activeForUser(interviewSessions, userId))
    .orderBy(desc(interviewSessions.createdAt))
    .limit(page.limit)
    .offset(page.offset)

  const all = await db
    .select({ id: interviewSessions.id })
    .from(interviewSessions)
    .where(activeForUser(interviewSessions, userId))

  return { items: rows.map(toView), total: all.length }
}

export async function getSession(userId: string, id: string): Promise<SessionView> {
  const db = getDb()
  const rows = await db
    .select()
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, id, userId))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('面试会话不存在')
  return toView(row)
}

export async function createSession(
  userId: string,
  input: CreateSessionInput,
): Promise<SessionView> {
  // 至少需要简历或 JD 之一，否则无法生成基于用户背景的题目（AGENTS.md §6.1 N1）
  if (!input.resumeId && !input.jobJdId) {
    throw validationError('至少需要选择一份简历或一个岗位 JD')
  }

  // 归属校验：防止把自己会话关联到**他人**的简历/JD（越权引用）
  if (input.resumeId) await requireOwnedResume(userId, input.resumeId)
  if (input.jobJdId) await requireOwnedJobJd(userId, input.jobJdId)

  const db = getDb()
  const inserted = await db
    .insert(interviewSessions)
    .values({
      userId,
      resumeId: input.resumeId ?? null,
      jobJdId: input.jobJdId ?? null,
      config: { ...DEFAULT_SESSION_CONFIG, ...(input.config ?? {}) },
    })
    .returning()

  const row = inserted[0]
  if (!row) throw internalError('面试会话创建失败')
  return toView(row)
}

export async function updateSession(
  userId: string,
  id: string,
  input: UpdateSessionInput,
): Promise<SessionView> {
  const current = await getSession(userId, id)
  if (input.resumeId) await requireOwnedResume(userId, input.resumeId)
  if (input.jobJdId) await requireOwnedJobJd(userId, input.jobJdId)

  const db = getDb()
  const updated = await db
    .update(interviewSessions)
    .set({
      ...(input.resumeId !== undefined ? { resumeId: input.resumeId } : {}),
      ...(input.jobJdId !== undefined ? { jobJdId: input.jobJdId } : {}),
      ...(input.config !== undefined
        ? { config: { ...current.config, ...input.config } }
        : {}),
      updatedAt: new Date(),
    })
    .where(ownedByActive(interviewSessions, id, userId))
    .returning()

  const row = updated[0]
  if (!row) throw notFound('面试会话不存在')
  return toView(row)
}

/**
 * 状态迁移（供 Phase 3/4 的面试流程调用）。
 * 非法迁移由 session-state 的 assertTransition 拒绝（422）。
 */
export async function transitionSession(
  userId: string,
  id: string,
  next: SessionStatus,
): Promise<SessionView> {
  const current = await getSession(userId, id)
  assertTransition(current.status, next)

  const now = new Date()
  const db = getDb()
  const updated = await db
    .update(interviewSessions)
    .set({
      status: next,
      ...(next === 'in_progress'
        ? { startedAt: current.startedAt ? new Date(current.startedAt) : now }
        : {}),
      // completed 必须带 finishedAt，否则违反 sessions_finished_at_required 约束
      ...(next === 'completed' ? { finishedAt: now } : {}),
      updatedAt: now,
    })
    .where(ownedByActive(interviewSessions, id, userId))
    .returning()

  const row = updated[0]
  if (!row) throw notFound('面试会话不存在')
  return toView(row)
}

/** 软删除 */
export async function deleteSession(userId: string, id: string): Promise<void> {
  const db = getDb()
  const deleted = await db
    .update(interviewSessions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(ownedByActive(interviewSessions, id, userId), isNull(interviewSessions.deletedAt)))
    .returning({ id: interviewSessions.id })

  if (!deleted[0]) throw notFound('面试会话不存在')
}
