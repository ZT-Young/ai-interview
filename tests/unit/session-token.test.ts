import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  generateSessionToken,
  hashSessionToken,
  safeCompareHash,
  sessionCookieOptions,
  sessionExpiry,
  SESSION_TTL_MS,
} from '@/lib/auth/session'

const originalSecret = process.env.AUTH_SECRET

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-at-least-16-chars'
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

describe('会话令牌', () => {
  it('令牌每次生成都不同', () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken())
  })

  it('哈希稳定且不等于原文', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token)
    expect(hash).toBe(hashSessionToken(token))
    expect(hash).not.toBe(token)
  })

  it('不同令牌哈希不同', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'))
  })

  it('哈希结果受 AUTH_SECRET 影响（库被读取也无法离线复现）', () => {
    const token = 'fixed-token'
    const first = hashSessionToken(token)
    process.env.AUTH_SECRET = 'another-secret-16-chars-long'
    expect(hashSessionToken(token)).not.toBe(first)
  })

  it('缺少 AUTH_SECRET 时抛出可读错误', () => {
    delete process.env.AUTH_SECRET
    expect(() => hashSessionToken('x')).toThrow(/AUTH_SECRET/)
  })

  it('AUTH_SECRET 过短同样拒绝', () => {
    process.env.AUTH_SECRET = 'short'
    expect(() => hashSessionToken('x')).toThrow(/AUTH_SECRET/)
  })

  it('safeCompareHash 正确比较', () => {
    expect(safeCompareHash('abc', 'abc')).toBe(true)
    expect(safeCompareHash('abc', 'abd')).toBe(false)
    expect(safeCompareHash('abc', 'abcd')).toBe(false)
  })

  it('过期时间为 30 天后', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    expect(sessionExpiry(from).getTime() - from.getTime()).toBe(SESSION_TTL_MS)
  })

  it('Cookie 为 HttpOnly + SameSite=Lax + 根路径', () => {
    const options = sessionCookieOptions()
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.path).toBe('/')
    expect(options.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000))
  })

  it('生产环境启用 Secure，开发环境不启用（否则本地 http 下 Cookie 失效）', () => {
    const env = process.env as Record<string, string | undefined>
    const original = env.NODE_ENV
    env.NODE_ENV = 'production'
    expect(sessionCookieOptions().secure).toBe(true)
    env.NODE_ENV = 'development'
    expect(sessionCookieOptions().secure).toBe(false)
    env.NODE_ENV = original
  })
})
