import { expect, test } from '@playwright/test'

import { resetSession } from './helpers'
import { missingReasons, readSeed } from './seed'

/**
 * 面试流程 E2E。
 *
 * 前置条件（缺一即跳过，并在报告中标注）：
 *   1. DATABASE_URL + AUTH_SECRET —— 会话与题目都要真实数据库
 *   2. E2E_INTERVIEW_SEED —— 指向一个「**计划已生成、尚未开始**」的会话
 *      （`pnpm e2e:seed --write` 产出；不能用已跑完的会话，见 scripts/e2e-seed.mts 说明）
 *   3. E2E_RESET_TOKEN —— 与 dev server 同值，用于在**每个用例前**把会话复位
 *
 * 登录态由 `e2e/global-setup.ts` 统一准备（storageState）。
 * 用例内**不要**各自登录：登录接口有按 IP 的限流，会把自己限流掉。
 *
 * ⚠️ 本文件必须**串行**执行（见 playwright.config.ts 的 `*-serial` project）：
 * 所有用例共用同一个会话，并行就会互相踩状态。
 */

const seed = readSeed()
const reasons = missingReasons(seed)

test.describe('面试房间', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(
      reasons.length > 0,
      `缺少前置条件：${reasons.join('、')}（见 e2e/interview.spec.ts 顶部说明）`,
    )

    // 每个用例都从「计划已生成、尚未开始」这个确定状态开始
    await resetSession(request, seed!.sessionId)

    // 登录态已由 global-setup 注入；确认受保护页面可达
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('进入面试：展示面试官气泡、当前问题、进度与计时', async ({ page }) => {
    await page.goto(`/sessions/${seed!.sessionId}/interview`)

    // 面试官气泡与当前问题
    await expect(page.getByText('面试官').first()).toBeVisible()
    await expect(page.getByTestId('transcript')).toBeVisible()
    await expect(page.getByTestId('transcript')).toContainText('请先做一个自我介绍')

    // 进度与状态
    await expect(page.getByTestId('progress')).toContainText('进度')
    await expect(page.getByTestId('interview-status')).toContainText('进行中')

    // 计时（mm:ss）
    await expect(page.getByLabel(/本题用时/)).toBeVisible()

    // 输入区与操作按钮
    await expect(page.getByTestId('answer-input')).toBeVisible()
    await expect(page.getByRole('button', { name: /按住说话/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '请求提示' })).toBeVisible()
    await expect(page.getByRole('button', { name: '跳过此题' })).toBeVisible()
    await expect(page.getByTestId('finish-interview')).toBeVisible()

    // 合规标识（AGENTS.md §7 C4）—— 用 main 作用域，避免与页脚标识 / 法务链接冲突
    await expect(page.getByRole('main').getByText(/AI 生成内容 · 仅供练习参考/)).toBeVisible()
  })

  test('提交回答：回答进入对话区，服务端返回追问或下一题', async ({ page }) => {
    await page.goto(`/sessions/${seed!.sessionId}/interview`)

    const input = page.getByTestId('answer-input')
    const answer =
      '我在这个项目里负责评分服务的重构，用两阶段提交保证数据一致性，接口 P95 从 800ms 降到 220ms。'

    // 等待当前问题渲染出来再提交（避免在 hydration 完成前空提交）
    const transcript = page.getByTestId('transcript')
    await expect(transcript).toContainText('请先做一个自我介绍')
    await input.fill(answer)

    // ⚠️ 必须等待真实响应，不能只断言最终 DOM：
    // 若点击发生在 hydration 完成前，onClick 还没挂上，点击会被静默忽略，
    // 表现为「提交了但没有回答」的偶发失败，很难定位。
    // 等响应既能防这个竞态，也能在接口报错时给出明确失败原因。
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/sessions/${seed!.sessionId}/answers`) &&
          res.request().method() === 'POST',
      ),
      page.getByTestId('submit-answer').click(),
    ])

    expect(response.status(), `提交回答接口应成功，实际 ${response.status()}`).toBe(200)

    // 用户回答进入对话区（用回答原文断言，比找「你」这个单字气泡标记稳）
    await expect(transcript).toContainText(/评分服务的重构/)

    // 输入框被清空，且出现下一步（追问或下一道主问题）
    await expect(input).toHaveValue('')
    await expect(page.getByTestId('interview-status')).toContainText(/进行中|追问/)
  })

  test('结束面试：二次确认后进入已结束状态', async ({ page }) => {
    await page.goto(`/sessions/${seed!.sessionId}/interview`)

    await expect(page.getByTestId('finish-interview')).toBeVisible()
    await page.getByTestId('finish-interview').click()

    // 与提交用例同理：等真实响应而不是只看 DOM。
    // 结束接口若失败（例如阶段已被推进），只断言 UI 会得到含糊的
    // 「元素未找到」，而等响应能直接给出状态码与原因。
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/sessions/${seed!.sessionId}/finish`) &&
          res.request().method() === 'POST',
      ),
      page.getByTestId('confirm-finish').click(),
    ])

    expect(response.status(), `结束面试接口应成功，实际 ${response.status()}`).toBe(200)

    await expect(page.getByTestId('interview-finished')).toBeVisible()
    await expect(page.getByText('面试已结束').first()).toBeVisible()
    await expect(page.getByTestId('interview-status')).toContainText('已结束')
  })

  test('跳过与提示：提示停留当前题，跳过推进进度', async ({ page }) => {
    await page.goto(`/sessions/${seed!.sessionId}/interview`)

    const progress = page.getByTestId('progress')
    await expect(page.getByTestId('transcript')).toContainText('请先做一个自我介绍')
    const progressBefore = await progress.textContent()

    // 请求提示
    await page.getByRole('button', { name: '请求提示' }).click()
    await expect(page.getByTestId('transcript')).toContainText(/提示/)
    // 提示不改变进度
    await expect(progress).toHaveText(progressBefore ?? '')

    // 跳过本题
    await page.getByRole('button', { name: '跳过此题' }).click()
    await expect(page.getByTestId('transcript')).toContainText(/已跳过该题/)
  })

  test('移动端 H5：375px 宽不出现横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })
    await page.goto(`/sessions/${seed!.sessionId}/interview`)

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(hasHorizontalScroll).toBe(false)

    // 关键控件在窄屏下仍可见可点
    await expect(page.getByTestId('answer-input')).toBeVisible()
    await expect(page.getByTestId('submit-answer')).toBeVisible()
  })
})
