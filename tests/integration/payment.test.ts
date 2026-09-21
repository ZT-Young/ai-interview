import { afterAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { payments, redemptionCodes, reports, interviewSessions, users } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { getProduct } from '@/lib/payments/products'
import { hashRedemptionCode, normalizeRedemptionCode } from '@/lib/payments/redemption-code'
import {
  consumeFreeTrial,
  createOrder,
  FREE_TRIAL_LIMIT,
  grantEntitlement,
} from '@/lib/services/payment-service'
import { hasReportUnlock, getEntitlements } from '@/lib/services/entitlement-service'
import { redeemCode } from '@/lib/services/redemption-service'
import { getReportBySession } from '@/lib/services/report-service'

import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
} from '../helpers/db'

/**
 * 支付与权益集成测试。
 *
 * 覆盖任务要求的三项：**权益计算**（落库侧）、**重复回调**（防重复发放）、**越权访问**。
 * 需 DATABASE_URL + AUTH_SECRET；缺失时显式跳过。
 */

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

async function newUser(prefix: string) {
  const user = await createTestUser(prefix)
  createdUserIds.push(user.id)
  return user
}

/** 建兑换码（明文只存在于测试内存中，库里只有哈希） */
async function seedRedemptionCode(productId: string, options: { maxUsages?: number; disabled?: boolean; expired?: boolean } = {}) {
  const db = getDb()
  const plaintext = `TESTCODE${Math.random().toString(36).slice(2, 10).toUpperCase()}`

  const inserted = await db
    .insert(redemptionCodes)
    .values({
      codeHash: hashRedemptionCode(normalizeRedemptionCode(plaintext)),
      productId,
      maxUsages: options.maxUsages ?? 1,
      disabled: options.disabled ?? false,
      expiresAt: options.expired ? new Date(Date.now() - 86_400_000) : null,
    })
    .returning()

  return { plaintext, row: inserted[0]! }
}

describe.skipIf(!hasTestDatabase())(
  `支付与权益集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    describe('兑换码', () => {
      it('有效兑换码发放权益并记录订单', async () => {
        const user = await newUser('redeem-ok')
        const { plaintext } = await seedRedemptionCode('package_10')

        const result = await redeemCode(user.id, plaintext)

        expect(result.product.id).toBe('package_10')
        expect(result.order.status).toBe('paid')
        expect(result.order.amountCents).toBe(getProduct('package_10')!.amountCents)
        expect(result.remainingUsages).toBe(0)

        // 权益已发放：次数包 → free_credits 增加
        const db = getDb()
        const userRow = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        expect(userRow.freeCredits).toBe(1 + 10)
      })

      it('金额来自服务端商品目录，与请求无关', async () => {
        const user = await newUser('redeem-price')
        const { plaintext } = await seedRedemptionCode('subscription_monthly')

        const result = await redeemCode(user.id, plaintext)
        expect(result.order.amountCents).toBe(getProduct('subscription_monthly')!.amountCents)
      })

      it('明文不入库（库里只有哈希）', async () => {
        const user = await newUser('redeem-hash')
        const { plaintext, row } = await seedRedemptionCode('report_unlock')

        const db = getDb()
        const stored = (
          await db.select().from(redemptionCodes).where(eq(redemptionCodes.id, row.id))
        )[0]!

        expect(stored.codeHash).not.toContain(plaintext)
        expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/)
      })

      it('无效兑换码返回 404', async () => {
        const user = await newUser('redeem-invalid')
        await expect(redeemCode(user.id, 'NOSUCHCODE1234')).rejects.toMatchObject({ status: 404 })
      })

      it('已停用的兑换码被拒绝', async () => {
        const user = await newUser('redeem-disabled')
        const { plaintext } = await seedRedemptionCode('package_10', { disabled: true })
        await expect(redeemCode(user.id, plaintext)).rejects.toMatchObject({ status: 409 })
      })

      it('已过期的兑换码被拒绝', async () => {
        const user = await newUser('redeem-expired')
        const { plaintext } = await seedRedemptionCode('package_10', { expired: true })
        await expect(redeemCode(user.id, plaintext)).rejects.toMatchObject({ status: 409 })
      })

      it('用尽次数的兑换码被拒绝（同一码不能重复兑换）', async () => {
        const first = await newUser('redeem-once-1')
        const second = await newUser('redeem-once-2')
        const { plaintext } = await seedRedemptionCode('package_10', { maxUsages: 1 })

        await expect(redeemCode(first.id, plaintext)).resolves.toBeTruthy()
        await expect(redeemCode(second.id, plaintext)).rejects.toMatchObject({ status: 409 })
      })

      it('一码多用：max_usages 为 2 时可供两人兑换', async () => {
        const first = await newUser('redeem-multi-1')
        const second = await newUser('redeem-multi-2')
        const { plaintext } = await seedRedemptionCode('package_10', { maxUsages: 2 })

        const a = await redeemCode(first.id, plaintext)
        const b = await redeemCode(second.id, plaintext)

        expect(a.remainingUsages).toBe(1)
        expect(b.remainingUsages).toBe(0)
      })

      it('兑换订阅后成为会员并获得全部权益', async () => {
        const user = await newUser('redeem-member')
        const { plaintext } = await seedRedemptionCode('subscription_monthly')

        await redeemCode(user.id, plaintext)

        const entitlements = await getEntitlements(user.id)
        expect(entitlements.isMember).toBe(true)
        expect(entitlements.unlimitedInterviews).toBe(true)
        expect(entitlements.reportDetail).toBe(true)
        expect(entitlements.voiceInterview).toBe(true)
      })
    })

    describe('回调幂等（防重复发放）', () => {
      it('同一支付凭证重复发放只生效一次', async () => {
        const user = await newUser('callback-idem')
        const product = getProduct('package_10')!
        const { order } = await createOrder(user.id, product.id)

        // 第一次发放
        const first = await grantEntitlement(order.id)
        expect(first.granted).toBe(true)

        const db = getDb()
        const afterFirst = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        expect(afterFirst.freeCredits).toBe(1 + 10)

        // 第二次（模拟渠道重试）→ 不得二次发放
        const second = await grantEntitlement(order.id)
        expect(second.granted).toBe(false)
        expect(second.reason).toBe('already_paid')

        const afterSecond = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        expect(afterSecond.freeCredits).toBe(1 + 10)
      })

      it('并发重复发放只有一个成功（乐观锁）', async () => {
        const user = await newUser('callback-concurrent')
        const { order } = await createOrder(user.id, 'package_10')

        const results = await Promise.all([
          grantEntitlement(order.id),
          grantEntitlement(order.id),
          grantEntitlement(order.id),
        ])

        expect(results.filter((item) => item.granted)).toHaveLength(1)

        const db = getDb()
        const userRow = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        // 只加了一次 10
        expect(userRow.freeCredits).toBe(1 + 10)
      })

      it('数据库层阻止同一 (provider, provider_order_id) 重复下单', async () => {
        const user = await newUser('callback-unique')
        const { order, providerOrderId } = await createOrder(user.id, 'package_10')
        expect(order.providerOrderId).toBe(providerOrderId)

        const db = getDb()
        await expect(
          db.insert(payments).values({
            userId: user.id,
            unlockType: 'package',
            amountCents: 100,
            status: 'pending',
            provider: order.productId,
            providerOrderId,
          }),
        ).rejects.toThrow()
      })

      it('重复发放不会重复写成已支付状态', async () => {
        const user = await newUser('callback-status')
        const { order } = await createOrder(user.id, 'package_10')

        await grantEntitlement(order.id)
        await grantEntitlement(order.id)

        const db = getDb()
        const rows = await db
          .select()
          .from(payments)
          .where(and(eq(payments.id, order.id), eq(payments.status, 'paid')))
        expect(rows).toHaveLength(1)
      })
    })

    describe('免费额度消耗', () => {
      it('首次消耗成功并扣减余额', async () => {
        const user = await newUser('trial-first')
        const db = getDb()

        // 需要一条报告记录作为凭证关联；直接插入最小报告
        const reportId = await insertMinimalReport(user.id)

        const result = await consumeFreeTrial(user.id, reportId)
        expect(result.consumed).toBe(true)
        expect(result.remaining).toBe(0)

        const userRow = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        expect(userRow.freeCredits).toBe(0)
      })

      it('同一报告重复消耗是幂等的（不会重复扣）', async () => {
        const user = await newUser('trial-idem')
        const reportId = await insertMinimalReport(user.id)

        await consumeFreeTrial(user.id, reportId)
        const second = await consumeFreeTrial(user.id, reportId)

        expect(second.consumed).toBe(false)
        expect(second.reason).toBe('already_consumed')

        const db = getDb()
        const userRow = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        expect(userRow.freeCredits).toBe(0)
      })

      it('额度用尽后新的报告不再消耗（保持 0，不出现负数）', async () => {
        const user = await newUser('trial-exhausted')
        const first = await insertMinimalReport(user.id)
        const second = await insertMinimalReport(user.id)

        await consumeFreeTrial(user.id, first)
        const result = await consumeFreeTrial(user.id, second)

        expect(result.consumed).toBe(false)
        expect(result.reason).toBe('limit_reached')

        const db = getDb()
        const userRow = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        expect(userRow.freeCredits).toBe(0)
      })

      it('会员消耗时不扣额度', async () => {
        const user = await newUser('trial-member')
        const db = getDb()
        await db.update(users).set({ membership: 'plus' }).where(eq(users.id, user.id))

        const reportId = await insertMinimalReport(user.id)
        const result = await consumeFreeTrial(user.id, reportId)

        expect(result.consumed).toBe(false)
        expect(result.reason).toBe('member')

        const userRow = (await db.select().from(users).where(eq(users.id, user.id)))[0]!
        expect(userRow.freeCredits).toBe(1)
      })

      it('免费额度上限为 1 次', () => {
        expect(FREE_TRIAL_LIMIT).toBe(1)
      })
    })

    describe('越权访问', () => {
      it('无法解锁他人的报告（下单时归属校验）', async () => {
        const owner = await newUser('authz-owner')
        const intruder = await newUser('authz-intruder')

        const reportId = await insertMinimalReport(owner.id)

        await expect(
          createOrder(intruder.id, 'report_unlock', { reportId }),
        ).rejects.toMatchObject({ status: 404 })

        // 本人可以
        await expect(createOrder(owner.id, 'report_unlock', { reportId })).resolves.toBeTruthy()
      })

      it('他人的报告不会被判为已解锁', async () => {
        const owner = await newUser('authz-unlock-owner')
        const intruder = await newUser('authz-unlock-intruder')

        const reportId = await insertMinimalReport(owner.id)
        const { order } = await createOrder(owner.id, 'report_unlock', { reportId })
        await grantEntitlement(order.id)

        // 报告确实被解锁了（对 owner）
        await expect(hasReportUnlock(owner.id, reportId)).resolves.toBe(true)
        // 但 intruder 查询同一报告时为 false（userId 参与条件）
        await expect(hasReportUnlock(intruder.id, reportId)).resolves.toBe(false)
      })

      it('无法用他人的支付凭证发放权益给自己（凭证已绑定 user_id）', async () => {
        const owner = await newUser('authz-grant-owner')
        const intruder = await newUser('authz-grant-intruder')

        const { order } = await createOrder(owner.id, 'package_10')
        await grantEntitlement(order.id)

        const db = getDb()
        const intruderRow = (await db.select().from(users).where(eq(users.id, intruder.id)))[0]!
        // intruder 的额度不受影响
        expect(intruderRow.freeCredits).toBe(1)

        const ownerRow = (await db.select().from(users).where(eq(users.id, owner.id)))[0]!
        expect(ownerRow.freeCredits).toBe(1 + 10)
      })

      it('不存在的商品或不存在的报告被拒绝', async () => {
        const user = await newUser('authz-invalid')
        await expect(createOrder(user.id, 'nope')).rejects.toBeInstanceOf(ApiError)

        await expect(
          createOrder(user.id, 'report_unlock', {
            reportId: '00000000-0000-0000-0000-000000000000',
          }),
        ).rejects.toMatchObject({ status: 404 })
      })

      it('getReportBySession 对他人会话返回 404', async () => {
        const owner = await newUser('authz-report-owner')
        const intruder = await newUser('authz-report-intruder')

        const { sessionId } = await insertMinimalSessionWithReport(owner.id)

        await expect(getReportBySession(intruder.id, sessionId)).rejects.toMatchObject({
          status: 404,
        })
      })
    })
  },
)

/* ------------------------------------------------------------------ *
 * 夹具：直接插入最小会话/报告（绕过 AI 流程）
 * ------------------------------------------------------------------ */

/** 建一条最小会话 + 报告（报告外键必须指向真实会话） */
async function insertMinimalSessionWithReport(
  userId: string,
): Promise<{ sessionId: string; reportId: string }> {
  const db = getDb()

  const sessionRows = await db
    .insert(interviewSessions)
    .values({
      userId,
      status: 'completed',
      phase: 'FINISHED',
      // 完成态必须带 finishedAt：表上有 CHECK
      // sessions_finished_at_required (status <> 'completed' OR finished_at IS NOT NULL)
      finishedAt: new Date(),
      config: {},
    })
    .returning({ id: interviewSessions.id })

  const sessionId = sessionRows[0]!.id

  const reportRows = await db
    .insert(reports)
    .values({
      sessionId,
      userId,
      totalScore: '80',
      dimensionScores: { job_match: 4, professional: 4, project_depth: 4, logic: 4, communication: 4, motivation: 4 },
      highlights: [],
      issues: [],
      referenceAnswers: [],
      nextSteps: [],
      resumeRisks: [],
    })
    .returning({ id: reports.id })

  return { sessionId, reportId: reportRows[0]!.id }
}

async function insertMinimalReport(userId: string): Promise<string> {
  const { reportId } = await insertMinimalSessionWithReport(userId)
  return reportId
}
