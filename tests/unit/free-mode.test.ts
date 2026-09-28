import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isFreeMode } from '@/lib/config/free-mode'
import {
  computeEntitlements,
  hasReportUnlock,
  type EntitlementInput,
} from '@/lib/services/handlers/entitlement-service'

/**
 * 免费模式（默认开启）的行为契约。
 *
 * 全局 setup 把 `FREE_MODE` 置为 `false`，以便其他测试继续验证付费门禁；
 * 本文件在用例内显式切回免费模式，两条路径互不干扰。
 */

function input(overrides: Partial<EntitlementInput> = {}): EntitlementInput {
  return { membership: 'free', freeCredits: 1, consumedFreeTrials: 0, ...overrides }
}

describe('免费模式开关', () => {
  const original = process.env.FREE_MODE

  beforeEach(() => {
    process.env.FREE_MODE = 'true'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.FREE_MODE
    else process.env.FREE_MODE = original
  })

  it('默认（未设置或 true）为开启状态', () => {
    process.env.FREE_MODE = 'true'
    expect(isFreeMode()).toBe(true)

    delete process.env.FREE_MODE
    expect(isFreeMode()).toBe(true)
  })

  it('只有严格等于 "false" 才关闭（不接受 0 / FALSE）', () => {
    process.env.FREE_MODE = 'false'
    expect(isFreeMode()).toBe(false)

    process.env.FREE_MODE = 'FALSE'
    expect(isFreeMode()).toBe(true)

    process.env.FREE_MODE = '0'
    expect(isFreeMode()).toBe(true)
  })
})

describe('免费模式下的权益', () => {
  const original = process.env.FREE_MODE

  beforeEach(() => {
    process.env.FREE_MODE = 'true'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.FREE_MODE
    else process.env.FREE_MODE = original
  })

  it('新用户即可无限次面试、看详细报告、使用语音入口', () => {
    const result = computeEntitlements(input())

    expect(result.canStartInterview).toBe(true)
    expect(result.unlimitedInterviews).toBe(true)
    expect(result.reportDetail).toBe(true)
    expect(result.voiceInterview).toBe(true)
  })

  it('额度为 0 且非会员时仍可开始面试（门禁关闭）', () => {
    const result = computeEntitlements(input({ freeCredits: 0, consumedFreeTrials: 99 }))

    expect(result.canStartInterview).toBe(true)
    expect(result.reportDetail).toBe(true)
  })

  it('报告解锁恒为 true，且在触库之前就短路（不依赖订单、不需要数据库）', async () => {
    await expect(
      hasReportUnlock('00000000-0000-0000-0000-000000000000', 'no-such-report'),
    ).resolves.toBe(true)
  })

  for (const membership of ['free', 'plus', 'pro'] as const) {
    it(`${membership} 用户一律全量放行`, () => {
      for (const freeCredits of [0, 1, 10]) {
        const result = computeEntitlements({ membership, freeCredits, consumedFreeTrials: 99 })
        expect(result.canStartInterview).toBe(true)
        expect(result.reportDetail).toBe(true)
        expect(result.voiceInterview).toBe(true)
        expect(result.unlimitedInterviews).toBe(true)
      }
    })
  }
})
