import { describe, expect, it } from 'vitest'

import { toPublicUser } from '@/lib/services/auth-service'
import type { User } from '@/db/schema'

const row: User = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  passwordHash: 'scrypt$16384$8$1$salt$hash',
  name: '张三',
  avatarUrl: null,
  membership: 'free',
  freeCredits: 1,
  emailVerifiedAt: null,
  termsAcceptedAt: new Date('2026-01-01T00:00:00.000Z'),
  isAdmin: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
}

describe('用户对外视图', () => {
  it('绝不包含 passwordHash', () => {
    const publicUser = toPublicUser(row)
    expect(Object.keys(publicUser)).not.toContain('passwordHash')
    expect(JSON.stringify(publicUser)).not.toContain('scrypt$')
  })

  it('把 emailVerifiedAt 转换为布尔标记', () => {
    expect(toPublicUser(row).emailVerified).toBe(false)
    expect(toPublicUser({ ...row, emailVerifiedAt: new Date() }).emailVerified).toBe(true)
  })

  it('不泄露软删除标记等内部字段', () => {
    const publicUser = toPublicUser({ ...row, deletedAt: new Date() })
    expect(Object.keys(publicUser)).not.toContain('deletedAt')
  })

  it('时间字段序列化为 ISO 字符串', () => {
    expect(toPublicUser(row).createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
