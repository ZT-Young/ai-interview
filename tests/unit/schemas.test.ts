import { describe, expect, it } from 'vitest'

import {
  isJdDataEmpty,
  isResumeDataEmpty,
  jdParseSchema,
  matchParseSchema,
  resumeParseSchema,
} from '@/lib/ai/schemas/parse'

/** 合法的 JD 信封样例 */
const validJd = {
  schema_version: '1.0',
  data: {
    title: 'AI 应用开发工程师',
    company: '示例科技',
    must_have: ['3 年以上 Node.js 经验', '熟悉 TypeScript'],
    nice_to_have: ['有 LLM 应用落地经验'],
    responsibilities: ['负责后端开发'],
    keywords: ['TypeScript', 'PostgreSQL'],
  },
}

const validResume = {
  schema_version: '1.0',
  data: {
    name: '张伟',
    years: 3,
    skills: ['TypeScript'],
    projects: [
      {
        name: 'AI 面试平台',
        role: '后端开发',
        actions: ['开发评分服务'],
        results: ['P95 降至 220ms'],
        evidence: ['接口 P95 延迟从 800ms 降至 220ms'],
      },
    ],
    education: [],
    risks: [],
  },
}

const validMatch = {
  schema_version: '1.0',
  data: {
    match_score: 72,
    advantages: [{ point: '技术栈匹配', evidence: '熟悉 TypeScript' }],
    gaps: ['简历中未提及分布式系统经验'],
    suggested_questions: [{ question: '请介绍一次性能优化经历', based_on: 'advantage' }],
  },
}

describe('JD schema', () => {
  it('接受合法输出', () => {
    expect(jdParseSchema.safeParse(validJd).success).toBe(true)
  })

  it('拒绝缺少 schema_version 的输出', () => {
    const { schema_version: _omitted, ...rest } = validJd
    expect(jdParseSchema.safeParse(rest).success).toBe(false)
  })

  it('拒绝版本号错误', () => {
    expect(jdParseSchema.safeParse({ ...validJd, schema_version: '2.0' }).success).toBe(false)
  })

  it('拒绝缺失必填字段', () => {
    const { must_have: _omitted, ...data } = validJd.data
    expect(jdParseSchema.safeParse({ ...validJd, data }).success).toBe(false)
  })

  it('拒绝多余字段（additionalProperties: false）', () => {
    const data = { ...validJd.data, salary: '30k' }
    expect(jdParseSchema.safeParse({ ...validJd, data }).success).toBe(false)
  })

  it('拒绝类型错误', () => {
    const data = { ...validJd.data, must_have: 'not-an-array' }
    expect(jdParseSchema.safeParse({ ...validJd, data }).success).toBe(false)
  })

  it('数组超限被拒绝', () => {
    const data = { ...validJd.data, must_have: Array.from({ length: 25 }, () => 'x') }
    expect(jdParseSchema.safeParse({ ...validJd, data }).success).toBe(false)
  })

  it('把 null 归一化为空字符串 / 空数组（模型常见返回）', () => {
    const data = { ...validJd.data, title: null, company: null, keywords: null }
    const result = jdParseSchema.safeParse({ ...validJd, data })
    expect(result.success).toBe(true)
    expect(result.success && result.data.data.title).toBe('')
    expect(result.success && result.data.data.keywords).toEqual([])
  })
})

describe('简历 schema', () => {
  it('接受合法输出', () => {
    expect(resumeParseSchema.safeParse(validResume).success).toBe(true)
  })

  it('拒绝 projects 中缺少 role 的对象', () => {
    const data = {
      ...validResume.data,
      projects: [{ name: 'P', actions: [], results: [], evidence: [] }],
    }
    expect(resumeParseSchema.safeParse({ ...validResume, data }).success).toBe(false)
  })

  it('拒绝越界的 years', () => {
    for (const years of [-1, 61, 1.5]) {
      const data = { ...validResume.data, years }
      expect(resumeParseSchema.safeParse({ ...validResume, data }).success).toBe(false)
    }
  })

  it('years 为 null 时归一化为 0', () => {
    const data = { ...validResume.data, years: null }
    const result = resumeParseSchema.safeParse({ ...validResume, data })
    expect(result.success && result.data.data.years).toBe(0)
  })

  it('允许 role 为空字符串（简历未写角色，不得推断）', () => {
    const data = {
      ...validResume.data,
      projects: [
        { name: 'AI 面试平台', role: '', actions: [], results: [], evidence: [] },
      ],
    }
    const result = resumeParseSchema.safeParse({ ...validResume, data })
    expect(result.success).toBe(true)
    expect(result.success && result.data.data.projects[0]!.role).toBe('')
  })

  it('拒绝多余字段', () => {
    const data = { ...validResume.data, age: 28 }
    expect(resumeParseSchema.safeParse({ ...validResume, data }).success).toBe(false)
  })
})

describe('匹配 schema', () => {
  it('接受合法输出', () => {
    expect(matchParseSchema.safeParse(validMatch).success).toBe(true)
  })

  it('拒绝越界的 match_score', () => {
    for (const score of [-1, 101]) {
      const data = { ...validMatch.data, match_score: score }
      expect(matchParseSchema.safeParse({ ...validMatch, data }).success).toBe(false)
    }
  })

  it('拒绝非法 based_on 取值', () => {
    const data = {
      ...validMatch.data,
      suggested_questions: [{ question: 'Q', based_on: 'unknown' }],
    }
    expect(matchParseSchema.safeParse({ ...validMatch, data }).success).toBe(false)
  })

  it('拒绝 advantages 缺少 evidence', () => {
    const data = { ...validMatch.data, advantages: [{ point: '只有观点' }] }
    expect(matchParseSchema.safeParse({ ...validMatch, data }).success).toBe(false)
  })
})

describe('空内容判定', () => {
  it('JD 全空被识别', () => {
    expect(
      isJdDataEmpty({
        title: '',
        company: '',
        must_have: [],
        nice_to_have: [],
        responsibilities: [],
        keywords: [],
      }),
    ).toBe(true)
  })

  it('JD 有任何内容即非空', () => {
    expect(
      isJdDataEmpty({
        title: 'AI 工程师',
        company: '',
        must_have: [],
        nice_to_have: [],
        responsibilities: [],
        keywords: [],
      }),
    ).toBe(false)
  })

  it('简历全空被识别', () => {
    expect(
      isResumeDataEmpty({
        name: '',
        years: 0,
        skills: [],
        projects: [],
        education: [],
        risks: [],
      }),
    ).toBe(true)
  })

  it('简历仅剩姓名也算非空', () => {
    expect(
      isResumeDataEmpty({
        name: '张伟',
        years: 0,
        skills: [],
        projects: [],
        education: [],
        risks: [],
      }),
    ).toBe(false)
  })
})
