import { expect, test } from '@playwright/test'

import { missingReasons, readSeed } from './seed'

/**
 * 新建面试页：简历与 JD 都支持「选择已有 / 上传文件 / 粘贴文本」。
 *
 * 登录态由 global-setup 统一准备；未配 seed 时跳过。
 */

const seed = readSeed()
const missing = missingReasons(seed)

test.describe('新建面试：三种资料来源', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(missing.length > 0, `缺少前置条件：${missing.join('、')}`)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('简历区可在「选择已有 / 上传文件 / 粘贴文本」间切换', async ({ page }) => {
    await page.goto('/sessions/new')
    const resume = page.getByTestId('resume-section')

    // 默认展示选择器
    await expect(resume.getByLabel('选择简历')).toBeVisible()

    // 切到上传文件 → 出现文件选择框
    await resume.getByRole('tab', { name: '上传文件' }).click()
    await expect(resume.getByLabel('简历文件')).toBeVisible()
    await expect(resume.getByTestId('upload-resume')).toBeVisible()

    // 切到粘贴文本 → 出现文本框
    await resume.getByRole('tab', { name: '粘贴文本' }).click()
    await expect(resume.getByLabel('简历文本')).toBeVisible()
    await expect(resume.getByTestId('submit-resume-text')).toBeVisible()

    // 切回选择已有
    await resume.getByRole('tab', { name: '选择已有' }).click()
    await expect(resume.getByLabel('选择简历')).toBeVisible()
  })

  test('JD 区可在「选择已有 / 粘贴文本 / 上传图片」间切换', async ({ page }) => {
    await page.goto('/sessions/new')
    const jd = page.getByTestId('jd-section')

    await expect(jd.getByLabel('选择岗位 JD')).toBeVisible()

    await jd.getByRole('tab', { name: '粘贴文本' }).click()
    await expect(jd.getByLabel('JD 文本')).toBeVisible()

    await jd.getByRole('tab', { name: '上传图片' }).click()
    await expect(jd.getByLabel('JD 图片文件')).toBeVisible()

    await jd.getByRole('tab', { name: '选择已有' }).click()
    await expect(jd.getByLabel('选择岗位 JD')).toBeVisible()
  })

  test('粘贴简历与 JD 后可创建面试（解析失败也保留资料）', async ({ page }) => {
    await page.goto('/sessions/new')

    const resume = page.getByTestId('resume-section')
    await resume.getByRole('tab', { name: '粘贴文本' }).click()
    await resume
      .getByLabel('简历文本')
      .fill('张伟 后端开发工程师\n技能：TypeScript、PostgreSQL\n项目：AI 面试平台评分服务重构')
    await resume.getByTestId('submit-resume-text').click()

    // 无论解析成功还是失败，资料都必须就绪（失败时提示可手动补充）
    await expect(resume.getByTestId('resume-ready')).toBeVisible()

    const jd = page.getByTestId('jd-section')
    await jd.getByRole('tab', { name: '粘贴文本' }).click()
    await jd
      .getByLabel('JD 文本')
      .fill('岗位职责：负责 AI 应用后端开发。任职资格：3 年以上 Node.js 经验，熟悉 TypeScript。')
    await jd.getByTestId('submit-jd-text').click()
    await expect(jd.getByTestId('jd-ready')).toBeVisible()

    // 两项就绪后「创建」按钮应可用，并能跳到面试计划页
    const submit = page.getByTestId('create-session')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: '面试计划' })).toBeVisible()
  })
})
