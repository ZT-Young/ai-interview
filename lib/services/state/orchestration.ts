import { validationError } from '@/lib/api/errors'

/**
 * 面试编排状态机 —— 纯逻辑，无数据库与 Next.js 依赖，可直接单测。
 *
 * 契约见 docs/engineering/ARCHITECTURE.md §3.6。
 *
 * 两个维度的关系（不可混淆）：
 * - `SessionStatus`（生命周期，宏观）：draft / planned / in_progress / completed / cancelled / failed
 * - `OrchestrationPhase`（编排阶段，微观）：本文件管理的 9 个值
 */

export const ORCHESTRATION_PHASES = [
  'IDLE',
  'PARSING',
  'READY',
  'ASKING',
  'WAITING_ANSWER',
  'FOLLOW_UP',
  'NEXT_QUESTION',
  'FINISHED',
  'REPORTING',
] as const

export type OrchestrationPhase = (typeof ORCHESTRATION_PHASES)[number]

/** 终态：进入后不再变更（REPORTING 由报告流程接管） */
export const TERMINAL_PHASES: readonly OrchestrationPhase[] = ['FINISHED', 'REPORTING']

const TRANSITIONS: Record<OrchestrationPhase, readonly OrchestrationPhase[]> = {
  IDLE: ['PARSING', 'READY'],
  PARSING: ['READY'],
  READY: ['ASKING'],
  ASKING: ['WAITING_ANSWER'],
  WAITING_ANSWER: ['FOLLOW_UP', 'NEXT_QUESTION', 'FINISHED'],
  FOLLOW_UP: ['ASKING', 'NEXT_QUESTION'],
  NEXT_QUESTION: ['ASKING', 'FINISHED'],
  FINISHED: ['REPORTING'],
  REPORTING: [],
}

export function canTransitionPhase(from: OrchestrationPhase, to: OrchestrationPhase): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminalPhase(phase: OrchestrationPhase): boolean {
  return TERMINAL_PHASES.includes(phase)
}

/** 断言迁移合法，否则抛 422（语义：请求与当前阶段冲突） */
export function assertPhaseTransition(from: OrchestrationPhase, to: OrchestrationPhase): void {
  if (from === to) return
  if (!canTransitionPhase(from, to)) {
    throw validationError(`不允许的编排阶段迁移：${from} → ${to}`)
  }
}

/** 从生命周期状态推导初始阶段（面试开始前） */
export function initialPhaseForStatus(status: string): OrchestrationPhase {
  if (status === 'draft') return 'IDLE'
  if (status === 'planned') return 'READY'
  if (status === 'in_progress') return 'READY'
  if (status === 'completed') return 'FINISHED'
  return 'IDLE'
}

/**
 * 下一步的阶段序列（供服务端自动推进使用）。
 * 返回空数组表示不可自动到达。
 */
export function pathTo(from: OrchestrationPhase, to: OrchestrationPhase): OrchestrationPhase[] {
  if (from === to) return []

  const queue: Array<{ phase: OrchestrationPhase; path: OrchestrationPhase[] }> = [
    { phase: from, path: [] },
  ]
  const visited = new Set<OrchestrationPhase>([from])

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of TRANSITIONS[current.phase]) {
      if (visited.has(next)) continue
      const path = [...current.path, next]
      if (next === to) return path
      visited.add(next)
      queue.push({ phase: next, path })
    }
  }

  return []
}
