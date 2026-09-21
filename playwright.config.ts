import { existsSync } from 'node:fs'

import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

import { STORAGE_STATE_PATH, readSeed } from './e2e/seed'

// Playwright 不会自动加载 .env*，这里手动加载，使 E2E 能读到 DATABASE_URL / AUTH_SECRET / E2E_*
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'

/**
 * 只在 global-setup 确实产出过登录态时才复用，
 * 否则显式传一个不存在的路径会让 Playwright 直接报错（未配置 seed 的场景应能正常 skip）。
 */
const storageState = readSeed() && existsSync(STORAGE_STATE_PATH) ? STORAGE_STATE_PATH : undefined

/**
 * Playwright 配置。
 *
 * webServer 使用 `pnpm dev` 而非 `pnpm build && pnpm start`：
 * 避免每次跑 E2E 都触发一次完整构建（E2E 关注交互，不关注产物优化）。
 * 若本地已有 dev server，`reuseExistingServer` 会复用，不会重复启动。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /**
   * ⚠️ 必须单 worker（= project 之间也串行）。
   *
   * 本套 E2E 有三个**全局共享资源**，并行就必然互相打断：
   * 1. **同一个 seed 会话**：`chromium-serial` 与 `mobile-h5` 都是桌面/移动端各跑
   *    一遍面试流程，用的是同一个 `E2E_INTERVIEW_SEED`。并行时两条流水线同时
   *    重置并提交同一个会话 —— 实测表现为 `POST /answers` 撞唯一约束返回 **500**、
   *    `POST /finish` 撞状态机返回 **422**（而单独跑必过，极难定位）。
   * 2. **按 IP 的登录限流**（60s/10 次）：多个 worker 各自登录会把限额打满。
   * 3. **限流用例本身**要连打 14 次登录接口，必须独占。
   *
   * 代价是整体耗时变长；对本项目的规模可以接受，正确性优先。
   */
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  /**
   * 全局登录一次并复用会话：`POST /api/auth/login` 有按 IP 的防爆破限流
   * （60s 内 10 次），每个用例各登录一次会把限额瞬间打满，
   * 表现为大量用例随机失败在「登录后没跳到首页」。
   */
  globalSetup: './e2e/global-setup.ts',
  /**
   * Next.js dev server 首次编译某个路由需要数秒（比生产构建慢得多）。
   * 默认 5s 的断言超时在与其它用例并行时会偶发不够，
   * 表现为「元素未找到」的假失败——断言本身没错，是环境慢。
   */
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    locale: 'zh-CN',
    actionTimeout: 15_000,
    /**
     * 使用完整 Chromium 的「新无头模式」，而不是 Playwright 默认的
     * `chrome-headless-shell`。
     *
     * 原因：headless shell 是独立下载包（约 115MB），而完整 Chromium 里已经
     * 内置了无头能力。指定 `channel: 'chromium'` 可以只下载一个包就跑 E2E，
     * 避免「装了 Chromium 却因缺 headless shell 而无法运行」。
     *
     * ⚠️ 必须同时显式指定 `browserName: 'chromium'`：设备预设（如 iPhone 13）
     * 自带 `defaultBrowserType: 'webkit'`，展开后会覆盖浏览器类型，导致
     * `Unsupported webkit channel "chromium"`。下面两个 project 都显式覆盖。
     */
    channel: 'chromium',
    browserName: 'chromium',
  },
  projects: [
    // ---- 需要登录态的用例：复用 global-setup 产出的 storageState ----
    /**
     * ⚠️ 面试房间与报告/历史/会员用例共用同一个 seed 会话，**必须串行**：
     * 并行时一个用例点「结束面试」会把会话置为已结束，另一个用例再点「请求提示」
     * 就会因为按钮消失而超时——表现为随机失败。
     * `fullyParallel: false` + 单 worker 保证同一 project 内按顺序执行。
     */
    {
      name: 'chromium-serial',
      testMatch: [
        '**/interview.spec.ts',
        '**/report.spec.ts',
        '**/compliance.spec.ts',
        '**/session-create.spec.ts',
      ],
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'], browserName: 'chromium', storageState },
    },
    {
      name: 'mobile-h5',
      testIgnore: ['**/public.spec.ts', '**/authz.spec.ts', '**/legal-links.spec.ts'],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        channel: 'chromium',
        storageState,
      },
    },

    // ---- 必须处于「未登录」状态的用例 ----
    // 注意：**不要**在顶层 `use` 里设 storageState 再靠 `undefined` 覆盖——
    // 实测覆盖无效（空配置会被合并忽略），只有「需要登录的 project 自己设置」
    // 才是可靠的。因此 storageState 只出现在上面两个 project 上。
    {
      name: 'chromium-public',
      testMatch: ['**/public.spec.ts', '**/legal-links.spec.ts'],
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    // 限流用例会连打 14 次登录接口，必须**完全并行隔离**（独占一个 worker），
    // 否则会把同 IP 的正常登录请求一起限流掉
    {
      name: 'chromium-authz',
      testMatch: ['**/authz.spec.ts'],
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
