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
  /** 纯手机号注册的用户没有邮箱 */
  email: string | null
  phone: string | null
  /** 用户名：登录标识之一，也是展示用的默认名称 */
  username: string | null
  name: string | null
  avatarUrl: string | null
  membership: User['membership']
  freeCredits: number
  /**
   * 是否管理员 —— 前端据此决定是否显示后台入口。
   * **仅用于展示**：访问控制由服务端 `requireAdmin()` 重新校验。
   */
  isAdmin: boolean
  /** 当前身份：`candidate` 求职者 / `interviewer` 面试官（DATA_MODEL §2.10） */
  role: 'candidate' | 'interviewer'
}

function toAuthenticatedUser(row: User): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatarUrl,
    membership: row.membership,
    freeCredits: row.freeCredits,
    isAdmin: row.isAdmin,
    role: row.role,
  }
}

/**
 * 校验会话令牌并返回当前用户。
 *
 * 同时校验：会话未撤销、未过期、用户未被软删除、**会话属于指定端**。
 * 任一不满足返回 null（调用方统一映射为 401，不区分具体原因，避免信息泄露）。
 *
 * @param kind 期望的会话归属端。用户端接口传 `'user'`，后台接口传 `'admin'`。
 *   **两端互不认对方的会话** —— 这是「管理端与用户端完全分离」的落点。
 */
export async function resolveSessionUser(
  token: string | undefined,
  kind: 'user' | 'admin' = 'user',
): Promise<AuthenticatedUser | null> {
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
        eq(sessions.kind, kind),
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

/**
 * 管理端会话校验：必须是 `kind='admin'` 的会话 **且** 账号 `is_admin`。
 *
 * 两道条件缺一不可：
 * - 只看 Cookie 名 → 客户端改个名字就能把用户端会话递过来
 * - 只看 is_admin → 管理员在用户端登录产生的会话也能进后台，
 *   于是「两端分离」形同虚设，且钓鱼页面可直接借用它操作后台
 */
export async function resolveAdminSessionUser(
  token: string | undefined,
): Promise<AuthenticatedUser | null> {
  const user = await resolveSessionUser(token, 'admin')
  if (!user) return null
  if (!user.isAdmin) return null
  return user
}
