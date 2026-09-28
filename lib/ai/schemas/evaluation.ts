import { z } from 'zod'

import { SCORE_DIMENSION_VALUES } from '@/lib/constants/questions'
import { containsProhibited, containsSensitive } from '@/lib/parsing/verify'

import { envelope } from './parse'

/**
 * 逐题评分与报告的 schema —— docs/engineering/AI_PROMPTS.md §6.3 / §7.3 的代码实现。
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
    /**
     * 证据引用：**刻意不设 `min(1)`**。
     *
     * 原因：回答为空（跳过 / 未作答）时不存在任何可引用的原文，
     * 若 schema 强制 ≥1 条，模型只能编造引用或被判为格式错误，
     * 实测结果是**空回答的评分 100% 失败**（`evaluation_failed`）。
     *
     * 「非空回答必须有证据」这条约束上移到服务层
     * （evaluation-service：证据全部不匹配原文即重试），
     * 因为它是**业务规则**而不是结构约束，且需要结合回答内容才能判定。
     */
    evidence_quotes: z.array(evidenceQuoteSchema).max(5),
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

/** 未作答时使用的反馈文案（规则 3：空回答六维给 0 并说明原因） */
export const EMPTY_ANSWER_FEEDBACK =
  '本题未作答，无法评估你的回答质量。下次即使不确定，也可以先说出思路与已知部分，再说明不确定的地方。'

/** 六维全 0 */
export function zeroDimensionScores(): DimensionScores {
  return { job_match: 0, professional: 0, project_depth: 0, logic: 0, communication: 0, motivation: 0 }
}

/** 六维是否全为 0 */
export function isAllZero(scores: DimensionScores): boolean {
  return SCORE_DIMENSION_VALUES.every((dimension) => scores[dimension] === 0)
}

/**
 * 未作答规则（prompt 规则 3 的**服务端强制**版本）。
 *
 * 为什么不信任模型：空回答时模型偶尔会给"同情分"（逻辑/沟通给 1-2 分），
 * 也会因为 schema 要求证据而编造引用。这里统一在服务端兜底 ——
 * 六维归零并补上说明文案，而不是让整题评分失败（历史上空回答必然失败）。
 *
 * 纯函数，可直接单测（tests/unit/evaluation-schema.test.ts）。
 */
export function applyNoAnswerRule(data: EvaluationData, answer: string): EvaluationData {
  if (!isNoAnswer(answer)) return data

  return {
    dimension_scores: zeroDimensionScores(),
    // 空回答不存在原文，证据一律清空，避免编造引用
    evidence_quotes: [],
    feedback: data.feedback.trim().length >= 10 ? data.feedback.trim() : EMPTY_ANSWER_FEEDBACK,
    better_answer:
      data.better_answer.trim().length > 0
        ? data.better_answer
        : '先说明你对这道题的理解，再讲思路与已知部分，最后标注不确定的地方。',
    reference_answer: '',
  }
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
