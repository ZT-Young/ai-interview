import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { request } from '@playwright/test'

import { SESSION_COOKIE_NAME, STORAGE_STATE_PATH, readSeed } from './seed'

/**
 * Playwright 全局 setup：登录 **一次**，把会话 cookie 写成 storageState 供所有用例复用。
 *
 * ⚠️ 为什么必须这样做：
 * `POST /api/auth/login` 有按 IP 的防爆破限流（60s 内 10 次，
 * 见 lib/observability/rate-limit.ts）。若每个用例都在 UI 里登录一次，
 * 40 个用例 × 4 个 worker 并行会瞬间打满限额，用例随机失败在
 * 「登录后没跳到首页」——看起来像登录功能坏了，实际是自己把自己限流了。
 * 登录一次并复用会话，既避开限流，也显著加快 E2E。
 *
 * 未配置 seed 时不写 storageState（此时依赖登录的用例本就会显式 skip）。
 */
export default async function globalSetup(config: {
  projects: Array<{ name: string }>
}): Promise<void> {
  const seed = readSeed()
  const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'

  /**
   * 只在本次真的会跑「需要登录态」的 project 时才登录。
   *
   * 为什么重要：登录接口有 60s/10 次的限流，而限流额度是全局共享的。
   * 只跑 `*-public` / `*-authz`（匿名用例）时若仍登录一次，
   * 会白白吃掉一个额度，甚至在反复调试时把自己限流到 429，
   * 表现为 setup 直接失败——看起来像 seed 账号坏了。
   * 需要登录态的 project 就是那些**没有** testMatch 限制到 public/authz 的。
   */
  const needsAuth = config.projects.some(
    (project) => !['chromium-public', 'chromium-authz'].includes(project.name),
  )

  if (!needsAuth) {
    console.log('[e2e:setup] 本次只运行匿名用例，跳过登录态准备')
    return
  }

  if (!seed) {
    console.log('[e2e:setup] 未配置 E2E_INTERVIEW_SEED，跳过登录态准备（相关用例会 skip）')
    return
  }

  const context = await request.newContext({ baseURL })

  const response = await context.post('/api/auth/login', {
    data: { email: seed.email, password: seed.password },
  })

  if (!response.ok()) {
    const body = await response.text().catch(() => '')
    await context.dispose()
    throw new Error(
      `[e2e:setup] seed 账号登录失败（${response.status()}）：${body}\n` +
        '请确认 E2E_INTERVIEW_SEED 与数据库中的账号一致；' +
        '若刚触发过限流，等待 60 秒后重试。',
    )
  }

  const state = await context.storageState()
  await context.dispose()

  const hasSession = state.cookies.some((cookie) => cookie.name === SESSION_COOKIE_NAME)
  if (!hasSession) {
    throw new Error(`[e2e:setup] 登录成功但未拿到 ${SESSION_COOKIE_NAME} cookie，请检查登录接口`)
  }

  await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true })
  await writeFile(STORAGE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8')

  console.log(`[e2e:setup] 已保存登录态到 ${STORAGE_STATE_PATH}（账号 ${seed.email}）`)
}
