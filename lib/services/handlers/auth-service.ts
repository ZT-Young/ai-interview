import { randomInt } from 'node:crypto'

import { and, eq, isNull, ne } from 'drizzle-orm'

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
import { verifySmsCode } from '@/lib/auth/verification-code'

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
  /** 纯手机号注册的用户没有邮箱，可能为 null */
  email: string | null
  phone: string | null
  /** 登录标识之一，也是展示用昵称的默认来源 */
  username: string | null
  name: string | null
  avatarUrl: string | null
  membership: User['membership']
  freeCredits: number
  emailVerified: boolean
  phoneVerified: boolean
  /**
   * 是否管理员 —— 前端据此决定是否显示后台入口。
   * **仅用于展示**：真正的访问控制在服务端 `requireAdmin()` 重新校验。
   */
  isAdmin: boolean
  /**
   * 当前身份：`candidate` 求职者 / `interviewer` 面试官（DATA_MODEL §2.10）。
   * 决定登录后落到哪一侧的工作台，以及导航展示哪一套入口。
   */
  role: 'candidate' | 'interviewer'
  createdAt: string
}

export function toPublicUser(row: User): PublicUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatarUrl,
    membership: row.membership,
    freeCredits: row.freeCredits,
    emailVerified: row.emailVerifiedAt !== null,
    phoneVerified: row.phoneVerifiedAt !== null,
    isAdmin: row.isAdmin,
    role: row.role,
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
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 手机号规范化：去掉空格与短横线等常见分隔符，只留数字 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '')
}

/** 中国大陆手机号判定（与 lib/validators/auth.ts 的 phoneSchema 保持一致） */
const PHONE_PATTERN = /^1[3-9]\d{9}$/

export function isPhoneLike(value: string): boolean {
  return PHONE_PATTERN.test(value)
}

/**
 * 判定登录标识的类型。
 *
 * 顺序有意义：先手机号（纯 11 位数字），再邮箱（含 `@`），其余当用户名。
 * 用户名 schema 已**禁止纯数字**，因此不会与手机号判断冲突。
 */
export function resolveIdentifierKind(value: string): 'phone' | 'email' | 'username' {
  const trimmed = value.trim()
  if (isPhoneLike(trimmed)) return 'phone'
  if (trimmed.includes('@')) return 'email'
  return 'username'
}

/** 默认用户名前缀 */
const USERNAME_PREFIX = '用户'

function randomDigits(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10)
  return out
}

/** 手机号用户的默认用户名：`用户` + 尾号四位 */
export function defaultUsernameForPhone(phone: string): string {
  return `${USERNAME_PREFIX}${normalizePhone(phone).slice(-4)}`
}

/** 其余用户的默认用户名：`用户` + 随机四位 */
export function defaultUsername(): string {
  return `${USERNAME_PREFIX}${randomDigits(4)}`
}

/**
 * 分配一个未占用的用户名。
 *
 * `isTaken` 由调用方传入（闭包捕获事务句柄），这样本函数不必知道
 * 事务与连接池的具体类型，同时保证**唯一性判断发生在事务内**。
 * 冲突时退化为随机四位重试；极端情况用 8 位随机后缀兜底。
 */
async function allocateUsername(
  isTaken: (candidate: string) => Promise<boolean>,
  preferred: string,
): Promise<string> {
  if (!(await isTaken(preferred))) return preferred
  for (let i = 0; i < 20; i += 1) {
    const candidate = defaultUsername()
    if (!(await isTaken(candidate))) return candidate
  }
  return `${USERNAME_PREFIX}${randomDigits(8)}`
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

interface SessionSeed {
  tokenHash: string
  expiresAt: Date
  ip: string | null
  userAgent: string | null
}

/**
 * 注册收尾：同意记录 + 会话 + 审计日志。
 *
 * 与建用户放在**同一个事务**内：避免出现「有用户但无同意记录」的合规缺口
 * （AGENTS.md §7 C1）。
 */
async function finalizeRegistration(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  user: User,
  seed: SessionSeed,
): Promise<void> {
  // 同意记录：条款 / 隐私 / AI 生成内容说明（AGENTS.md §7 C1、C4）
  await tx.insert(consents).values(
    (['terms', 'privacy', 'ai_disclosure'] as const).map((consentType) => ({
      userId: user.id,
      consentType,
      version: CURRENT_CONSENT_VERSION,
      ip: seed.ip,
    })),
  )

  await tx.insert(sessions).values({
    userId: user.id,
    tokenHash: seed.tokenHash,
    expiresAt: seed.expiresAt,
    ip: seed.ip,
    userAgent: seed.userAgent,
  })

  await tx.insert(auditLogs).values({
    actorId: user.id,
    action: 'auth.register',
    targetType: 'user',
    targetId: user.id,
    ip: seed.ip,
    userAgent: seed.userAgent,
  })
}

/** 注册事务内判断用户名是否已被占用 */
function usernameTakenProbe(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
): (candidate: string) => Promise<boolean> {
  return async (candidate: string) => {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, candidate), isNull(users.deletedAt)))
      .limit(1)
    return rows.length > 0
  }
}

/**
 * 注册 —— 邮箱 / 手机号双通道。
 *
 * - 邮箱通道：邮箱 + 密码（与原行为一致），自动生成默认用户名
 * - 手机号通道：手机号 + 验证码（演示环境固定 8888），**密码可选**
 *   （不设密码则只能用验证码登录，这也就是 `password_hash` 允许为空的原因）
 */
export async function register(
  input: RegisterInput,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  return input.channel === 'phone' ? registerByPhone(input, meta) : registerByEmail(input, meta)
}

async function registerByEmail(
  input: Extract<RegisterInput, { channel: 'email' }>,
  meta: RequestMeta,
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
      // 不泄露账号是否存在之外的信息
      throw conflict('该邮箱已被注册')
    }

    const username = await allocateUsername(usernameTakenProbe(tx), defaultUsername())

    const inserted = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        username,
        name: input.name ?? null,
        // 注册时选定的身份（面试者 / 面试官），决定注册后落到哪一侧
        role: input.role,
        termsAcceptedAt: new Date(),
      })
      .returning()

    const user = inserted[0]
    if (!user) throw internalError('用户创建失败')

    await finalizeRegistration(tx, user, { tokenHash, expiresAt, ip, userAgent: meta.userAgent ?? null })

    return { user: toPublicUser(user), token, expiresAt }
  })
}

async function registerByPhone(
  input: Extract<RegisterInput, { channel: 'phone' }>,
  meta: RequestMeta,
): Promise<AuthResult> {
  const db = getDb()
  // 验证码校验（演示环境固定值，见 lib/auth/verification-code.ts）
  if (!verifySmsCode(input.code)) {
    throw unauthorized('验证码不正确')
  }

  const passwordHash = input.password ? await hashPassword(input.password) : null
  const token = generateSessionToken()
  const tokenHash = hashSessionToken(token)
  const expiresAt = sessionExpiry()
  const ip = parseIp(meta.ip)
  const phone = normalizePhone(input.phone)

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
      .limit(1)

    if (existing[0]) throw conflict('该手机号已被注册')

    const username = await allocateUsername(
      usernameTakenProbe(tx),
      defaultUsernameForPhone(phone),
    )

    const inserted = await tx
      .insert(users)
      .values({
        phone,
        // 注册即通过验证码，视为已验证
        phoneVerifiedAt: new Date(),
        passwordHash,
        username,
        name: input.name ?? null,
        role: input.role,
        termsAcceptedAt: new Date(),
      })
      .returning()

    const user = inserted[0]
    if (!user) throw internalError('用户创建失败')

    await finalizeRegistration(tx, user, { tokenHash, expiresAt, ip, userAgent: meta.userAgent ?? null })

    return { user: toPublicUser(user), token, expiresAt }
  })
}

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

/** 更新个人资料（昵称 / 头像 / 用户名） */
export async function updateProfile(
  id: string,
  input: UpdateProfileInput,
): Promise<PublicUser> {
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
