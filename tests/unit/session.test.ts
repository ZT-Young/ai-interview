import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/errors'
import {
  assertTransition,
  canTransition,
  isTerminal,
  SESSION_STATUSES,
  type SessionStatus,
} from '@/lib/services/state/session'

describe('面试会话状态机', () => {
  it('合法迁移被允许', () => {
    expect(canTransition('draft', 'planned')).toBe(true)
    expect(canTransition('draft', 'cancelled')).toBe(true)
    expect(canTransition('planned', 'in_progress')).toBe(true)
    expect(canTransition('planned', 'cancelled')).toBe(true)
    expect(canTransition('in_progress', 'completed')).toBe(true)
    expect(canTransition('in_progress', 'cancelled')).toBe(true)
    expect(canTransition('in_progress', 'failed')).toBe(true)
  })

  it('非法迁移被拒绝', () => {
    expect(canTransition('draft', 'in_progress')).toBe(false)
    expect(canTransition('draft', 'completed')).toBe(false)
    expect(canTransition('planned', 'completed')).toBe(false)
    expect(canTransition('cancelled', 'in_progress')).toBe(false)
  })

  it('终态不可再迁移', () => {
    for (const status of ['completed', 'cancelled', 'failed'] as const) {
      expect(isTerminal(status)).toBe(true)
      for (const next of SESSION_STATUSES) {
        expect(canTransition(status, next as SessionStatus)).toBe(false)
      }
    }
  })

  it('非终态判定正确', () => {
    expect(isTerminal('draft')).toBe(false)
    expect(isTerminal('planned')).toBe(false)
    expect(isTerminal('in_progress')).toBe(false)
  })

  it('assertTransition 对非法迁移抛 422', () => {
    try {
      assertTransition('draft', 'completed')
      throw new Error('应当抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(422)
      expect((error as ApiError).code).toBe('validation_error')
    }
  })

  it('assertTransition 允许同状态幂等调用', () => {
    expect(() => assertTransition('draft', 'draft')).not.toThrow()
  })

  it('每个状态的迁移目标是合法状态', () => {
    for (const from of SESSION_STATUSES) {
      for (const to of SESSION_STATUSES) {
        expect(typeof canTransition(from, to)).toBe('boolean')
      }
    }
  })
})
