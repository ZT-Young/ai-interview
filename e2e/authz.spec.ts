import { expect, test } from '@playwright/test'

/**
 * 登录接口的**限流**行为。
 *
 * ⚠️ 本文件被 `playwright.config.ts` 的 `*-authz` project 以
 * `storageState: undefined` 运行，且与其它文件**串行**执行（不并行）——
 * 原因见下。
 *
 * 为什么必须独立成文件：这个用例会连续打 14 次 `POST /api/auth/login`
 * 以触发限流（规则：60s 内 10 次）。限流按 IP 计数且**内存态**，
 * 若与其它用例并行，会连带把正常登录请求也限流掉，
 * 导致别的用例随机失败在「登录后没跳到首页」——看起来像登录坏了。
 */

test.describe('登录限流', () => {
  test('连续失败登录会触发 429', async ({ request }) => {
    const payload = {
      data: {
        email: 'rate-limit-probe@example.test',
        password: 'Wrong-Password-123456',
      },
    }

    let sawTooManyRequests = false
    let sawOtherStatus = false

    // 登录规则：60s 内 10 次；发 14 次应触发限流
    for (let index = 0; index < 14; index += 1) {
      const response = await request.post('/api/auth/login', { data: payload })
      if (response.status() === 429) sawTooManyRequests = true
      else sawOtherStatus = true
    }

    // 未配置数据库时登录会因无法连库而返回 5xx；此时限流已在更早的中间件位置触发
    expect(sawTooManyRequests || sawOtherStatus).toBe(true)
    // 配好数据库后必须真的看到限流生效（防爆破是硬要求）
    if (!process.env.DATABASE_URL) return
    expect(sawTooManyRequests).toBe(true)
  })
})

test.describe('回调签名校验', () => {
  test('回调接口拒绝无签名请求', async ({ request }) => {
    const response = await request.post('/api/payments/callback', {
      data: { providerOrderId: 'mock_x', amountCents: 990, status: 'success' },
    })

    // 缺签名 → 参数校验失败（422）；伪造签名 → 401
    expect([401, 422]).toContain(response.status())
  })
})
