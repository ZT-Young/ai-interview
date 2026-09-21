import { expect, test } from '@playwright/test'

/**
 * 合规页面的 E2E。
 *
 * **不需要数据库、也不需要登录**：合规页是静态渲染的。
 * 数据权利端点的未登录访问控制、冒烟、登录限流等用例已拆分到
 * `e2e/public.spec.ts` 与 `e2e/authz.spec.ts`，因为它们在
 * `playwright.config.ts` 中需要以 `storageState: undefined` 运行。
 */

const LEGAL_PAGES = [
  { path: '/legal/terms', title: '用户协议' },
  { path: '/legal/privacy', title: '隐私政策' },
  { path: '/legal/ai-disclosure', title: 'AI 生成内容说明' },
]

test.describe('合规页面', () => {
  for (const page_ of LEGAL_PAGES) {
    test(`${page_.path} 可访问且渲染正文`, async ({ page }) => {
      await page.goto(page_.path)

      await expect(page.getByTestId('legal-page')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: page_.title })).toBeVisible()
      // 版本与生效日期必须可见（合规要求：让用户知道同意的是哪一版）
      await expect(page.getByText(/版本 v\d+/)).toBeVisible()
      await expect(page.getByText(/生效日期/)).toBeVisible()
    })
  }

  test('隐私政策包含数据权利与保存期限说明', async ({ page }) => {
    await page.goto('/legal/privacy')

    // 用精确文本避免与「行使你的权利」等标题产生 strict mode 冲突
    await expect(page.getByText('四、保存期限')).toBeVisible()
    await expect(page.getByText('五、你的权利')).toBeVisible()
    await expect(page.getByText(/导出/).first()).toBeVisible()
    await expect(page.getByText(/删除/).first()).toBeVisible()
  })

  test('AI 说明明确内容为 AI 生成且不得用于录用决策', async ({ page }) => {
    await page.goto('/legal/ai-disclosure')

    await expect(page.getByText(/AI 生成内容/).first()).toBeVisible()
    await expect(page.getByText(/不得/).first()).toBeVisible()
  })

  test('不存在的合规类型返回 404', async ({ page }) => {
    const response = await page.goto('/legal/not-a-document')
    expect(response?.status()).toBe(404)
  })
})

