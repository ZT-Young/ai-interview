import { describe, expect, it } from 'vitest'

import { loginSchema, registerSchema, updateProfileSchema } from '@/lib/validators/auth'
import { createResumeSchema, updateResumeSchema } from '@/lib/validators/resume'
import { createJobJdSchema } from '@/lib/validators/job-jd'
import { createSessionSchema } from '@/lib/validators/session'

describe('注册入参校验', () => {
  it('接受合法输入并规范化邮箱为小写', () => {
    const result = registerSchema.parse({
      email: '  User@Example.COM ',
      password: 'password123',
      acceptTerms: true,
    })
    expect(result.email).toBe('user@example.com')
  })

  it('拒绝未同意条款的注册（AGENTS.md §7 C1）', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      password: 'password123',
      acceptTerms: false,
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 acceptTerms 的注册', () => {
    expect(registerSchema.safeParse({ email: 'a@b.com', password: 'password123' }).success).toBe(
      false,
    )
  })

  it('拒绝过短密码', () => {
    expect(
      registerSchema.safeParse({ email: 'a@b.com', password: 'short', acceptTerms: true }).success,
    ).toBe(false)
  })

  it('拒绝非法邮箱', () => {
    for (const email of ['not-an-email', 'a@', '@b.com', '']) {
      expect(
        registerSchema.safeParse({ email, password: 'password123', acceptTerms: true }).success,
      ).toBe(false)
    }
  })
})

describe('登录入参校验', () => {
  it('登录不要求 acceptTerms', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'x' })
    expect(result.success).toBe(true)
  })

  it('拒绝空密码（避免无意义查询）', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false)
  })
})

describe('资料更新校验', () => {
  it('拒绝空对象', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false)
  })

  it('拒绝非法头像地址', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: 'not-a-url' }).success).toBe(false)
  })
})

describe('简历入参校验', () => {
  it('拒绝不支持的文件类型', () => {
    const result = createResumeSchema.safeParse({
      fileName: 'a.exe',
      fileType: 'exe',
      fileSize: 100,
      storageKey: 'k',
    })
    expect(result.success).toBe(false)
  })

  it('拒绝超过 20MB 的文件', () => {
    const result = createResumeSchema.safeParse({
      fileName: 'a.pdf',
      fileType: 'pdf',
      fileSize: 21 * 1024 * 1024,
      storageKey: 'k',
    })
    expect(result.success).toBe(false)
  })

  it('接受 PDF 并默认非主简历', () => {
    const result = createResumeSchema.parse({
      fileName: 'a.pdf',
      fileType: 'pdf',
      fileSize: 1024,
      storageKey: 'resumes/1/a.pdf',
    })
    expect(result.isPrimary).toBe(false)
  })

  it('拒绝空更新', () => {
    expect(updateResumeSchema.safeParse({}).success).toBe(false)
  })
})

describe('JD 入参校验', () => {
  it('拒绝过短的 JD 原文', () => {
    expect(createJobJdSchema.safeParse({ rawText: '太短' }).success).toBe(false)
  })

  it('接受纯文本 JD（粘贴场景）', () => {
    const result = createJobJdSchema.safeParse({
      rawText: '岗位职责：负责 AI 应用的后端开发，要求熟悉 TypeScript 与 PostgreSQL。',
    })
    expect(result.success).toBe(true)
  })
})

describe('面试会话入参校验', () => {
  it('配置缺省时不报错（由服务端补默认值）', () => {
    const result = createSessionSchema.safeParse({})
    expect(result.success).toBe(true)
    expect(result.success && result.data.config).toBeUndefined()
  })

  it('拒绝非 UUID 的 resumeId（避免把任意字符串当 ID 查询）', () => {
    expect(createSessionSchema.safeParse({ resumeId: 'abc' }).success).toBe(false)
  })

  it('拒绝超范围的 maxQuestions', () => {
    const result = createSessionSchema.safeParse({
      config: { maxQuestions: 999 },
    })
    expect(result.success).toBe(false)
  })
})
