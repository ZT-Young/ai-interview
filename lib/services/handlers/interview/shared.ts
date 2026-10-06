/**
 * 面试编排的共享类型与纯展示辅助。
 *
 * 抽离自 orchestration-service.ts，供 state.ts / followup.ts / orchestration-service.ts
 * 共用，避免在拆分子模块后产生循环依赖。本文件**不含任何 DB / AI 副作用**，
 * 仅做类型定义与纯函数转换。
 */

import type { Question, InterviewMessage } from '@/db/schema'
import type { OrchestrationPhase } from '../../state/orchestration'
import type { LlmPort } from '@/lib/parsing/llm-port'

/** 回答少于该长度视为「太短」，直接追问细节（不调用模型） */
export const MIN_ANSWER_LENGTH = 30

export interface OrchestrationPorts {
  llm: LlmPort
}

export interface StepView {
  phase: OrchestrationPhase
  /** 本轮要展示的消息（最多 1 条提问/追问） */
  message: { id: string; role: string; type: string; content: string } | null
  question: {
    id: string
    orderIndex: number
    depth: number
    type: string
    source: string
    dimension: string
    content: string
    expectedPoints: string[]
    followUpAllowed: boolean
  } | null
  /** 进度：已回答的主问题数 / 主问题总数 */
  progress: { answered: number; total: number }
  finished: boolean
  followUpReason?: string
  focus?: string
}

export type SubmitAction = 'answer' | 'skip' | 'hint'

export interface SubmitResult extends StepView {
  /** 上一次提交产生的消息（回答/跳过/提示） */
  recorded: { id: string; type: string; content: string } | null
  /** 追问决策（仅 answer 动作且有追问时） */
  followUp?: { reason: string; focus: string; depth: number }
}

function toExpectedPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function questionView(row: Question) {
  return {
    id: row.id,
    orderIndex: row.orderIndex,
    depth: row.depth,
    type: row.type,
    source: row.source,
    dimension: row.dimension,
    content: row.content,
    expectedPoints: toExpectedPoints(row.expectedPoints),
    followUpAllowed: row.followUpAllowed,
  }
}

function messageView(row: InterviewMessage) {
  return { id: row.id, role: row.role, type: row.type, content: row.content }
}

export { toExpectedPoints, questionView, messageView }
