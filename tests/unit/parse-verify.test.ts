import { describe, expect, it } from 'vitest'

import type { ResumeData } from '@/lib/ai/schemas/parse'
import { containsProhibited, verifyJdData, verifyMatchData, verifyResumeData } from '@/lib/parsing/verify'

const SOURCE = [
  '张伟 后端开发工程师',
  '技能：TypeScript、PostgreSQL、Docker',
  '项目：AI 面试平台',
  '负责评分服务开发。结果：接口 P95 延迟从 800ms 降至 220ms。',
].join('\n')

function resume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    name: '张伟',
    years: 3,
    skills: ['TypeScript', 'PostgreSQL'],
    projects: [
      {
        name: 'AI 面试平台',
        role: '后端开发',
        actions: ['负责评分服务开发'],
        results: ['接口 P95 延迟从 800ms 降至 220ms'],
        evidence: ['负责评分服务开发'],
      },
    ],
    education: [],
    risks: [],
    ...overrides,
  }
}

describe('简历后置校验：防编造（N4）', () => {
  it('保留原文中确实出现的技能', () => {
    const result = verifyResumeData(resume(), SOURCE)
    expect(result.data.skills).toEqual(['TypeScript', 'PostgreSQL'])
    expect(result.dropped).toHaveLength(0)
  })

  it('剔除原文中不存在的技能（模型编造）', () => {
    const result = verifyResumeData(
      resume({ skills: ['TypeScript', 'Kubernetes', 'Rust'] }),
      SOURCE,
    )

    expect(result.data.skills).toEqual(['TypeScript'])
    expect(result.dropped.map((item) => item.value)).toEqual(
      expect.arrayContaining(['Kubernetes', 'Rust']),
    )
    expect(result.dropped.every((item) => item.reason === 'not_in_source')).toBe(true)
  })

  it('剔除原文中不存在的项目', () => {
    const result = verifyResumeData(
      resume({
        projects: [
          { name: 'AI 面试平台', role: '', actions: [], results: [], evidence: [] },
          { name: '某大厂推荐系统', role: '负责人', actions: [], results: [], evidence: [] },
        ],
      }),
      SOURCE,
    )

    expect(result.data.projects.map((p) => p.name)).toEqual(['AI 面试平台'])
    expect(result.dropped[0]!.value).toBe('某大厂推荐系统')
  })

  it('允许 role 为空字符串（简历未写角色，不得推断）', () => {
    const result = verifyResumeData(
      resume({
        projects: [
          { name: 'AI 面试平台', role: '', actions: [], results: [], evidence: [] },
        ],
      }),
      SOURCE,
    )

    expect(result.data.projects[0]!.role).toBe('')
  })

  it('忽略大小写与空白差异（避免误杀）', () => {
    const result = verifyResumeData(resume({ skills: ['typescript', 'Postgre  SQL'] }), SOURCE)
    expect(result.data.skills).toHaveLength(2)
  })

  it('图片场景无原文时跳过一致性检查', () => {
    const result = verifyResumeData(resume({ skills: ['任意技能'] }), '')
    expect(result.data.skills).toEqual(['任意技能'])
  })
})

describe('简历后置校验：敏感信息过滤（N5）', () => {
  it('剔除含年龄/性别/婚育的条目', () => {
    const result = verifyResumeData(
      resume({
        risks: ['年龄 28 岁，精力充沛', '已婚已育，通勤方便', '项目描述无量化结果'],
      }),
      SOURCE,
    )

    expect(result.data.risks).toEqual(['项目描述无量化结果'])
    expect(result.dropped).toHaveLength(2)
    expect(result.dropped.every((item) => item.reason === 'sensitive')).toBe(true)
  })

  it('剔除含宗教/政治的条目', () => {
    const result = verifyResumeData(
      resume({ risks: ['信仰基督教', '政治面貌：党员', '经历时间存在重叠'] }),
      SOURCE,
    )
    expect(result.data.risks).toEqual(['经历时间存在重叠'])
  })

  it('姓名含敏感词时清空', () => {
    const result = verifyResumeData(resume({ name: '男，28 岁' }), SOURCE)
    expect(result.data.name).toBe('')
  })
})

describe('简历后置校验：禁止项过滤（合规 C5）', () => {
  it('剔除录用建议', () => {
    const result = verifyResumeData(
      resume({ risks: ['不建议录用该候选人', '项目描述无量化结果'] }),
      SOURCE,
    )
    expect(result.data.risks).toEqual(['项目描述无量化结果'])
    expect(result.dropped[0]!.reason).toBe('prohibited')
  })

  it('剔除性格与诚信判断', () => {
    const result = verifyResumeData(
      resume({ risks: ['性格偏内向', '疑似经历造假', '技能与项目无法对应'] }),
      SOURCE,
    )
    expect(result.data.risks).toEqual(['技能与项目无法对应'])
  })

  /**
   * 回归：`稳定性` 曾被整词判为「性格判断」，导致**正当的技术题**被拒绝。
   *
   * 实测现象：真实模型产出「请讲一次你负责排查线上性能或稳定性问题的经历」，
   * 被判「命中禁止项」→ 整个出题返回 502，用户只看到「生成面试计划失败」。
   * 而「稳定性」在技术语境里指系统/服务可靠性，JD 职责里就写着「稳定性保障」，
   * 第六个评分维度也叫「动机稳定性」——必须放行。
   */
  it('不得把技术语境的「稳定性」误判为性格判断', () => {
    const techStability = [
      '请讲一次你负责排查线上性能或稳定性问题的经历',
      '你如何保障服务稳定性与可用性',
      '该岗位职责包括接口性能优化与稳定性保障',
      '你对动机稳定性的理解是什么',
    ]
    for (const text of techStability) {
      expect(containsProhibited(text), `不应拦下：${text}`).toBe(false)
    }
  })

  it('仍拦下真正的性格与稳定性负面判断', () => {
    expect(containsProhibited('候选人性格偏内向')).toBe(true)
    expect(containsProhibited('职业稳定性差，可能频繁跳槽')).toBe(true)
    expect(containsProhibited('过往经历不稳定')).toBe(true)
  })
})

describe('JD 后置校验', () => {
  it('剔除含敏感要求的条目', () => {
    const result = verifyJdData({
      title: '后端工程师',
      company: '示例公司',
      must_have: ['熟悉 TypeScript', '年龄 30 岁以下', '限男性'],
      nice_to_have: [],
      responsibilities: [],
      keywords: [],
    })

    expect(result.data.must_have).toEqual(['熟悉 TypeScript'])
    expect(result.dropped).toHaveLength(2)
  })

  it('剔除录用建议类表述', () => {
    const result = verifyJdData({
      title: '',
      company: '',
      must_have: [],
      nice_to_have: [],
      responsibilities: ['负责招聘决策与淘汰'],
      keywords: [],
    })

    expect(result.data.responsibilities).toEqual([])
  })
})

describe('匹配分析后置校验', () => {
  it('剔除敏感与录用建议，保留正常内容', () => {
    const result = verifyMatchData({
      match_score: 70,
      advantages: [
        { point: '技术栈匹配', evidence: '熟悉 TypeScript' },
        { point: '年龄合适', evidence: '28 岁' },
      ],
      gaps: ['简历中未提及分布式系统经验', '性格不稳定'],
      suggested_questions: [
        { question: '请介绍一次性能优化经历', based_on: 'advantage' },
        { question: '你打算什么时候结婚', based_on: 'gap' },
      ],
    })

    expect(result.data.advantages).toHaveLength(1)
    expect(result.data.gaps).toEqual(['简历中未提及分布式系统经验'])
    expect(result.data.suggested_questions).toHaveLength(1)
    expect(result.data.match_score).toBe(70)
    expect(result.dropped).toHaveLength(3)
  })
})
