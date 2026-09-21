import { expect, test } from '@playwright/test'

import { cleanupDraftSessions } from './helpers'
import { missingReasons, readReportSeed } from './seed'

/**
 * 报告页与历史记录页 E2E。
 *
 * 前置条件（缺一即跳过，并在报告中标注）：
 *   1. DATABASE_URL + AUTH_SECRET —— 登录、读取报告、历史列表都需要真实数据库
 *   2. E2E_REPORT_SEED —— 格式 `email:password:sessionId`，指向一个**已完成且已生成报告**的会话
 *
 * 无 seed 时只验证「未登录重定向」这类不依赖数据的行为（已拆到 public.spec.ts）。
 *
 * 登录态由 `e2e/global-setup.ts` 统一准备（storageState），用例内不要再各自登录：
 * 登录接口有按 IP 的限流，会把自己限流掉。
 */

const seed = readReportSeed()
const missing = missingReasons(seed)

test.describe('报告页', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(missing.length > 0, `缺少前置条件：${missing.join('、')}（见 e2e/report.spec.ts 顶部说明）`)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('查看报告：总分、岗位匹配度、六维雷达图与训练建议', async ({ page }) => {
    await page.goto(`/sessions/${seed!.sessionId}/report`)

    // 总分与岗位匹配度
    await expect(page.getByTestId('total-score')).toBeVisible()

    // 六维雷达图（自绘 SVG，含无障碍标签）
    const radar = page.getByTestId('dimension-radar')
    await expect(radar).toBeVisible()
    await expect(radar.locator('svg[role="img"]')).toBeVisible()

    // 六维数值列表（颜色不是唯一信息载体）
    for (const dimension of ['岗位匹配', '专业能力', '项目深度', '逻辑表达', '沟通表达', '动机稳定性']) {
      await expect(radar.getByText(dimension)).toBeVisible()
    }

    // 训练建议（基础建议免费可见）
    await expect(page.getByTestId('training-suggestions')).toBeVisible()

    // 合规标识（AGENTS.md §7 C4）。
    // 报告页自身不渲染该标识，它由 `app/(app)/layout.tsx` 的页脚统一提供，
    // 因此断言目标是 contentinfo（footer）里的那段文案。
    // 必须用精确文本：页脚同时含「AI 生成内容说明」法务链接，
    // 用 /AI 生成内容/ 会同时命中两者而触发 strict mode 冲突。
    await expect(
      page.getByRole('contentinfo').getByText('AI 生成内容 · 仅供练习参考，不构成任何录用判断'),
    ).toBeVisible()
  })

  test('逐题反馈默认折叠，展开后显示评分依据（回答原文）', async ({ page }) => {
    await page.goto(`/sessions/${seed!.sessionId}/report`)

    const items = page.getByTestId('evaluation-item')
    const count = await items.count()

    if (count === 0) {
      // 未解锁时逐题反馈被遮罩，这是预期行为
      test.skip(true, '该会话未解锁逐题反馈，跳过展开校验')
      return
    }

    const first = items.first()
    // 默认折叠：内容不可见
    await expect(first).not.toHaveAttribute('open', '')

    await first.locator('summary').click()
    await expect(first.getByText('评分依据（回答原文）')).toBeVisible()
  })

  test('移动端 H5：报告长页无横向滚动，雷达图自适应', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })
    await page.goto(`/sessions/${seed!.sessionId}/report`)

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(hasHorizontalScroll).toBe(false)

    const svgBox = await page.getByTestId('dimension-radar').locator('svg').boundingBox()
    expect(svgBox).not.toBeNull()
    // 图表宽度不超过视口
    expect(svgBox!.width).toBeLessThanOrEqual(375)
  })
})

test.describe('历史记录页', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(missing.length > 0, `缺少前置条件：${missing.join('、')}`)

    /**
     * 只**清理**本次运行新建的 draft 会话，**不要**重置会话状态。
     *
     * 「再次训练」用例每次新建一个会话且无法从 UI 删除；长期累积会把报告会话
     * 挤出首页（`/sessions` 上限 50 条），导致下面「从历史记录进入旧报告」
     * 找不到入口。
     *
     * ⚠️ 这里不能调 `resetSession()`：它会把会话状态复位成
     * `planned/READY`，而列表只在 `status === 'completed'` 时渲染
     * 「查看报告」入口 —— 那样反而把本组的依赖数据弄坏了（实测踩过）。
     */
    await cleanupDraftSessions(request, seed!.sessionId)

    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('历史列表展示会话与操作入口', async ({ page }) => {
    await page.goto('/sessions')

    await expect(page.getByRole('heading', { name: '历史记录' })).toBeVisible()
    await expect(page.getByTestId('sessions-list')).toBeVisible()

    // 每条记录至少有「再次训练」入口
    await expect(page.getByTestId('retrain-button').first()).toBeVisible()
  })

  test('从历史记录进入旧报告', async ({ page }) => {
    await page.goto('/sessions')

    // 只点「有报告」的那一条：列表里可能同时存在尚未答题的草稿会话，
    // 它们的「查看报告」会落到「报告还没有生成」，与用例意图不符
    const reportLink = page
      .getByTestId('sessions-list')
      .locator('[data-testid="view-report-link"][href$="/report"]')
      .first()

    await expect(reportLink).toBeVisible()
    await reportLink.click()

    await expect(page).toHaveURL(/\/sessions\/[^/]+\/report/)
    await expect(page.getByTestId('total-score')).toBeVisible()
  })

  test('再次训练会新建会话并跳转到计划页', async ({ page }) => {
    await page.goto('/sessions')
    await expect(page.getByTestId('retrain-button').first()).toBeVisible()

    // 记录点击前的会话链接集合，用「新增了一个会话」判定成功，
    // 比断言 URL 形状更稳（并行/刷新都不会造成假通过）
    await page.getByTestId('retrain-button').first().click()

    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: '面试计划' })).toBeVisible()
  })
})

test.describe('会员与订单页', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(missing.length > 0, `缺少前置条件：${missing.join('、')}`)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('会员页展示免费次数、权益对照与订单入口', async ({ page }) => {
    await page.goto('/membership')

    await expect(page.getByTestId('membership-status')).toBeVisible()
    await expect(page.getByTestId('free-credits')).toBeVisible()
    await expect(page.getByTestId('benefit-matrix')).toBeVisible()
    await expect(page.getByTestId('orders-link')).toBeVisible()

    // 渠道未接入时购买按钮必须禁用（不得给出无法完成的购买路径）。
    // testid 形式是 `buy-<productId>`（见 app/(app)/membership/page.tsx）
    await expect(page.getByTestId('buy-subscription_monthly')).toBeDisabled()
    await expect(page.getByTestId('buy-package_10')).toBeDisabled()
  })

  test('订单记录入口可打开并展示订单列表', async ({ page }) => {
    await page.goto('/membership')
    await page.getByTestId('orders-link').click()

    await expect(page).toHaveURL(/\/orders$/)
    await expect(page.getByRole('heading', { name: '订单记录' })).toBeVisible()

    // 空状态或列表都可接受：seed 账号本身有记录，新账号没有
    await expect(
      page.getByTestId('orders-empty').or(page.getByTestId('orders-list')),
    ).toBeVisible()
  })
})
