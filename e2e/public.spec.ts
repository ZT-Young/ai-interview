import { expect, test } from '@playwright/test'

/**
 * **无需登录**的用例集合。
 *
 * ⚠️ 本文件被 `playwright.config.ts` 的 `*-public` project 以
 * `storageState: undefined` 运行（即真正的未登录状态），
 * 因此**不要**依赖任何 seed / 登录态。
 *
 * 为什么必须单独成文件：其余 project 会注入 seed 的登录 cookie，
 * 「未登录应跳转登录页」「登录/注册页可访问」这类断言在已登录状态下必然失败。
 */

test.describe('冒烟（不依赖数据库与外部服务）', () => {
  test('首页可访问并渲染产品标题', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'AI 模拟面试' })).toBeVisible()
  })

  test('未登录访问受限页面会跳转到登录页', async ({ page }) => {
    await page.goto('/sessions')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  })

  test('登录与注册页面可访问', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('邮箱')).toBeVisible()
    await expect(page.getByLabel('密码')).toBeVisible()

    await page.goto('/register')
    await expect(page.getByLabel('邮箱')).toBeVisible()
    await expect(page.getByRole('button', { name: /注册/ })).toBeVisible()
  })

  test('移动端 H5：首页在 375px 宽不出现横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })
    await page.goto('/')

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(hasHorizontalScroll).toBe(false)
  })
})

test.describe('未登录访问控制', () => {
  test('未登录访问历史记录与会员页会跳转登录', async ({ page }) => {
    await page.goto('/sessions')
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/membership')
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/orders')
    await expect(page).toHaveURL(/\/login/)
  })

  test('未登录访问账户设置会跳转登录', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
  })

  test('未登录访问数据导出端点返回 401', async ({ request }) => {
    const response = await request.get('/api/auth/me/data-export')
    expect(response.status()).toBe(401)
  })

  test('未登录调用删除账号返回 401（不会误删）', async ({ request }) => {
    const response = await request.delete('/api/auth/me')
    expect(response.status()).toBe(401)
  })
})
