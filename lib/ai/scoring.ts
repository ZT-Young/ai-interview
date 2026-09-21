import { SCORE_DIMENSION_VALUES, type ScoreDimension } from '@/lib/constants/questions'
import type { DimensionScores } from '@/lib/ai/schemas/evaluation'

/**
 * 评分公式 —— docs/DATA_MODEL.md §5 的**唯一实现**。
 *
 * 要求（AGENTS.md §6.2）：维度分 → 总分的换算必须显式实现且可单测，
 * 不得散落在模板或 SQL 中计算。
 *
 *   question_score      = (Σ 六维 / 30) × 100            # 0–100，保留 1 位小数
 *   dimension_score(d)  = mean(该会话所有题的 d 维得分)   # 0–5，保留 1 位小数
 *   total_score         = (Σ 六维 dimension_score / 30) × 100
 *
 * 六维等权，因此 total_score 等价于各题折算分的算术平均。
 */

/** 六维满分 */
export const MAX_DIMENSION_SUM = 5 * SCORE_DIMENSION_VALUES.length // 30

/** 保留 1 位小数（避免浮点误差累积） */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 单题折算分：六维之和 / 30 × 100 */
export function questionScoreOf(scores: DimensionScores): number {
  const sum = SCORE_DIMENSION_VALUES.reduce((acc, dimension) => acc + scores[dimension], 0)
  return round1((sum / MAX_DIMENSION_SUM) * 100)
}

/** 六维汇总分：各维在整场面试中的算术平均 */
export function aggregateDimensionScores(
  perQuestion: DimensionScores[],
): Record<ScoreDimension, number> {
  const result = {} as Record<ScoreDimension, number>

  for (const dimension of SCORE_DIMENSION_VALUES) {
    if (perQuestion.length === 0) {
      result[dimension] = 0
      continue
    }
    const sum = perQuestion.reduce((acc, scores) => acc + scores[dimension], 0)
    result[dimension] = round1(sum / perQuestion.length)
  }

  return result
}

/** 总分：六维汇总分之和 / 30 × 100 */
export function totalScoreOf(dimensions: Record<ScoreDimension, number>): number {
  const sum = SCORE_DIMENSION_VALUES.reduce((acc, dimension) => acc + dimensions[dimension], 0)
  return round1((sum / MAX_DIMENSION_SUM) * 100)
}

/** 一次性从逐题六维分算出报告所需的全部分数 */
export function computeSessionScores(perQuestion: DimensionScores[]): {
  dimensionScores: Record<ScoreDimension, number>
  totalScore: number
  questionCount: number
} {
  const dimensionScores = aggregateDimensionScores(perQuestion)
  return {
    dimensionScores,
    totalScore: totalScoreOf(dimensionScores),
    questionCount: perQuestion.length,
  }
}
