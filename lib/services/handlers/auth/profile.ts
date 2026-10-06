/**
 * 资料与账号领域（抽离自 auth-service.ts）。
 *
 * 读取当前用户、更新个人资料、软删除账号（含吊销全部会话）。
 * 纯类型与辅助见 ../types.ts。
 */

import { and, eq, isNull, ne } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, sessions, users } from '@/db/schema'
import { conflict, notFound } from '@/lib/api/errors'
import type { UpdateProfileInput } from '@/lib/validators/auth'
import { parseIp, toPublicUser, type PublicUser, type RequestMeta } from './types'

/** 按 ID 读取当前用户（不含 passwordHash） */
export async function getUserById(id: string): Promise<PublicUser> {
  const db = getDb()
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1)

  const user = rows[0]
  if (!user) throw notFound('用户不存在')
  return toPublicUser(user)
}

/** 更新个人资料（昵称 / 头像 / 用户名） */
export async function updateProfile(id: string, input: UpdateProfileInput): Promise<PublicUser> {
  const db = getDb()

  if (input.username !== undefined) {
    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, input.username), isNull(users.deletedAt), ne(users.id, id)))
      .limit(1)
    if (taken[0]) throw conflict('该用户名已被占用')
  }

  const updated = await db
    .update(users)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning()

  const user = updated[0]
  if (!user) throw notFound('用户不存在')
  return toPublicUser(user)
}

/**
 * 软删除当前用户（AGENTS.md §7 C3：用户可删除个人数据）。
 *
 * 同时吊销全部会话 —— 删除后必须立即无法继续访问。
 * 真实删除 S3 对象与硬删由后续 Phase 的清理任务完成（见 docs/engineering/DATA_MODEL.md §6）。
 */
export async function deleteAccount(id: string, meta: RequestMeta = {}): Promise<void> {
  const db = getDb()
  const now = new Date()

  await db.transaction(async (tx) => {
    const deleted = await tx
      .update(users)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning({ id: users.id })

    if (!deleted[0]) throw notFound('用户不存在')

    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)))

    await tx.insert(auditLogs).values({
      actorId: id,
      action: 'user.delete',
      targetType: 'user',
      targetId: id,
      ip: parseIp(meta.ip),
      userAgent: meta.userAgent ?? null,
    })
  })
}
