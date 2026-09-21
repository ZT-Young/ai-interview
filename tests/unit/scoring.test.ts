import { describe, expect, it } from 'vitest'

import type { DimensionScores } from '@/lib/ai/schemas/evaluation'
import {
  aggregateDimensionScores,
  computeSessionScores,
  MAX_DIMENSION_SUM,
  questionScoreOf,
  round1,
  totalScoreOf,
} from '@/lib/ai/scoring'

function scores(overrides: Partial<DimensionScores> = {}): DimensionScores {
  return {
    job_match: 3,
    professional: 3,
    project_depth: 3,
    logic: 3,
    communication: 3,
    motivation: 3,
    ...overrides,
  }
}

describe('评分公式', () => {
  it('六维满分常量为 30', () => {
    expect(MAX_DIMENSION_SUM).toBe(30)
  })

  it('round1 保留一位小数', () => {
    expect(round1(1.25)).toBe(1.3)
    expect(round1(1.24)).toBe(1.2)
    expect(round1(33.333)).toBe(33.3)
  })

  it('全 0 → 单题 0 分', () => {
    expect(questionScoreOf(scores({ job_match: 0, professional: 0, project_depth: 0, logic: 0, communication: 0, motivation: 0 }))).toBe(0)
  })

  it('全 5 → 单题 100 分', () => {
    expect(questionScoreOf(scores({ job_match: 5, professional: 5, project_depth: 5, logic: 5, communication: 5, motivation: 5 }))).toBe(100)
  })

  it('全 3（60%）→ 单题 60 分', () => {
    expect(questionScoreOf(scores())).toBe(60)
  })

  it('单题分始终落在 0-100', () => {
    for (let value = 0; value <= 5; value += 1) {
      const result = questionScoreOf(
        scores({
          job_match: value,
          professional: value,
          project_depth: value,
          logic: value,
          communication: value,
          motivation: value,
        }),
      )
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(100)
    }
  })

  it('六维不等时按总和折算', () => {
    // 5+4+3+2+1+0 = 15 → 15/30 = 50
    const result = questionScoreOf({
      job_match: 5,
      professional: 4,
      project_depth: 3,
      logic: 2,
      communication: 1,
      motivation: 0,
    })
    expect(result).toBe(50)
  })
})

describe('六维汇总与总分', () => {
  it('无评分时全 0（不产生 NaN）', () => {
    const dimensions = aggregateDimensionScores([])
    expect(Object.values(dimensions).every((value) => value === 0)).toBe(true)
    expect(totalScoreOf(dimensions)).toBe(0)
  })

  it('单题时汇总分等于该题六维分', () => {
    const dimensions = aggregateDimensionScores([scores({ job_match: 5 })])
    expect(dimensions.job_match).toBe(5)
    expect(dimensions.professional).toBe(3)
  })

  it('多题取算术平均', () => {
    const dimensions = aggregateDimensionScores([
      scores({ job_match: 5 }),
      scores({ job_match: 3 }),
      scores({ job_match: 1 }),
    ])
    // (5+3+1)/3 = 3
    expect(dimensions.job_match).toBe(3)
  })

  it('平均结果保留一位小数', () => {
    const dimensions = aggregateDimensionScores([
      scores({ logic: 5 }),
      scores({ logic: 4 }),
      scores({ logic: 4 }),
    ])
    // (5+4+4)/3 = 4.333… → 4.3
    expect(dimensions.logic).toBe(4.3)
  })

  it('总分 = 六维汇总 / 30 × 100', () => {
    const dimensions = aggregateDimensionScores([scores()]) // 全 3
    expect(totalScoreOf(dimensions)).toBe(60)
  })

  it('六维等权 → 总分等于各题折算分的均值', () => {
    const perQuestion = [scores({ job_match: 5, professional: 5 }), scores({ logic: 2 })]
    const { totalScore } = computeSessionScores(perQuestion)

    const expected = round1(
      perQuestion.reduce((acc, item) => acc + questionScoreOf(item), 0) / perQuestion.length,
    )
    // 允许 0.1 的四舍五入差异
    expect(Math.abs(totalScore - expected)).toBeLessThanOrEqual(0.1)
  })

  it('总分始终落在 0-100', () => {
    const allMax = computeSessionScores([scores({ job_match: 5, professional: 5, project_depth: 5, logic: 5, communication: 5, motivation: 5 })])
    const allMin = computeSessionScores([scores({ job_match: 0, professional: 0, project_depth: 0, logic: 0, communication: 0, motivation: 0 })])

    expect(allMax.totalScore).toBe(100)
    expect(allMin.totalScore).toBe(0)
  })

  it('返回题量以便报告展示', () => {
    const result = computeSessionScores([scores(), scores(), scores()])
    expect(result.questionCount).toBe(3)
  })
})
