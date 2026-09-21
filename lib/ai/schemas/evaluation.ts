import { z } from 'zod'

import { SCORE_DIMENSION_VALUES } from '@/lib/constants/questions'
import { containsProhibited, containsSensitive } from '@/lib/parsing/verify'

import { envelope } from './parse'

/**
 * 逐题评分与报告的 schema —— docs/AI_PROMPTS.md §6.3 / §7.3 的代码实现。
 */

/* ------------------------------------------------------------------ *
 * 6. 逐题评分
 * ------------------------------------------------------------------ */

const score = z.number().int().min(0).max(5)

/** 六维分：必须六项齐全，每项 0-5 的整数 */
export const dimensionScoresSchema = z
  .object({
    job_match: score,
    professional: score,
    project_depth: score,
    logic: score,
    communication: score,
    motivation: score,
  })
  .strict()

export const evidenceQuoteSchema = z
  .object({
    quote: z.string().max(300),
    reason: z.string().max(200),
  })
  .strict()

export const evaluationDataSchema = z
  .object({
    dimension_scores: dimensionScoresSchema,
    evidence_quotes: z.array(evidenceQuoteSchema).min(1).max(5),
    feedback: z.string().max(800),
    better_answer: z.string().max(800),
    /**
     * 该题的**参考答案**（示范怎么答）。
     *
     * 与 `better_answer`（改进要点）语义不同，两者都要：
     * - better_answer：指出应补充哪些信息、按什么结构组织
     * - reference_answer：给出一段**可学习结构与措辞**的完整示范
     *
     * 约束（N4 不编造经历）：只能使用候选人简历与本次回答中出现的真实经历；
     * 无法确定的具体数字/细节必须写成 `【待补充：…】` 占位，绝不允许编造。
     *
     * 允许为空字符串（模型认为没有可给示范的情况），但不得为 null。
     */
    reference_answer: z.string().max(1200),
  })
  .strict()

export const evaluationParseSchema = envelope(evaluationDataSchema)
export type EvaluationData = z.infer<typeof evaluationDataSchema>
export type DimensionScores = z.infer<typeof dimensionScoresSchema>

/* ------------------------------------------------------------------ *
 * 7. 报告生成
 * ------------------------------------------------------------------ */

export const reportDataSchema = z
  .object({
    summary: z.string().max(500),
    highlights: z.array(z.string().max(200)).max(8),
    issues: z.array(z.string().max(200)).max(8),
    reference_answers: z
      .array(
        z
          .object({
            question: z.string().max(300),
            improvement: z.string().max(300),
          })
          .strict(),
      )
      .max(12),
    next_actions: z.array(z.string().max(200)).max(8),
    resume_risks: z.array(z.string().max(200)).max(10),
  })
  .strict()

export const reportParseSchema = envelope(reportDataSchema)
export type ReportData = z.infer<typeof reportDataSchema>

/* ------------------------------------------------------------------ *
 * 6.4 证据引用后置校验
 * ------------------------------------------------------------------ */

export interface KeptQuote {
  quote: string
  reason: string
}

export interface EvidenceVerification {
  quotes: KeptQuote[]
  /** 被剔除的引用及其原因 */
  dropped: Array<{ quote: string; reason: string }>
}

/** 归一化：去空白 + 小写，避免因排版差异误杀真实引用 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}

/**
 * 校验证据引用是否为回答原文的子串。
 *
 * **这是防止模型编造引用的关键**：模型很容易写出「看起来像」的回答片段，
 * 因此每条 quote 都必须在归一化后的回答中出现，否则剔除。
 */
export function verifyEvidenceQuotes(
  quotes: KeptQuote[],
  answer: string,
): EvidenceVerification {
  const haystack = normalize(answer)
  const kept: KeptQuote[] = []
  const dropped: Array<{ quote: string; reason: string }> = []

  for (const item of quotes) {
    const needle = normalize(item.quote)

    if (needle.length < 5) {
      dropped.push({ quote: item.quote, reason: '引用过短' })
      continue
    }
    if (!haystack.includes(needle)) {
      dropped.push({ quote: item.quote, reason: '不是回答原文的子串' })
      continue
    }
    if (containsSensitive(item.quote) || containsProhibited(item.quote)) {
      dropped.push({ quote: item.quote, reason: '命中敏感或禁止项' })
      continue
    }

    kept.push(item)
  }

  return { quotes: kept, dropped }
}

/** 判定回答是否「实质性未作答」（用于六维全 0 的合理性检查） */
export function isNoAnswer(answer: string): boolean {
  const trimmed = answer.trim()
  if (trimmed.length === 0) return true
  return trimmed.length < 10
}

/** 低分判定阈值：任一维度低于该值即需给出可执行建议 */
export const LOW_SCORE_THRESHOLD = 3

/** 六个维度中是否存在低分项 */
export function hasLowDimension(scores: DimensionScores): boolean {
  return SCORE_DIMENSION_VALUES.some((dimension) => scores[dimension] < LOW_SCORE_THRESHOLD)
}

/** 低分时若模型未给出可执行建议，追加一条通用建议 */
export const GENERIC_IMPROVEMENT_HINT =
  '下一步可补充：具体的项目背景、你个人负责的部分、做过的取舍以及可量化的结果。'
