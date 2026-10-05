import { describe, expect, it } from 'vitest'

import {
  loginSchema,
  phoneSchema,
  registerSchema,
  updateProfileSchema,
  usernameSchema,
} from '@/lib/validators/auth'
import { createResumeSchema, updateResumeSchema } from '@/lib/validators/resume'
import { createJobJdSchema } from '@/lib/validators/job-jd'
import { createSessionSchema } from '@/lib/validators/session'

describe('注册入参校验（邮箱通道）', () => {
  it('接受合法输入并规范化邮箱为小写', () => {
    const result = registerSchema.parse({
      channel: 'email',
      email: '  User@Example.COM ',
      password: 'password123',
      acceptTerms: true,
    })
    expect(result.channel).toBe('email')
    expect(result.channel === 'email' && result.email).toBe('user@example.com')
  })

  it('拒绝未同意条款的注册（AGENTS.md §7 C1）', () => {
    const result = registerSchema.safeParse({
      channel: 'email',
      email: 'a@b.com',
      password: 'password123',
      acceptTerms: false,
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 acceptTerms 的注册', () => {
    expect(
      registerSchema.safeParse({
        channel: 'email',
        email: 'a@b.com',
        password: 'password123',
      }).success,
    ).toBe(false)
  })

  it('拒绝过短密码', () => {
    expect(
      registerSchema.safeParse({
        channel: 'email',
        email: 'a@b.com',
        password: 'short',
        acceptTerms: true,
      }).success,
    ).toBe(false)
  })

  it('拒绝非法邮箱', () => {
    for (const email of ['not-an-email', 'a@', '@b.com', '']) {
      expect(
        registerSchema.safeParse({
          channel: 'email',
          email,
          password: 'password123',
          acceptTerms: true,
        }).success,
      ).toBe(false)
    }
  })
})

describe('注册入参校验（手机号通道）', () => {
  it('接受手机号 + 验证码，密码可选', () => {
    const result = registerSchema.safeParse({
      channel: 'phone',
      phone: '13800138000',
      code: '8888',
      acceptTerms: true,
    })
    expect(result.success).toBe(true)
  })

  it('接受同时设置密码（之后可用手机号 + 密码登录）', () => {
    const result = registerSchema.safeParse({
      channel: 'phone',
      phone: '13800138000',
      code: '8888',
      password: 'password123',
      acceptTerms: true,
    })
    expect(result.success).toBe(true)
  })

  it('拒绝非法手机号', () => {
    for (const phone of ['12345', '23800138000', '1380013800a', '']) {
      expect(
        registerSchema.safeParse({ channel: 'phone', phone, code: '8888', acceptTerms: true })
          .success,
      ).toBe(false)
    }
  })

  it('拒绝非数字验证码', () => {
    expect(
      registerSchema.safeParse({
        channel: 'phone',
        phone: '13800138000',
        code: 'abcd',
        acceptTerms: true,
      }).success,
    ).toBe(false)
  })
})

describe('登录入参校验', () => {
  it('密码模式：接受任意标识且不要求 acceptTerms', () => {
    expect(
      loginSchema.safeParse({ mode: 'password', identifier: 'a@b.com', password: 'x' }).success,
    ).toBe(true)
  })

  it('验证码模式：接受手机号 + 验证码', () => {
    expect(
      loginSchema.safeParse({ mode: 'code', identifier: '13800138000', code: '8888' }).success,
    ).toBe(true)
  })

  it('拒绝空密码（避免无意义查询）', () => {
    expect(
      loginSchema.safeParse({ mode: 'password', identifier: 'a@b.com', password: '' }).success,
    ).toBe(false)
  })

  it('拒绝缺少 mode（无法判断凭证类型）', () => {
    expect(loginSchema.safeParse({ identifier: 'a@b.com', password: 'x' }).success).toBe(false)
  })
})

describe('用户名校验', () => {
  it('接受中文 + 数字', () => {
    expect(usernameSchema.safeParse('用户1234').success).toBe(true)
  })

  it('拒绝过短与超长', () => {
    expect(usernameSchema.safeParse('用').success).toBe(false)
    expect(usernameSchema.safeParse('用'.repeat(31)).success).toBe(false)
  })

  it('拒绝含特殊字符', () => {
    expect(usernameSchema.safeParse('用户@123').success).toBe(false)
  })

  it('拒绝手机号格式（否则登录时被误判为手机号，导致无法登录）', () => {
    expect(usernameSchema.safeParse('13800138000').success).toBe(false)
  })
})

describe('手机号校验', () => {
  it('接受合法手机号', () => {
    expect(phoneSchema.safeParse('13800138000').success).toBe(true)
  })

  it('拒绝非 1 开头或位数不对', () => {
    for (const phone of ['23800138000', '1380013800', '138001380000']) {
      expect(phoneSchema.safeParse(phone).success).toBe(false)
    }
  })
})

describe('资料更新校验', () => {
  it('拒绝空对象', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false)
  })

  it('拒绝非法头像地址', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: 'not-a-url' }).success).toBe(false)
  })

  /**
   * 这条是**回归护栏**，不是普通的字段校验。
   *
   * `role` 一旦带 `.default('candidate')`，zod 会在字段缺失时把值补上，
   * 于是「只改昵称」会被解析成 `{ name, role: 'candidate' }`，
   * 服务层按「传了就改」处理 —— 结果就是**面试官改个昵称就被踢回求职者侧**，
   * 而且极难自查（用户只会觉得「我明明是面试官，怎么变回去了」）。
   */
  it('只改昵称时不会顺带把身份重置为面试者', () => {
    const parsed = updateProfileSchema.safeParse({ name: '张三' })
    expect(parsed.success).toBe(true)
    expect(parsed.data).not.toHaveProperty('role')
  })

  it('显式切换身份时才带上 role', () => {
    expect(updateProfileSchema.safeParse({ role: 'interviewer' })).toMatchObject({
      success: true,
      data: { role: 'interviewer' },
    })
  })
})

describe('登录身份校验', () => {
  /** 同上：登录不传 role 必须是「保持现状」，而不是「切成面试者」 */
  it('不传 role 时不补默认值（否则每次登录都会重置身份）', () => {
    const parsed = loginSchema.safeParse({
      mode: 'password',
      identifier: 'interviewer@example.com',
      password: 'secret123',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).not.toHaveProperty('role')
  })

  it('传入 role 时原样透传', () => {
    const parsed = loginSchema.safeParse({
      mode: 'password',
      identifier: 'interviewer@example.com',
      password: 'secret123',
      role: 'interviewer',
    })
    expect(parsed.data).toMatchObject({ role: 'interviewer' })
  })
})

describe('注册身份校验', () => {
  it('不传 role 时默认面试者（注册必须有身份）', () => {
    const parsed = registerSchema.safeParse({
      channel: 'email',
      email: 'someone@example.com',
      password: 'secret123',
      acceptTerms: true,
    })
    expect(parsed.data).toMatchObject({ role: 'candidate' })
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
