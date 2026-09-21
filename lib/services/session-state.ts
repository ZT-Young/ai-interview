import { validationError } from '@/lib/api/errors'

/**
 * 面试会话状态机 —— 纯逻辑，无数据库与 Next.js 依赖，可直接单测。
 *
 * 迁移表见 docs/DATA_MODEL.md §2.2。非法迁移必须在服务层拒绝（AGENTS.md §5）。
 */

export const SESSION_STATUSES = [
  'draft',
  'planned',
  'in_progress',
  'completed',
  'cancelled',
  'failed',
] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]

/** 终态：进入后不可再变更 */
export const TERMINAL_STATUSES: readonly SessionStatus[] = ['completed', 'cancelled', 'failed']

const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  draft: ['planned', 'cancelled'],
  planned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'failed'],
  completed: [],
  cancelled: [],
  failed: [],
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * 断言状态迁移合法，否则抛 422。
 * 语义为「请求与资源当前状态冲突」，因此是入参错误而非服务器错误。
 */
export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (from === to) return
  if (!canTransition(from, to)) {
    throw validationError(`不允许的状态迁移：${from} → ${to}`)
  }
}
