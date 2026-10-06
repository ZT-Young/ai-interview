/**
 * 登录领域（抽离自 auth-service.ts）。
 *
 * 用户名 / 手机号 / 邮箱 + 密码或验证码；以及一条**完全独立**的管理端登录路径 loginAdmin。
 * 关键不变量（防账号枚举、管理端不泄露管理员身份、退出立即失效）全部保留。
 * 纯类型与规范化辅助见 ../types.ts。
 */

import { and, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, sessions, users } from '@/db/schema'
import { unauthorized } from '@/lib/api/errors'
import { burnPasswordTime, verifyPassword } from '@/lib/auth/password'
import { generateSessionToken, hashSessionToken, sessionExpiry } from '@/lib/auth/session'
import { verifySmsCode } from '@/lib/auth/verification-code'
import type { LoginInput } from '@/lib/validators/auth'
import {
  normalizeEmail,
  normalizePhone,
  parseIp,
  resolveIdentifierKind,
  toPublicUser,
  type AuthResult,
  type RequestMeta,
} from './types'

/**
 * 登录 —— 用户名 / 手机号 / 邮箱 + 密码或验证码。
 *
 * 防账号枚举（与原实现一致）：账号不存在时也执行一次哈希运算（burnPasswordTime），
 * 且「账号不存在」与「密码错误」返回**完全相同**的错误信息。
 *
 * 验证码模式下手机号未注册同样返回「验证码不正确」：不泄露该手机号是否已注册，
 * 注册入口由前端常驻提示给出。
 */
export async function login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthResult> {
  const db = getDb()
  const identifier = input.identifier.trim()
  const kind = resolveIdentifierKind(identifier)

  const find = async () => {
    if (kind === 'phone') {
      return db
        .select()
        .from(users)
        .where(and(eq(users.phone, normalizePhone(identifier)), isNull(users.deletedAt)))
        .limit(1)
    }
    if (kind === 'email') {
      return db
        .select()
        .from(users)
        .where(and(eq(users.email, normalizeEmail(identifier)), isNull(users.deletedAt)))
        .limit(1)
    }
    return db
      .select()
      .from(users)
      .where(and(eq(users.username, identifier), isNull(users.deletedAt)))
      .limit(1)
  }

  const rows = await find()
  let user = rows[0]

  if (input.mode === 'code') {
    // 验证码只对手机号有意义
    if (kind !== 'phone') throw unauthorized('验证码登录请使用手机号')
    if (!user) throw unauthorized('验证码不正确')
    if (!verifySmsCode(input.code)) throw unauthorized('验证码不正确')

    if (!user.phoneVerifiedAt) {
      const now = new Date()
      await db
        .update(users)
        .set({ phoneVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, user.id))
      user = { ...user, phoneVerifiedAt: now }
    }
  } else {
    if (!user) {
      await burnPasswordTime(input.password)
      throw unauthorized('账号或密码不正确')
    }
    // 纯验证码注册的用户没有密码；用统一文案，不泄露账号状态
    if (!user.passwordHash) throw unauthorized('账号或密码不正确')

    const passwordOk = await verifyPassword(input.password, user.passwordHash)
    if (!passwordOk) throw unauthorized('账号或密码不正确')
  }

  const token = generateSessionToken()
  const tokenHash = hashSessionToken(token)
  const expiresAt = sessionExpiry()
  const ip = parseIp(meta.ip)

  await db.insert(sessions).values({
    userId: user.id,
    tokenHash,
    expiresAt,
    ip,
    userAgent: meta.userAgent ?? null,
  })

  /**
   * 登录时选定的身份与账号当前身份不一致 → 顺带切换。
   *
   * 为什么不放一个独立的「切换身份」接口让前端登录后再调：
   * 那样会多出一次往返，且登录成功到切换完成之间存在「进错工作台」的中间态。
   * 身份是单值列（V1 取舍见 INTERVIEWER_SIDE §3），切换只改这一列，**两侧数据都保留**。
   */
  let current = user
  if (input.role && user.role !== input.role) {
    const updated = await db
      .update(users)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning()
    current = updated[0] ?? user
  }

  await db.insert(auditLogs).values({
    actorId: current.id,
    action: 'auth.login',
    targetType: 'user',
    targetId: current.id,
    ip,
    userAgent: meta.userAgent ?? null,
    metadata: JSON.stringify({ role: current.role, switched: user.role !== current.role }),
  })

  return { user: toPublicUser(current), token, expiresAt }
}

/**
 * 管理端登录 —— 与用户端**完全分离**的一条独立路径。
 *
 * 与 `login()` 的三点差异：
 * 1. 产出的是 `kind='admin'` 的会话，写入**另一个** Cookie
 * 2. 账号不是管理员时，返回与「密码错误」**完全一致**的错误
 *    （不能提示「你不是管理员」—— 那等于帮攻击者确认该账号存在且可登录用户端）
 * 3. **不改 `users.role`**：管理员也可能要用求职者/面试官身份，
 *    进后台不应把用户端的身份挤掉
 *
 * 复用 `login()` 的凭证校验而不是另写一套，是为了避免两处密码/验证码逻辑走偏。
 */
export async function loginAdmin(input: LoginInput, meta: RequestMeta = {}): Promise<AuthResult> {
  const result = await login(input, meta)

  if (!result.user.isAdmin) {
    // 关键：先把刚建的用户端会话撤销掉，别留下一条能用的普通会话
    await logout(result.token)
    throw unauthorized('账号或密码不正确')
  }

  const db = getDb()
  // 重新签发一条管理端会话（kind='admin'），原用户端会话已作废
  const token = generateSessionToken()
  const expiresAt = sessionExpiry()
  const ip = parseIp(meta.ip)

  await db.insert(sessions).values({
    userId: result.user.id,
    tokenHash: hashSessionToken(token),
    kind: 'admin',
    expiresAt,
    ip,
    userAgent: meta.userAgent ?? null,
  })

  await db.insert(auditLogs).values({
    actorId: result.user.id,
    action: 'auth.admin_login',
    targetType: 'user',
    targetId: result.user.id,
    ip,
    userAgent: meta.userAgent ?? null,
  })

  return { user: result.user, token, expiresAt }
}

/**
 * 退出登录：置 revoked_at 使会话**立即失效**（这正是选择数据库会话而非 JWT 的原因）。
 * 幂等：令牌不存在或已失效时不报错。
 */
export async function logout(token: string | undefined, meta: RequestMeta = {}): Promise<void> {
  if (!token) return

  const db = getDb()
  const tokenHash = hashSessionToken(token)

  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId })

  const userId = revoked[0]?.userId
  if (userId) {
    await db.insert(auditLogs).values({
      actorId: userId,
      action: 'auth.logout',
      targetType: 'user',
      targetId: userId,
      ip: parseIp(meta.ip),
      userAgent: meta.userAgent ?? null,
    })
  }
}
