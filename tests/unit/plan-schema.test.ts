import { describe, expect, it } from 'vitest'

import {
  analyzePlan,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  planParseSchema,
  planQuestionSchema,
  type PlanData,
  type PlanQuestion,
} from '@/lib/ai/schemas/plan'

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

function question(overrides: Partial<PlanQuestion> = {}): PlanQuestion {
  return {
    content: '请介绍一次你负责的性能优化经历，说明背景、做法和结果。',
    type: 'technical',
    source: 'jd',
    dimension: 'professional',
    expected_points: ['说明背景与指标', '给出具体做法', '给出量化结果'],
    follow_up_allowed: true,
    ...overrides,
  }
}

/**
 * 生成满足配额的题目集合。
 * 默认 12 题：self_intro 1 + project_dig 4 + technical 4 + behavioral 2 + reverse 1
 */
function buildQuestions(count = 12, overrides: Partial<PlanQuestion> = {}): PlanQuestion[] {
  const pool: PlanQuestion[] = [
    question({ content: '请先做一个自我介绍。', type: 'self_intro', source: 'generic', dimension: 'communication', follow_up_allowed: false }),
    question({ content: '请介绍 AI 面试平台这个项目你负责的部分。', type: 'project_dig', source: 'resume', dimension: 'project_depth' }),
    question({ content: '这个项目的技术难点是什么，你怎么权衡的？', type: 'project_dig', source: 'both', dimension: 'project_depth' }),
    question({ content: '项目里数据一致性是如何保证的？', type: 'project_dig', source: 'resume', dimension: 'professional' }),
    question({ content: '你在这个项目中的角色和协作方式是怎样的？', type: 'project_dig', source: 'resume', dimension: 'communication' }),
    question({ content: '请说明 PostgreSQL 索引在什么场景下会失效。', type: 'technical', source: 'jd', dimension: 'professional' }),
    question({ content: 'TypeScript 的泛型约束你通常怎么设计？', type: 'technical', source: 'jd', dimension: 'professional' }),
    question({ content: '高并发下你会怎么设计限流方案？', type: 'technical', source: 'jd', dimension: 'professional' }),
    question({ content: '分布式系统里你如何处理幂等？', type: 'technical', source: 'jd', dimension: 'professional' }),
    question({ content: '请讲一次你和同事意见不一致的经历，你怎么处理的？', type: 'behavioral', source: 'both', dimension: 'communication' }),
    question({ content: '请讲一次你在有限时间内交付目标的经历。', type: 'behavioral', source: 'resume', dimension: 'motivation' }),
    question({ content: '关于这个岗位，你想了解什么？', type: 'reverse', source: 'generic', dimension: 'motivation', follow_up_allowed: false }),
  ]

  return pool.slice(0, count).map((item) => ({ ...item, ...overrides }))
}

function planOf(questions: PlanQuestion[]): PlanData {
  return { questions }
}

/* ------------------------------------------------------------------ *
 * Schema 校验
 * ------------------------------------------------------------------ */

describe('面试计划 schema', () => {
  it('接受合法的 12 题信封', () => {
    const result = planParseSchema.safeParse({
      schema_version: '1.0',
      data: planOf(buildQuestions(12)),
    })
    expect(result.success).toBe(true)
  })

  it('拒绝题量不足 8 道', () => {
    const result = planParseSchema.safeParse({
      schema_version: '1.0',
      data: planOf(buildQuestions(7)),
    })
    expect(result.success).toBe(false)
  })

  it('拒绝题量超过 12 道', () => {
    const many = [...buildQuestions(12), question({ content: '额外的一道题内容。' })]
    const result = planParseSchema.safeParse({ schema_version: '1.0', data: planOf(many) })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 schema_version', () => {
    expect(planParseSchema.safeParse({ data: planOf(buildQuestions(8)) }).success).toBe(false)
  })

  it('拒绝缺少必填字段（follow_up_allowed）', () => {
    const { follow_up_allowed: _omitted, ...rest } = question()
    expect(planQuestionSchema.safeParse(rest).success).toBe(false)
  })

  it('拒绝非法 type 取值', () => {
    expect(
      planQuestionSchema.safeParse({ ...question(), type: 'unknown_type' }).success,
    ).toBe(false)
  })

  it('拒绝非法 source 取值', () => {
    expect(planQuestionSchema.safeParse({ ...question(), source: 'hr' }).success).toBe(false)
  })

  it('拒绝非法 dimension 取值（必须来自六维）', () => {
    expect(
      planQuestionSchema.safeParse({ ...question(), dimension: 'looks' }).success,
    ).toBe(false)
  })

  it('拒绝多余字段', () => {
    expect(
      planQuestionSchema.safeParse({ ...question(), answer: '不应该出现' }).success,
    ).toBe(false)
  })

  it('拒绝期望要点少于 2 条', () => {
    expect(
      planQuestionSchema.safeParse({ ...question(), expected_points: ['只有一条'] }).success,
    ).toBe(false)
  })

  it('拒绝期望要点超过 5 条', () => {
    expect(
      planQuestionSchema.safeParse({
        ...question(),
        expected_points: ['1', '2', '3', '4', '5', '6'],
      }).success,
    ).toBe(false)
  })

  it('把 null 归一化为空数组 / 默认值', () => {
    const result = planQuestionSchema.safeParse({
      ...question(),
      expected_points: null,
      follow_up_allowed: null,
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.expected_points).toEqual([])
    expect(result.success && result.data.follow_up_allowed).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 数量与类型覆盖
 * ------------------------------------------------------------------ */

describe('配额与类型覆盖', () => {
  it('完整 12 题通过', () => {
    const analysis = analyzePlan(planOf(buildQuestions(12)))
    expect(analysis.ok).toBe(true)
    expect(analysis.violations).toEqual([])
    expect(analysis.quota).toEqual({
      self_intro: 1,
      project_dig: 4,
      technical: 4,
      behavioral: 2,
      reverse: 1,
    })
  })

  it('恰好 8 题也通过（总数下限，配额为 1+3+2+1+1）', () => {
    const eight: PlanQuestion[] = [
      question({ content: '请先做一个自我介绍。', type: 'self_intro', source: 'generic', dimension: 'communication', follow_up_allowed: false }),
      question({ content: '请介绍 AI 面试平台这个项目你负责的部分。', type: 'project_dig', source: 'resume', dimension: 'project_depth' }),
      question({ content: '这个项目的技术难点是什么，你怎么权衡的？', type: 'project_dig', source: 'both', dimension: 'project_depth' }),
      question({ content: '项目里数据一致性是如何保证的？', type: 'project_dig', source: 'resume', dimension: 'professional' }),
      question({ content: '请说明 PostgreSQL 索引在什么场景下会失效。', type: 'technical', source: 'jd', dimension: 'professional' }),
      question({ content: '高并发下你会怎么设计限流方案？', type: 'technical', source: 'jd', dimension: 'professional' }),
      question({ content: '请讲一次你在有限时间内交付目标的经历。', type: 'behavioral', source: 'resume', dimension: 'motivation' }),
      question({ content: '关于这个岗位，你想了解什么？', type: 'reverse', source: 'generic', dimension: 'motivation', follow_up_allowed: false }),
    ]

    const analysis = analyzePlan(planOf(eight))
    expect(eight).toHaveLength(8)
    expect(analysis.violations).toEqual([])
    expect(analysis.ok).toBe(true)
    expect(analysis.quota).toEqual({
      self_intro: 1,
      project_dig: 3,
      technical: 2,
      behavioral: 1,
      reverse: 1,
    })
  })

  it('7 题被拒绝（低于下限）', () => {
    const analysis = analyzePlan(planOf(buildQuestions(12).slice(0, 7)))
    expect(analysis.ok).toBe(false)
    expect(analysis.violations.join(' ')).toContain('8-12')
  })

  it('五种题型齐全（typesPresent 覆盖全部）', () => {
    const analysis = analyzePlan(planOf(buildQuestions(12)))
    expect(analysis.typesPresent.sort()).toEqual(
      ['behavioral', 'project_dig', 'reverse', 'self_intro', 'technical'].sort(),
    )
  })

  it('缺少任一题型即失败', () => {
    for (const missing of ['self_intro', 'project_dig', 'technical', 'behavioral', 'reverse'] as const) {
      const questions = buildQuestions(12).filter((item) => item.type !== missing)
      const analysis = analyzePlan(planOf(questions))
      expect(analysis.ok).toBe(false)
      expect(analysis.violations.join(' ')).toContain(missing === missing ? missing : missing)
    }
  })

  it('self_intro 出现 2 次即失败（必须恰好 1 次）', () => {
    const questions = buildQuestions(12)
    questions.push(
      question({ content: '再来一次自我介绍。', type: 'self_intro', source: 'generic', dimension: 'communication', follow_up_allowed: false }),
    )
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
    expect(analysis.violations.join(' ')).toContain('self_intro')
  })

  it('reverse 出现 2 次即失败', () => {
    const questions = buildQuestions(12)
    questions[0] = { ...questions[0]!, type: 'reverse', source: 'generic' }
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
  })

  it('project_dig 超过 4 道即失败', () => {
    const questions = buildQuestions(12).map((item) =>
      item.type === 'behavioral' ? { ...item, type: 'project_dig' as const } : item,
    )
    // 现在 project_dig = 6，behavioral = 0
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
    expect(analysis.violations.join(' ')).toContain('project_dig')
  })

  it('题目重复即失败', () => {
    const questions = buildQuestions(12)
    questions[1] = { ...questions[1]!, content: questions[2]!.content }
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
    expect(analysis.violations.join(' ')).toContain('重复')
  })

  it('内容过短即失败', () => {
    const questions = buildQuestions(12)
    questions[1] = { ...questions[1]!, content: '嗯' }
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
    expect(analysis.violations.join(' ')).toContain('过短')
  })

  it('MIN/MAX 常量符合需求（8-12）', () => {
    expect(MIN_QUESTIONS).toBe(8)
    expect(MAX_QUESTIONS).toBe(12)
  })
})

/* ------------------------------------------------------------------ *
 * 不编造与合规
 * ------------------------------------------------------------------ */

describe('可溯源与合规校验', () => {
  it('专业题标 generic 即失败（防编造）', () => {
    const questions = buildQuestions(12)
    questions[5] = { ...questions[5]!, source: 'generic' }
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
    expect(analysis.violations.join(' ')).toContain('generic')
  })

  it('项目深挖题标 generic 即失败', () => {
    const questions = buildQuestions(12)
    questions[1] = { ...questions[1]!, source: 'generic' }
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
  })

  it('行为题标 generic 即失败', () => {
    const questions = buildQuestions(12)
    questions[9] = { ...questions[9]!, source: 'generic' }
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
  })

  it('自我介绍使用 generic 是允许的', () => {
    const analysis = analyzePlan(planOf(buildQuestions(12)))
    expect(analysis.ok).toBe(true)
  })

  it('命中敏感问题即失败（N5）', () => {
    const questions = buildQuestions(12)
    questions.push(
      question({ content: '你今年多大，结婚了吗？', type: 'behavioral', source: 'both' }),
    )
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
    expect(analysis.violations.join(' ')).toContain('敏感')
  })

  it('命中录用建议类表述即失败（合规 C5）', () => {
    const questions = buildQuestions(12)
    questions.push(
      question({ content: '你觉得自己会被淘汰吗？', type: 'behavioral', source: 'both' }),
    )
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.ok).toBe(false)
  })

  it('返回全部违规项而非首条', () => {
    const questions = buildQuestions(12).filter(
      (item) => item.type !== 'behavioral' && item.type !== 'reverse',
    )
    const analysis = analyzePlan(planOf(questions))
    expect(analysis.violations.length).toBeGreaterThan(1)
  })
})
