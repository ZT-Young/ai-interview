import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword, burnPasswordTime } from '@/lib/auth/password'

describe('密码哈希', () => {
  it('哈希结果不含明文密码', async () => {
    const hash = await hashPassword('SuperSecret123')
    expect(hash).not.toContain('SuperSecret123')
    expect(hash.startsWith('scrypt$')).toBe(true)
  })

  it('同一密码两次哈希结果不同（随机盐）', async () => {
    const a = await hashPassword('SuperSecret123')
    const b = await hashPassword('SuperSecret123')
    expect(a).not.toBe(b)
  })

  it('正确密码校验通过', async () => {
    const hash = await hashPassword('SuperSecret123')
    await expect(verifyPassword('SuperSecret123', hash)).resolves.toBe(true)
  })

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('SuperSecret123')
    await expect(verifyPassword('SuperSecret124', hash)).resolves.toBe(false)
  })

  it('空密码与超长密码不会崩溃', async () => {
    const hash = await hashPassword('SuperSecret123')
    await expect(verifyPassword('', hash)).resolves.toBe(false)
    await expect(verifyPassword('x'.repeat(5000), hash)).resolves.toBe(false)
  })

  it('损坏的哈希串返回 false 而非抛错', async () => {
    for (const broken of ['', 'not-a-hash', 'scrypt$1$2$3', 'scrypt$a$b$c$d$e', 'md5$1$2$3$4$5']) {
      await expect(verifyPassword('SuperSecret123', broken)).resolves.toBe(false)
    }
  })

  it('burnPasswordTime 不抛错（用于抹平账号枚举时间差）', async () => {
    await expect(burnPasswordTime('anything')).resolves.toBeUndefined()
  })
})
