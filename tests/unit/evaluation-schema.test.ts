import { describe, expect, it } from 'vitest'

import {
  evaluationParseSchema,
  GENERIC_IMPROVEMENT_HINT,
  hasLowDimension,
  isNoAnswer,
  LOW_SCORE_THRESHOLD,
  reportParseSchema,
  verifyEvidenceQuotes,
  type EvaluationData,
} from '@/lib/ai/schemas/evaluation'
import { buildEvaluationPrompt, buildReportPrompt } from '@/lib/ai/prompts/evaluation'

const ANSWER =
  '我在 AI 面试平台项目里负责评分服务重构，用两阶段提交保证数据一致性，接口 P95 从 800ms 降到 220ms。'

function validEvaluation(overrides: Partial<EvaluationData> = {}): unknown {
  return {
    schema_version: '1.0',
    data: {
      dimension_scores: {
        job_match: 4,
        professional: 4,
        project_depth: 3,
        logic: 4,
        communication: 4,
        motivation: 3,
      },
      evidence_quotes: [
        { quote: '用两阶段提交保证数据一致性', reason: '体现了数据一致性方案' },
        { quote: 'P95 从 800ms 降到 220ms', reason: '有量化结果' },
      ],
      feedback: '整体不错，项目深度可以再补充技术选型的取舍依据。',
      better_answer: '建议补充为什么选择两阶段提交，以及对比过哪些替代方案。',
      reference_answer:
        '我在【待补充：项目名】负责评分服务重构。当时接口 P95 达到 800ms，' +
        '我的任务是在不牺牲准确性的前提下降低延迟。我改用两阶段提交保证一致性，' +
        '最终 P95 降到 220ms。面试前请把【】里的内容换成你的真实数据。',
      ...overrides,
    },
  }
}

describe('逐题评分 schema', () => {
  it('接受合法输出', () => {
    expect(evaluationParseSchema.safeParse(validEvaluation()).success).toBe(true)
  })

  it('拒绝越界的维度分（含负数与超过 5）', () => {
    for (const value of [-1, 6, 10]) {
      const payload = validEvaluation()
      ;(payload as { data: EvaluationData }).data.dimension_scores.job_match = value
      expect(evaluationParseSchema.safeParse(payload).success, `score=${value} 应被拒绝`).toBe(false)
    }
  })

  it('拒绝非整数的维度分', () => {
    const payload = validEvaluation()
    ;(payload as { data: EvaluationData }).data.dimension_scores.logic = 3.5
    expect(evaluationParseSchema.safeParse(payload).success).toBe(false)
  })

  it('拒绝缺少任一维度', () => {
    const payload = validEvaluation()
    const data = (payload as { data: Record<string, unknown> }).data
    delete (data.dimension_scores as Record<string, unknown>).motivation
    expect(evaluationParseSchema.safeParse(payload).success).toBe(false)
  })

  it('拒绝多余维度', () => {
    const payload = validEvaluation()
    const data = (payload as { data: Record<string, unknown> }).data
    ;(data.dimension_scores as Record<string, unknown>).appearance = 5
    expect(evaluationParseSchema.safeParse(payload).success).toBe(false)
  })

  it('拒绝空证据数组（评分必须引用证据）', () => {
    expect(
      evaluationParseSchema.safeParse(validEvaluation({ evidence_quotes: [] })).success,
    ).toBe(false)
  })

  it('拒绝证据缺少 reason', () => {
    expect(
      evaluationParseSchema.safeParse(
        validEvaluation({ evidence_quotes: [{ quote: '用两阶段提交' }] as never }),
      ).success,
    ).toBe(false)
  })

  it('拒绝多余字段', () => {
    const payload = validEvaluation()
    ;(payload as { data: Record<string, unknown> }).data.score = 88
    expect(evaluationParseSchema.safeParse(payload).success).toBe(false)
  })

  it('拒绝缺少 schema_version', () => {
    const payload = validEvaluation() as { data: unknown }
    expect(evaluationParseSchema.safeParse({ data: payload.data }).success).toBe(false)
  })
})

describe('证据引用校验（防编造引用）', () => {
  it('保留确为回答原文子串的引用', () => {
    const result = verifyEvidenceQuotes(
      [
        { quote: '用两阶段提交保证数据一致性', reason: 'r1' },
        { quote: 'P95 从 800ms 降到 220ms', reason: 'r2' },
      ],
      ANSWER,
    )
    expect(result.quotes).toHaveLength(2)
    expect(result.dropped).toHaveLength(0)
  })

  it('剔除不是原文子串的引用（模型编造）', () => {
    const result = verifyEvidenceQuotes(
      [
        { quote: '我用了 Kubernetes 做服务编排', reason: '编造的引用' },
        { quote: '用两阶段提交保证数据一致性', reason: '真实引用' },
      ],
      ANSWER,
    )
    expect(result.quotes).toHaveLength(1)
    expect(result.dropped[0]!.reason).toContain('不是回答原文的子串')
  })

  it('忽略空白与大小写差异（避免误杀）', () => {
    const result = verifyEvidenceQuotes(
      [{ quote: 'p95   从 800ms 降到 220ms', reason: 'r' }],
      ANSWER,
    )
    expect(result.quotes).toHaveLength(1)
  })

  it('剔除过短的引用', () => {
    const result = verifyEvidenceQuotes([{ quote: 'P95', reason: 'r' }], ANSWER)
    expect(result.quotes).toHaveLength(0)
    expect(result.dropped[0]!.reason).toContain('过短')
  })

  it('剔除命中敏感或禁止项的引用', () => {
    const answer = '我今年 28 岁，技术上会用 TypeScript 开发后端服务。'
    const result = verifyEvidenceQuotes(
      [
        { quote: '我今年 28 岁', reason: '敏感' },
        { quote: '会用 TypeScript 开发后端服务', reason: '正常' },
      ],
      answer,
    )
    expect(result.quotes).toHaveLength(1)
    expect(result.dropped[0]!.reason).toContain('敏感')
  })

  it('全部不匹配时返回空列表（调用方据此判失败并重试）', () => {
    const result = verifyEvidenceQuotes(
      [{ quote: '完全不存在的一段话内容', reason: 'r' }],
      ANSWER,
    )
    expect(result.quotes).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
  })
})

describe('低分与未作答判定', () => {
  it('存在低于 3 分的维度即视为低分', () => {
    expect(
      hasLowDimension({
        job_match: 3,
        professional: 3,
        project_depth: 2,
        logic: 3,
        communication: 3,
        motivation: 3,
      }),
    ).toBe(true)
  })

  it('全部不低于 3 分时不为低分', () => {
    expect(
      hasLowDimension({
        job_match: 3,
        professional: 4,
        project_depth: 5,
        logic: 3,
        communication: 3,
        motivation: 3,
      }),
    ).toBe(false)
  })

  it('阈值常量符合约定', () => {
    expect(LOW_SCORE_THRESHOLD).toBe(3)
  })

  it('空回答与极短回答被判定为未作答', () => {
    expect(isNoAnswer('')).toBe(true)
    expect(isNoAnswer('   ')).toBe(true)
    expect(isNoAnswer('不知道')).toBe(true)
    expect(isNoAnswer(ANSWER)).toBe(false)
  })

  it('通用建议非空（低分兜底用）', () => {
    expect(GENERIC_IMPROVEMENT_HINT.length).toBeGreaterThan(10)
  })
})

describe('报告 schema', () => {
  const validReport = {
    schema_version: '1.0',
    data: {
      summary: '整体表现中等，项目描述缺少取舍说明。',
      highlights: ['量化结果清晰'],
      issues: ['下次可以补充技术选型的对比依据'],
      reference_answers: [
        { question: '请介绍一次性能优化经历', improvement: '补充优化前后的指标与方案对比' },
      ],
      next_actions: ['补充 1 个可量化的项目结果'],
      resume_risks: ['项目描述无任何量化结果'],
    },
  }

  it('接受合法报告', () => {
    expect(reportParseSchema.safeParse(validReport).success).toBe(true)
  })

  it('拒绝缺少字段（reference_answers）', () => {
    const { reference_answers: _omitted, ...data } = validReport.data
    expect(reportParseSchema.safeParse({ ...validReport, data }).success).toBe(false)
  })

  it('拒绝多余字段', () => {
    const data = { ...validReport.data, overall_score: 88 }
    expect(reportParseSchema.safeParse({ ...validReport, data }).success).toBe(false)
  })

  it('拒绝参考回答缺少 improvement', () => {
    const data = { ...validReport.data, reference_answers: [{ question: 'Q' }] }
    expect(reportParseSchema.safeParse({ ...validReport, data }).success).toBe(false)
  })

  it('拒绝超长的 next_actions 条数', () => {
    const data = { ...validReport.data, next_actions: Array.from({ length: 9 }, () => 'x') }
    expect(reportParseSchema.safeParse({ ...validReport, data }).success).toBe(false)
  })
})

describe('prompt 组装', () => {
  it('评分 prompt 声明证据必须逐字复制且校验子串', () => {
    const prompt = buildEvaluationPrompt({
      jdJson: '{"must_have":["PostgreSQL"]}',
      resumeJson: '{"name":"张伟","projects":[{"name":"AI 面试平台"}]}',
      question: '请介绍一次性能优化经历',
      questionType: 'technical',
      expectedPoints: ['说明背景', '给出量化结果'],
      answer: ANSWER,
    })

    expect(prompt.user).toContain(ANSWER)
    expect(prompt.user).toContain('说明背景')
    expect(prompt.system).toContain('逐字复制')
    expect(prompt.system).toContain('子串')
    expect(prompt.system).toContain('禁止编造')
  })

  it('评分 prompt 要求参考答案基于简历、按 STAR 组织并禁止编造数字', () => {
    const prompt = buildEvaluationPrompt({
      jdJson: '{"must_have":["PostgreSQL"]}',
      resumeJson: '{"name":"张伟","years":3,"skills":["PostgreSQL"]}',
      question: '请说明 PostgreSQL 索引失效场景',
      questionType: 'technical',
      expectedPoints: ['失效场景'],
      answer: ANSWER,
    })

    // 简历必须真的传给模型——否则参考答案只能泛泛而谈或编造经历（N4）
    expect(prompt.user).toContain('候选人简历')
    expect(prompt.user).toContain('PostgreSQL')
    expect(prompt.system).toContain('STAR')
    expect(prompt.system).toContain('待补充')
    expect(prompt.system).toContain('只能使用候选人简历')
    expect(prompt.system).toContain('绝不允许编造具体数字')
  })

  it('评分 prompt 包含六维说明', () => {
    const prompt = buildEvaluationPrompt({
      jdJson: '',
      resumeJson: '',
      question: 'Q',
      questionType: 'technical',
      expectedPoints: [],
      answer: 'A',
    })
    for (const dimension of ['job_match', 'professional', 'project_depth', 'logic', 'communication', 'motivation']) {
      expect(prompt.system).toContain(dimension)
    }
  })

  it('报告 prompt 要求题目原样取自面试题、疑点不得新增', () => {
    const prompt = buildReportPrompt({
      evaluationsJson: '[]',
      resumeRisks: ['项目描述无任何量化结果'],
      jdJson: '{}',
    })
    expect(prompt.system).toContain('原样取自')
    expect(prompt.system).toContain('不得新增')
    expect(prompt.user).toContain('项目描述无任何量化结果')
  })
})
