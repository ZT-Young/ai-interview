import { expect, test } from '@playwright/test'

/**
 * 注册页的知情同意链接（合规要求：用户勾选前必须能查看自己同意了什么）。
 *
 * ⚠️ 本文件被 `chromium-public` project 以 `storageState: undefined` 运行，**必须未登录**。
 * 原因：`/register` 对已登录用户会重定向到首页（见 app/register/page.tsx 的重定向逻辑），
 * 已登录状态下页面上根本不存在注册表单，断言必然失败。
 * 原生 compliance.spec.ts 由带登录态的 project 运行，因此这条用例必须单独成文件。
 */

const CONSENT_LINKS = [
  { path: '/legal/terms', label: '用户协议' },
  { path: '/legal/privacy', label: '隐私政策' },
  { path: '/legal/ai-disclosure', label: 'AI 生成内容说明' },
]

test.describe('注册页知情同意', () => {
  test('同意文字包含三条可点击链接', async ({ page }) => {
    await page.goto('/register')

    // 先确认确实停在注册页（未登录态）
    await expect(page.getByLabel('邮箱')).toBeVisible()

    for (const item of CONSENT_LINKS) {
      const link = page.locator(`a[href="${item.path}"]`).first()
      await expect(link).toBeVisible()
      await expect(link).toHaveText(new RegExp(item.label))
    }
  })

  test('未勾选同意时注册按钮不可点击（同意为必填）', async ({ page }) => {
    await page.goto('/register')
    await expect(page.getByLabel('邮箱')).toBeVisible()

    await page.getByLabel('邮箱').fill(`no-consent-${Date.now()}@example.test`)
    await page.getByLabel('密码').fill('Test-Password-123')

    const submit = page.getByRole('button', { name: /注册/ })
    // 未勾选知情同意 → 不能提交（合规 C1：知情同意是开始使用的前提）
    await expect(submit).toBeDisabled()

    // 勾选后即可提交
    await page.getByRole('checkbox').check()
    await expect(submit).toBeEnabled()
  })
})
