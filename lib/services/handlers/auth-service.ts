import { and, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  auditLogs,
  consents,
  sessions,
  users,
  CURRENT_CONSENT_VERSION,
  type User,
} from '@/db/schema'
import { conflict, internalError, notFound, unauthorized } from '@/lib/api/errors'
import { hashPassword, burnPasswordTime, verifyPassword } from '@/lib/auth/password'
import { generateSessionToken, hashSessionToken, sessionExpiry } from '@/lib/auth/session'

import type { LoginInput, RegisterInput, UpdateProfileInput } from '@/lib/validators/auth'

/**
 * 认证领域服务 —— ③ 领域服务层。
 *
 * 不依赖 next/headers 与 NextResponse：只接受纯参数、返回纯数据。
 * Cookie 读写与状态码由 ② 接口层负责，因此本模块可在 Vitest 中直接调用。
 */

/** 对外暴露的用户视图：**绝不包含 passwordHash** */
export interface PublicUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  membership: User['membership']
  freeCredits: number
  emailVerified: boolean
  /**
   * 是否管理员 —— 前端据此决定是否显示后台入口。
   * **仅用于展示**：真正的访问控制在服务端 `requireAdmin()` 重新校验。
   */
  isAdmin: boolean
  createdAt: string
}

export function toPublicUser(row: User): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    membership: row.membership,
    freeCredits: row.freeCredits,
    emailVerified: row.emailVerifiedAt !== null,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt.toISOString(),
  }
}

export interface RequestMeta {
  ip?: string | null
  userAgent?: string | null
}

/**
 * 邮箱规范化：统一转小写并去首尾空白。
 *
 * **必须在「查重」与「写库」以及「登录查找」三处使用同一个函数**，
 * 否则会出现两个真实缺陷：
 * 1. `A@x.com` 与 `a@x.com` 被当成两个账号 —— 用户换个大小写就能重复注册；
 * 2. 注册时存原样大小写、登录时按输入查找，用户改一次大小写就登录不上。
 *
 * 不使用 `toLowerCase()` 之外的 Unicode 归一化：邮箱本地部分理论上大小写敏感，
 * 但所有主流邮箱服务商都按不敏感处理，且用户期望也不敏感，这里跟随现实约定。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** inet 列不接受任意字符串；非法或缺失时存 NULL，不因此让注册失败 */
function parseIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)
  const isIpv6 = ip.includes(':')
  if (!isIpv4 && !isIpv6) return null
  return ip
}

export interface AuthResult {
  user: PublicUser
  /** 明文会话令牌，仅用于写入 Cookie */
  token: string
  expiresAt: Date
}

/**
 * 注册。
 *
 * 在一个事务内完成：建用户 → 写入同意记录 → 建立会话 → 记审计日志。
 * 任一步失败则整体回滚，避免出现「有用户但无同意记录」的合规缺口。
 */
export async function register(
  input: RegisterInput,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  const db = getDb()
  const passwordHash = await hashPassword(input.password)
  const token = generateSessionToken()
  const tokenHash = hashSessionToken(token)
  const expiresAt = sessionExpiry()
  const ip = parseIp(meta.ip)
  // 规范化后再查重与写库：两步必须用同一个值，否则大小写不同即可绕过唯一性
  const email = normalizeEmail(input.email)

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1)

    if (existing[0]) {
      // 不区分「已注册」与其它冲突原因之外的信息，避免泄露账号是否存在
      throw conflict('该邮箱已被注册')
    }

    const inserted = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        name: input.name ?? null,
        termsAcceptedAt: new Date(),
      })
      .returning()

    const user = inserted[0]
    if (!user) throw internalError('用户创建失败')

    // 同意记录：条款 / 隐私 / AI 生成内容说明（AGENTS.md §7 C1、C4）
    await tx.insert(consents).values(
      (['terms', 'privacy', 'ai_disclosure'] as const).map((consentType) => ({
        userId: user.id,
        consentType,
        version: CURRENT_CONSENT_VERSION,
        ip,
      })),
    )

    await tx.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt,
      ip,
      userAgent: meta.userAgent ?? null,
    })

    await tx.insert(auditLogs).values({
      actorId: user.id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      ip,
      userAgent: meta.userAgent ?? null,
    })

    return { user: toPublicUser(user), token, expiresAt }
  })
}

/**
 * 登录。
 *
 * 用户不存在时也执行一次哈希运算（burnPasswordTime），
 * 使「账号不存在」与「密码错误」的响应时间接近，防止账号枚举。
 * 两种情况返回**完全相同**的错误信息。
 */
export async function login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthResult> {
  const db = getDb()

  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, normalizeEmail(input.email)), isNull(users.deletedAt)))
    .limit(1)

  const user = rows[0]

  if (!user) {
    await burnPasswordTime(input.password)
    throw unauthorized('邮箱或密码不正确')
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash)
  if (!passwordOk) {
    throw unauthorized('邮箱或密码不正确')
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

  await db.insert(auditLogs).values({
    actorId: user.id,
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
    ip,
    userAgent: meta.userAgent ?? null,
  })

  return { user: toPublicUser(user), token, expiresAt }
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

/** 更新个人资料 */
export async function updateProfile(
  id: string,
  input: UpdateProfileInput,
): Promise<PublicUser> {
  const db = getDb()
  const updated = await db
    .update(users)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
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
