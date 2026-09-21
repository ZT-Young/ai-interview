import { and, eq, gt, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { sessions, users, type User } from '@/db/schema'

import { hashSessionToken, safeCompareHash } from './session'

/**
 * 会话校验 —— 所有受保护请求的唯一入口。
 *
 * 注意：本模块只接受**明文 token**（由调用方从 Cookie 读取），
 * 不直接依赖 next/headers，以便在单元测试中直接调用。
 */

export interface AuthenticatedUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  membership: User['membership']
  freeCredits: number
  /**
   * 是否管理员 —— 前端据此决定是否显示后台入口。
   * **仅用于展示**：访问控制由服务端 `requireAdmin()` 重新校验。
   */
  isAdmin: boolean
}

function toAuthenticatedUser(row: User): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    membership: row.membership,
    freeCredits: row.freeCredits,
    isAdmin: row.isAdmin,
  }
}

/**
 * 校验会话令牌并返回当前用户。
 *
 * 同时校验：会话未撤销、未过期、用户未被软删除。
 * 任一不满足返回 null（调用方统一映射为 401，不区分具体原因，避免信息泄露）。
 */
export async function resolveSessionUser(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null

  const tokenHash = hashSessionToken(token)
  const db = getDb()

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null

  // 双重保险：确认取出的会话哈希与计算值一致（防御未来查询条件被误改）
  if (!safeCompareHash(row.session.tokenHash, tokenHash)) return null

  return toAuthenticatedUser(row.user)
}
