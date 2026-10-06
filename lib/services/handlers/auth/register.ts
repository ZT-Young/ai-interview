/**
 * 注册领域（抽离自 auth-service.ts）。
 *
 * 邮箱 / 手机号双通道注册。与建用户放在**同一个事务**内完成同意记录 + 会话 + 审计，
 * 避免出现「有用户但无同意记录」的合规缺口（AGENTS.md §7 C1）。
 * 纯类型与规范化辅助见 ../types.ts。
 */

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
import { conflict, internalError, unauthorized } from '@/lib/api/errors'
import { hashPassword } from '@/lib/auth/password'
import { generateSessionToken, hashSessionToken, sessionExpiry } from '@/lib/auth/session'
import { verifySmsCode } from '@/lib/auth/verification-code'
import type { RegisterInput } from '@/lib/validators/auth'
import {
  allocateUsername,
  defaultUsername,
  defaultUsernameForPhone,
  normalizeEmail,
  normalizePhone,
  parseIp,
  toPublicUser,
  type AuthResult,
  type RequestMeta,
} from './types'

interface SessionSeed {
  tokenHash: string
  expiresAt: Date
  ip: string | null
  userAgent: string | null
}

/**
 * 注册收尾：同意记录 + 会话 + 审计日志。
 *
 * 与建用户放在**同一个事务**内（见本模块入口 transaction）。
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

    await finalizeRegistration(tx, user, {
      tokenHash,
      expiresAt,
      ip,
      userAgent: meta.userAgent ?? null,
    })

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

    const username = await allocateUsername(usernameTakenProbe(tx), defaultUsernameForPhone(phone))

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

    await finalizeRegistration(tx, user, {
      tokenHash,
      expiresAt,
      ip,
      userAgent: meta.userAgent ?? null,
    })

    return { user: toPublicUser(user), token, expiresAt }
  })
}
