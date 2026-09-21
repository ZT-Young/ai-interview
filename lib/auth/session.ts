import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * 会话令牌工具。
 *
 * 设计：Cookie 中保存**明文 token**，数据库只保存其 HMAC-SHA256 哈希。
 * 即使数据库被读取，也无法直接冒用会话。
 * 用 AUTH_SECRET 作为 HMAC 密钥，使哈希无法在库外离线复现。
 */

export const SESSION_COOKIE_NAME = 'ai_interview_session'
/** 会话有效期 30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_BYTES = 32

function secret(): string {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 16) {
    throw new Error('[auth] 缺少 AUTH_SECRET（至少 16 字符）。请参考 .env.example 配置。')
  }
  return value
}

/** 生成新的会话令牌（明文，仅返回给调用方写入 Cookie） */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** 计算令牌哈希（入库值） */
export function hashSessionToken(token: string): string {
  return createHmac('sha256', secret()).update(token).digest('hex')
}

/** 常数时间比较两个哈希 */
export function safeCompareHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** 计算会话过期时间 */
export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_MS)
}

export interface SessionCookieOptions {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
}

/** Cookie 选项。生产环境必须 Secure；本地 http 下 Secure 会导致 Cookie 不生效。 */
export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}
