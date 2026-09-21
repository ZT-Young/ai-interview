import { describe, expect, it, afterEach, beforeEach } from 'vitest'

import {
  computeEntitlements,
  DEFAULT_FREE_TRIAL,
  FREE_TRIAL_UNLOCK_TYPE,
  type EntitlementInput,
} from '@/lib/services/entitlement-service'
import {
  buildSignaturePayload,
  isPaymentConfigured,
  newProviderOrderId,
  signCallback,
  verifyCallbackSignature,
} from '@/lib/payments/provider'
import {
  generateRedemptionCode,
  hashRedemptionCode,
  normalizeRedemptionCode,
} from '@/lib/payments/redemption-code'
import { getProduct, isProductId, listProducts, PRODUCT_IDS } from '@/lib/payments/products'

/**
 * 支付与权益的**离线**测试（不需要数据库，现在就能真实执行）。
 *
 * 覆盖任务要求的三项中的「权益计算」全部组合，
 * 以及回调验签与金额防篡改（这两者都是纯函数，可完全离线验证）。
 */

function input(overrides: Partial<EntitlementInput> = {}): EntitlementInput {
  return { membership: 'free', freeCredits: 1, consumedFreeTrials: 0, ...overrides }
}

describe('权益计算：免费用户', () => {
  it('新用户：可开始面试，但只有简版报告、无语音', () => {
    const result = computeEntitlements(input())

    expect(result.isMember).toBe(false)
    expect(result.canStartInterview).toBe(true)
    expect(result.unlimitedInterviews).toBe(false)
    expect(result.reportDetail).toBe(false)
    expect(result.voiceInterview).toBe(false)
    expect(result.freeCreditsLeft).toBe(1)
  })

  it('额度用尽后不可再开始面试', () => {
    const result = computeEntitlements(input({ freeCredits: 0, consumedFreeTrials: 1 }))

    expect(result.canStartInterview).toBe(false)
    expect(result.freeCreditsLeft).toBe(0)
    // 报告仍是简版（已生成的报告不受影响，只是不能开新的）
    expect(result.reportDetail).toBe(false)
  })

  it('余额为负（脏数据）时按 0 处理，不出现负额度', () => {
    const result = computeEntitlements(input({ freeCredits: -5 }))
    expect(result.freeCreditsLeft).toBe(0)
    expect(result.canStartInterview).toBe(false)
  })

  it('消耗次数为负（脏数据）时按 0 处理', () => {
    const result = computeEntitlements(input({ consumedFreeTrials: -3 }))
    expect(result.consumedFreeTrials).toBe(0)
  })

  it('默认免费额度为 1 次（与 users.free_credits 初始值一致）', () => {
    expect(DEFAULT_FREE_TRIAL).toBe(1)
    expect(computeEntitlements(input({ freeCredits: DEFAULT_FREE_TRIAL })).freeCreditsLeft).toBe(1)
  })
})

describe('权益计算：付费用户', () => {
  for (const membership of ['plus', 'pro'] as const) {
    it(`${membership}：无限次数 + 详细报告 + 语音`, () => {
      const result = computeEntitlements(input({ membership, freeCredits: 0 }))

      expect(result.isMember).toBe(true)
      expect(result.unlimitedInterviews).toBe(true)
      expect(result.canStartInterview).toBe(true)
      expect(result.reportDetail).toBe(true)
      expect(result.voiceInterview).toBe(true)
    })

    it(`${membership}：即使免费额度为 0 也能开始面试`, () => {
      const result = computeEntitlements(
        input({ membership, freeCredits: 0, consumedFreeTrials: 99 }),
      )
      expect(result.canStartInterview).toBe(true)
      // 会员不再依赖免费额度
      expect(result.freeCreditsLeft).toBe(0)
    })
  }
})

describe('权益矩阵（穷举组合，防止分支遗漏）', () => {
  it('无任何组合出现「既无额度又非会员却能开始面试」', () => {
    for (const membership of ['free', 'plus', 'pro'] as const) {
      for (const freeCredits of [0, 1, 5]) {
        for (const consumedFreeTrials of [0, 1, 5]) {
          const result = computeEntitlements({ membership, freeCredits, consumedFreeTrials })
          const canStart = result.isMember || freeCredits > 0
          expect(result.canStartInterview, `${membership}/${freeCredits}/${consumedFreeTrials}`).toBe(
            canStart,
          )
        }
      }
    }
  })

  it('详细报告与语音**永远**只对会员开放（当前 V1 规则）', () => {
    for (const membership of ['free', 'plus', 'pro'] as const) {
      for (const freeCredits of [0, 1, 10]) {
        const result = computeEntitlements({ membership, freeCredits, consumedFreeTrials: 0 })
        const expected = membership !== 'free'
        expect(result.reportDetail).toBe(expected)
        expect(result.voiceInterview).toBe(expected)
      }
    }
  })

  it('免费额度类型常量与 DB 枚举一致', () => {
    expect(FREE_TRIAL_UNLOCK_TYPE).toBe('free_trial')
  })
})

describe('回调验签', () => {
  const original = process.env.PAYMENT_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-at-least-16'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET
    else process.env.PAYMENT_WEBHOOK_SECRET = original
  })

  const payload = {
    provider: 'mock',
    providerOrderId: 'mock_abc123',
    amountCents: 990,
    status: 'success',
  }

  it('正确签名通过校验', () => {
    const signature = signCallback(payload)
    expect(verifyCallbackSignature({ ...payload, signature })).toBe(true)
  })

  it('签名被篡改则失败', () => {
    const signature = signCallback(payload)
    const tampered = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`
    expect(verifyCallbackSignature({ ...payload, signature: tampered })).toBe(false)
  })

  it('金额被篡改则失败（防止「付 1 分钱解锁高价商品」）', () => {
    const signature = signCallback(payload)
    expect(verifyCallbackSignature({ ...payload, amountCents: 1, signature })).toBe(false)
  })

  it('订单号被篡改则失败', () => {
    const signature = signCallback(payload)
    expect(
      verifyCallbackSignature({ ...payload, providerOrderId: 'mock_other', signature }),
    ).toBe(false)
  })

  it('状态被篡改则失败', () => {
    const signature = signCallback(payload)
    expect(verifyCallbackSignature({ ...payload, status: 'failed', signature })).toBe(false)
  })

  it('长度不符的签名直接失败（不抛错）', () => {
    expect(verifyCallbackSignature({ ...payload, signature: 'short' })).toBe(false)
  })

  it('缺少密钥时验签失败而不是崩溃', () => {
    delete process.env.PAYMENT_WEBHOOK_SECRET
    expect(verifyCallbackSignature({ ...payload, signature: 'x'.repeat(64) })).toBe(false)
  })

  it('缺少密钥时 isPaymentConfigured 为 false（下单接口据此返回 503）', () => {
    delete process.env.PAYMENT_WEBHOOK_SECRET
    expect(isPaymentConfigured()).toBe(false)

    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-at-least-16'
    expect(isPaymentConfigured()).toBe(true)
  })

  it('密钥过短视为未配置', () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'short'
    expect(isPaymentConfigured()).toBe(false)
  })

  it('签名原文包含全部关键字段（改动任一字段都会改变签名）', () => {
    const base = buildSignaturePayload(payload)
    expect(base).toContain('mock')
    expect(base).toContain('mock_abc123')
    expect(base).toContain('990')
    expect(base).toContain('success')
  })

  it('生成的渠道订单号唯一', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newProviderOrderId()))
    expect(ids.size).toBe(50)
  })
})

describe('兑换码工具', () => {
  it('归一化：去除空格与连字符并转大写', () => {
    expect(normalizeRedemptionCode(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(normalizeRedemptionCode('abcd efgh')).toBe('ABCDEFGH')
    expect(normalizeRedemptionCode('ABCD-EFGH')).toBe('ABCDEFGH')
  })

  it('同一归一化结果哈希稳定', () => {
    expect(hashRedemptionCode(normalizeRedemptionCode('abcd-efgh'))).toBe(
      hashRedemptionCode(normalizeRedemptionCode('ABCD EFGH')),
    )
  })

  it('不同兑换码哈希不同', () => {
    expect(hashRedemptionCode('ABCDEFGH')).not.toBe(hashRedemptionCode('ABCDEFGI'))
  })

  it('哈希为 64 位 hex（sha256），且不等于明文', () => {
    const code = 'ABCDEFGH2345'
    const hash = hashRedemptionCode(code)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(code)
  })

  it('生成的兑换码格式可读且不含易混淆字符', () => {
    for (let index = 0; index < 20; index += 1) {
      const code = generateRedemptionCode()
      expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)
      expect(code).not.toMatch(/[0O1IL]/)
    }
  })

  it('生成的兑换码归一化后长度一致', () => {
    const code = generateRedemptionCode()
    expect(normalizeRedemptionCode(code)).toHaveLength(16)
  })
})

describe('商品目录（服务端定价真源）', () => {
  it('三个商品齐备且 id 自洽', () => {
    const products = listProducts()
    expect(products).toHaveLength(PRODUCT_IDS.length)
    for (const product of products) {
      expect(product.id).toBeTruthy()
      expect(isProductId(product.id)).toBe(true)
    }
  })

  it('金额为正整数（分），币种为 3 位', () => {
    for (const product of listProducts()) {
      expect(Number.isInteger(product.amountCents)).toBe(true)
      expect(product.amountCents).toBeGreaterThan(0)
      expect(product.currency).toHaveLength(3)
    }
  })

  it('未知商品返回 null（调用方据此拒绝，而非给默认值）', () => {
    expect(getProduct('not_a_product')).toBeNull()
    expect(getProduct('')).toBeNull()
  })

  it('解锁报告的商品必须发放 unlock_report 权益', () => {
    expect(getProduct('report_unlock')!.grant.kind).toBe('unlock_report')
  })

  it('次数包授予正次数', () => {
    const grant = getProduct('package_10')!.grant
    expect(grant.kind).toBe('add_credits')
    if (grant.kind === 'add_credits') expect(grant.credits).toBeGreaterThan(0)
  })

  it('订阅商品升级为付费等级', () => {
    const grant = getProduct('subscription_monthly')!.grant
    expect(grant.kind).toBe('upgrade_membership')
    if (grant.kind === 'upgrade_membership') expect(grant.level).not.toBe('free')
  })
})
