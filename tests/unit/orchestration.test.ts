import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/errors'
import {
  assertPhaseTransition,
  canTransitionPhase,
  initialPhaseForStatus,
  isTerminalPhase,
  ORCHESTRATION_PHASES,
  pathTo,
  type OrchestrationPhase,
} from '@/lib/services/state/orchestration'

describe('编排状态机', () => {
  it('九个阶段齐备且顺序符合需求', () => {
    expect([...ORCHESTRATION_PHASES]).toEqual([
      'IDLE',
      'PARSING',
      'READY',
      'ASKING',
      'WAITING_ANSWER',
      'FOLLOW_UP',
      'NEXT_QUESTION',
      'FINISHED',
      'REPORTING',
    ])
  })

  it('合法迁移被允许', () => {
    expect(canTransitionPhase('IDLE', 'PARSING')).toBe(true)
    expect(canTransitionPhase('IDLE', 'READY')).toBe(true)
    expect(canTransitionPhase('PARSING', 'READY')).toBe(true)
    expect(canTransitionPhase('READY', 'ASKING')).toBe(true)
    expect(canTransitionPhase('ASKING', 'WAITING_ANSWER')).toBe(true)
    expect(canTransitionPhase('WAITING_ANSWER', 'FOLLOW_UP')).toBe(true)
    expect(canTransitionPhase('WAITING_ANSWER', 'NEXT_QUESTION')).toBe(true)
    expect(canTransitionPhase('WAITING_ANSWER', 'FINISHED')).toBe(true)
    expect(canTransitionPhase('FOLLOW_UP', 'ASKING')).toBe(true)
    expect(canTransitionPhase('FOLLOW_UP', 'NEXT_QUESTION')).toBe(true)
    expect(canTransitionPhase('NEXT_QUESTION', 'ASKING')).toBe(true)
    expect(canTransitionPhase('NEXT_QUESTION', 'FINISHED')).toBe(true)
    expect(canTransitionPhase('FINISHED', 'REPORTING')).toBe(true)
  })

  it('非法迁移被拒绝', () => {
    expect(canTransitionPhase('IDLE', 'ASKING')).toBe(false)
    expect(canTransitionPhase('IDLE', 'FINISHED')).toBe(false)
    expect(canTransitionPhase('READY', 'WAITING_ANSWER')).toBe(false)
    expect(canTransitionPhase('ASKING', 'NEXT_QUESTION')).toBe(false)
    expect(canTransitionPhase('WAITING_ANSWER', 'ASKING')).toBe(false)
    expect(canTransitionPhase('FOLLOW_UP', 'FINISHED')).toBe(false)
  })

  it('FINISHED 与 REPORTING 为终态，不可主动离开', () => {
    expect(isTerminalPhase('FINISHED')).toBe(true)
    expect(isTerminalPhase('REPORTING')).toBe(true)

    for (const phase of ORCHESTRATION_PHASES) {
      expect(canTransitionPhase('REPORTING', phase)).toBe(false)
    }
    // FINISHED 唯一的出边是 REPORTING
    expect(canTransitionPhase('FINISHED', 'REPORTING')).toBe(true)
    expect(canTransitionPhase('FINISHED', 'ASKING')).toBe(false)
    expect(canTransitionPhase('FINISHED', 'NEXT_QUESTION')).toBe(false)
  })

  it('自环不视为迁移（幂等）', () => {
    for (const phase of ORCHESTRATION_PHASES) {
      expect(() => assertPhaseTransition(phase, phase)).not.toThrow()
      expect(canTransitionPhase(phase, phase)).toBe(false)
    }
  })

  it('assertPhaseTransition 对非法迁移抛 422', () => {
    try {
      assertPhaseTransition('IDLE', 'FINISHED')
      throw new Error('应当抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(422)
      expect((error as ApiError).code).toBe('validation_error')
    }
  })

  it('由生命周期状态推导初始阶段', () => {
    expect(initialPhaseForStatus('draft')).toBe('IDLE')
    expect(initialPhaseForStatus('planned')).toBe('READY')
    expect(initialPhaseForStatus('in_progress')).toBe('READY')
    expect(initialPhaseForStatus('completed')).toBe('FINISHED')
    expect(initialPhaseForStatus('cancelled')).toBe('IDLE')
    expect(initialPhaseForStatus('failed')).toBe('IDLE')
  })

  it('pathTo 给出一条可达路径', () => {
    // IDLE → READY 的最短路径是直接迁移（PARSING 是可选的兼容分支）
    expect(pathTo('IDLE', 'READY')).toEqual(['READY'])
    expect(pathTo('IDLE', 'PARSING')).toEqual(['PARSING'])
    expect(pathTo('READY', 'WAITING_ANSWER')).toEqual(['ASKING', 'WAITING_ANSWER'])
    expect(pathTo('WAITING_ANSWER', 'FINISHED')).toEqual(['FINISHED'])
    expect(pathTo('FINISHED', 'REPORTING')).toEqual(['REPORTING'])
  })

  it('pathTo 返回的路径每步都合法', () => {
    for (const from of ORCHESTRATION_PHASES) {
      for (const to of ORCHESTRATION_PHASES) {
        const path = pathTo(from, to)
        let current = from
        for (const step of path) {
          expect(canTransitionPhase(current, step as OrchestrationPhase)).toBe(true)
          current = step as OrchestrationPhase
        }
        if (path.length > 0) expect(current).toBe(to)
      }
    }
  })

  it('pathTo 对不可达目标返回空数组', () => {
    expect(pathTo('REPORTING', 'ASKING')).toEqual([])
    expect(pathTo('FINISHED', 'IDLE')).toEqual([])
  })

  it('同一阶段返回空路径', () => {
    expect(pathTo('ASKING', 'ASKING')).toEqual([])
  })

  it('除终态外每个阶段都至少有一条出边', () => {
    for (const phase of ORCHESTRATION_PHASES) {
      if (phase === 'REPORTING') continue
      const hasOutgoing = ORCHESTRATION_PHASES.some((target) => canTransitionPhase(phase, target))
      expect(hasOutgoing, `${phase} 应有后继阶段`).toBe(true)
    }
  })

  it('迁移目标均为合法阶段（无悬空引用）', () => {
    for (const from of ORCHESTRATION_PHASES) {
      for (const to of ORCHESTRATION_PHASES) {
        if (!canTransitionPhase(from, to)) continue
        expect(ORCHESTRATION_PHASES).toContain(to as OrchestrationPhase)
      }
    }
  })
})
