import { describe, expect, it } from 'vitest'

import type { ScoreDimension } from '@/lib/constants/questions'
import { SCORE_DIMENSION_VALUES } from '@/lib/constants/questions'
import {
  BENEFIT_MATRIX,
  maskProviderOrderId,
  MEMBERSHIP_LABELS,
} from '@/lib/services/membership-service'
import { buildBaseSuggestions } from '@/lib/services/report-service'

function dimensions(overrides: Partial<Record<ScoreDimension, number>> = {}) {
  const base = {} as Record<ScoreDimension, number>
  for (const dimension of SCORE_DIMENSION_VALUES) base[dimension] = 4
  return { ...base, ...overrides }
}

describe('基础训练建议生成（免费可见）', () => {
  it('全部维度达标时不生成建议', () => {
    expect(buildBaseSuggestions(dimensions())).toEqual([])
  })

  it('仅对低于 3 分的维度生成建议', () => {
    const result = buildBaseSuggestions(dimensions({ logic: 2 }))
    expect(result).toHaveLength(1)
    expect(result[0]!.dimension).toBe('logic')
    expect(result[0]!.text.length).toBeGreaterThan(5)
  })

  it('按分数升序排序（最弱的排最前）', () => {
    const result = buildBaseSuggestions(
      dimensions({ logic: 2, professional: 0, project_depth: 1 }),
    )
    expect(result.map((item) => item.dimension)).toEqual(['professional', 'project_depth', 'logic'])
  })

  it('恰好 3 分不算低分（边界）', () => {
    expect(buildBaseSuggestions(dimensions({ logic: 3 }))).toEqual([])
  })

  it('每个维度都有可执行建议文案', () => {
    const all: Partial<Record<ScoreDimension, number>> = {}
    for (const dimension of SCORE_DIMENSION_VALUES) all[dimension] = 0
    const result = buildBaseSuggestions(dimensions(all))
    expect(result).toHaveLength(SCORE_DIMENSION_VALUES.length)
    for (const item of result) {
      expect(item.text.length).toBeGreaterThan(8)
    }
  })

  it('缺失维度按 0 处理', () => {
    const partial = { ...dimensions() } as Record<string, number>
    delete partial.motivation
    const result = buildBaseSuggestions(partial as never)
    expect(result.some((item) => item.dimension === 'motivation')).toBe(true)
  })
})

describe('会员权益与订单脱敏', () => {
  it('权益表覆盖免费与付费的边界', () => {
    const freeFeatures = BENEFIT_MATRIX.filter((item) => item.free).map((item) => item.feature)
    const paidFeatures = BENEFIT_MATRIX.filter((item) => !item.free).map((item) => item.feature)

    expect(freeFeatures.length).toBeGreaterThan(0)
    expect(paidFeatures.length).toBeGreaterThan(0)
    // 免费项必须同时是会员项（不得出现「免费有、会员没有」）
    for (const item of BENEFIT_MATRIX) {
      if (item.free) expect(item.member).toBe(true)
    }
  })

  it('等级中文名齐备', () => {
    expect(MEMBERSHIP_LABELS.free).toBe('免费用户')
    expect(MEMBERSHIP_LABELS.plus).toBeTruthy()
    expect(MEMBERSHIP_LABELS.pro).toBeTruthy()
  })

  it('渠道订单号脱敏，不暴露完整标识', () => {
    expect(maskProviderOrderId(null)).toBeNull()
    expect(maskProviderOrderId('12345678')).toBe('****')
    expect(maskProviderOrderId('1234567890abcdef')).toBe('1234****cdef')
    expect(maskProviderOrderId('1234567890abcdef')).not.toContain('5678')
  })
})
