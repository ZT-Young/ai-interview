import { z } from 'zod'

import { containsProhibited, containsSensitive } from '@/lib/parsing/verify'

import { envelope } from './parse'

/**
 * 追问与提示的 schema —— docs/engineering/AI_PROMPTS.md §5.3 / §5.5 的代码实现。
 */

export const FOLLOW_UP_ACTIONS = ['follow_up', 'next_question'] as const
export const FOLLOW_UP_REASONS = ['vague', 'too_short', 'off_topic', 'good_enough'] as const

export type FollowUpAction = (typeof FOLLOW_UP_ACTIONS)[number]
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number]

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((value) => (value ?? '').trim())

export const followUpDataSchema = z
  .object({
    action: z.enum(FOLLOW_UP_ACTIONS),
    /** action=next_question 时允许为 null */
    follow_up: text(300),
    reason: z.enum(FOLLOW_UP_REASONS),
    /** 追问依据的回答片段（逐字摘录） */
    focus: text(300),
  })
  .strict()

export const followUpParseSchema = envelope(followUpDataSchema)
export type FollowUpData = z.infer<typeof followUpDataSchema>

export const hintDataSchema = z
  .object({ hint: z.string().max(200).nullable().transform((value) => (value ?? '').trim()) })
  .strict()

export const hintParseSchema = envelope(hintDataSchema)
export type HintData = z.infer<typeof hintDataSchema>

/* ------------------------------------------------------------------ *
 * 后置校验（docs/engineering/AI_PROMPTS.md §5.4）
 * ------------------------------------------------------------------ */

export interface NormalizedFollowUp {
  action: FollowUpAction
  followUp: string
  reason: FollowUpReason
  focus: string
  /** 被规则修正过（用于审计与日志） */
  adjusted: boolean
  adjustReason?: string
}

/**
 * 归一化模型输出。
 *
 * 规则（§5.4）：
 * - action=follow_up 但 follow_up 为空 → 降级为 next_question（不报错，避免浪费一次往返）
 * - action=next_question 但 follow_up 非空 → 丢弃 follow_up
 * - 追问内容命中敏感词/禁止项 → 降级为 next_question（由调用方决定是否重试）
 */
export function normalizeFollowUp(data: FollowUpData): NormalizedFollowUp {
  let action = data.action
  let reason = data.reason
  let followUp = data.follow_up
  let adjusted = false
  let adjustReason: string | undefined

  if (action === 'follow_up' && followUp.length < 5) {
    action = 'next_question'
    adjusted = true
    adjustReason = 'follow_up 为空，降级为下一题'
  }

  if (action === 'next_question' && followUp.length > 0) {
    followUp = ''
    adjusted = true
    adjustReason = 'action 为 next_question，已丢弃 follow_up'
  }

  if (action === 'follow_up') {
    if (containsSensitive(followUp)) {
      action = 'next_question'
      followUp = ''
      reason = 'good_enough'
      adjusted = true
      adjustReason = '追问命中敏感信息'
    } else if (containsProhibited(followUp)) {
      action = 'next_question'
      followUp = ''
      reason = 'good_enough'
      adjusted = true
      adjustReason = '追问命中禁止项（录用建议或主观判断）'
    }
  }

  return { action, followUp, reason, focus: data.focus, adjusted, adjustReason }
}

/** 提示的合规校验：命中禁止项即视为不可用 */
export function isHintAcceptable(hint: string): boolean {
  return hint.length >= 5 && !containsSensitive(hint) && !containsProhibited(hint)
}
