import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * 归属过滤 —— 权限隔离的核心工具。
 *
 * 返回的 SQL 条件**同时包含**资源 ID 与 user_id，
 * 使「忘记加 user_id 过滤」在类型层面就难以发生：
 *
 *   await db.select().from(resumes).where(ownedBy(resumes, id, user.id))
 *
 * 查不到即代表「不存在或不属于你」，路由层统一转 404（见 lib/api/errors.ts）。
 */
export function ownedBy<T extends { id: PgColumn; userId: PgColumn }>(
  table: T,
  id: string,
  userId: string,
): SQL {
  return and(eq(table.id, id), eq(table.userId, userId))!
}

/**
 * 归属过滤 + 软删除过滤。用于带 deleted_at 的表（users/resumes/job_jds/interview_sessions）。
 */
export function ownedByActive<T extends { id: PgColumn; userId: PgColumn; deletedAt: PgColumn }>(
  table: T,
  id: string,
  userId: string,
): SQL {
  return and(eq(table.id, id), eq(table.userId, userId), isNull(table.deletedAt))!
}

/** 仅按归属列出有效记录 */
export function activeForUser<T extends { userId: PgColumn; deletedAt: PgColumn }>(
  table: T,
  userId: string,
): SQL {
  return and(eq(table.userId, userId), isNull(table.deletedAt))!
}
