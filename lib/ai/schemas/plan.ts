import { z } from 'zod'

import {
  QUESTION_SOURCE_VALUES,
  QUESTION_TYPE_VALUES,
  SCORE_DIMENSION_VALUES,
} from '@/lib/constants/questions'
import { containsProhibited, containsSensitive } from '@/lib/parsing/verify'

import { SCHEMA_VERSION, envelope } from './parse'

/**
 * 面试计划（出题）schema —— docs/engineering/AI_PROMPTS.md §4.2 的代码实现。
 */

/** 每题必备的六个字段（需求要求：文本/类型/来源/维度/期望要点/可追问） */
export const planQuestionSchema = z
  .object({
    content: z
      .string()
      .max(300)
      .nullable()
      .transform((value) => (value ?? '').trim()),
    type: z.enum(QUESTION_TYPE_VALUES),
    source: z.enum(QUESTION_SOURCE_VALUES),
    dimension: z.enum(SCORE_DIMENSION_VALUES),
    expected_points: z
      .array(z.string().max(120))
      .min(2, '期望要点至少 2 条')
      .max(5, '期望要点最多 5 条')
      .nullable()
      .transform((value) => value ?? []),
    follow_up_allowed: z
      .boolean()
      .nullable()
      .transform((value) => value ?? true),
  })
  .strict()

export const planDataSchema = z
  .object({
    questions: z.array(planQuestionSchema).min(8).max(12),
  })
  .strict()

export const planParseSchema = envelope(planDataSchema)

export type PlanQuestion = z.infer<typeof planQuestionSchema>
export type PlanData = z.infer<typeof planDataSchema>

/* ------------------------------------------------------------------ *
 * 配额与后置校验（docs/engineering/AI_PROMPTS.md §4.3）
 * ------------------------------------------------------------------ */

/** 总数下限 / 上限 */
export const MIN_QUESTIONS = 8
export const MAX_QUESTIONS = 12

/** 各题型数量上限；self_intro 与 reverse 必须恰好 1 */
export const TYPE_MAX: Record<(typeof QUESTION_TYPE_VALUES)[number], number> = {
  self_intro: 1,
  project_dig: 4,
  technical: 4,
  behavioral: 3,
  reverse: 1,
}

/** 必须恰好出现 1 次的题型 */
const EXACTLY_ONCE = ['self_intro', 'reverse'] as const

/** source = generic 仅允许的题型（防编造，N4） */
const GENERIC_ALLOWED_TYPES = ['self_intro', 'reverse'] as const

export interface PlanQuota {
  self_intro: number
  project_dig: number
  technical: number
  behavioral: number
  reverse: number
}

export interface PlanAnalysis {
  ok: boolean
  violations: string[]
  quota: PlanQuota
  /** 出现过的题型（用于覆盖率断言） */
  typesPresent: string[]
}

/**
 * 校验生成结果是否满足配额与合规要求。
 *
 * 刻意返回**全部**违规项（而非首条），便于日志定位与重试判断。
 */
export function analyzePlan(data: PlanData): PlanAnalysis {
  const questions = data.questions
  const violations: string[] = []

  const quota: PlanQuota = {
    self_intro: 0,
    project_dig: 0,
    technical: 0,
    behavioral: 0,
    reverse: 0,
  }

  for (const question of questions) {
    quota[question.type] += 1
  }

  const typesPresent = Object.entries(quota)
    .filter(([, count]) => count > 0)
    .map(([type]) => type)

  // 1. 数量
  if (questions.length < MIN_QUESTIONS || questions.length > MAX_QUESTIONS) {
    violations.push(`题目总数必须为 ${MIN_QUESTIONS}-${MAX_QUESTIONS}，实际 ${questions.length}`)
  }

  // 2. 五类齐全
  for (const type of QUESTION_TYPE_VALUES) {
    if (quota[type] === 0) violations.push(`缺少题型：${type}`)
  }

  // 3. 上限 + 恰好一次
  for (const type of QUESTION_TYPE_VALUES) {
    if (quota[type] > TYPE_MAX[type]) {
      violations.push(`题型 ${type} 最多 ${TYPE_MAX[type]} 道，实际 ${quota[type]}`)
    }
  }
  for (const type of EXACTLY_ONCE) {
    if (quota[type] !== 1) violations.push(`题型 ${type} 必须恰好 1 道，实际 ${quota[type]}`)
  }

  // 4. 逐题校验
  questions.forEach((question, index) => {
    const label = `第 ${index + 1} 题`

    if (question.content.length < 5) {
      violations.push(`${label}：内容过短或为空`)
    }

    // generic 白名单（防编造）
    if (
      question.source === 'generic' &&
      !GENERIC_ALLOWED_TYPES.includes(question.type as (typeof GENERIC_ALLOWED_TYPES)[number])
    ) {
      violations.push(`${label}：题型 ${question.type} 不允许 source=generic（必须基于 JD 或简历）`)
    }

    // 必须可溯源的题型
    if (
      (question.type === 'project_dig' || question.type === 'technical') &&
      question.source === 'generic'
    ) {
      violations.push(`${label}：${question.type} 必须指向 JD 或简历`)
    }

    // 敏感问题（N5）
    if (containsSensitive(question.content)) {
      violations.push(`${label}：命中敏感信息，禁止出现在面试问题中`)
    }

    // 录用建议 / 性格与诚信判断（合规 C5）
    if (containsProhibited(question.content)) {
      violations.push(`${label}：命中禁止项（录用建议或主观判断）`)
    }
  })

  // 5. 重复题
  const seen = new Map<string, number>()
  questions.forEach((question) => {
    seen.set(question.content, (seen.get(question.content) ?? 0) + 1)
  })
  for (const [content, count] of seen) {
    if (count > 1) violations.push(`存在重复题目：${content.slice(0, 30)}`)
  }

  return { ok: violations.length === 0, violations, quota, typesPresent }
}

export { SCHEMA_VERSION }
