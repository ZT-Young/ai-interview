import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

/**
 * E2E 共享常量与 seed 解析。
 *
 * 独立成模块是为了让 `playwright.config.ts` 与 `e2e/global-setup.ts`
 * 共享同一份路径定义，避免两边各写一份而漂移。
 */

/** 全局登录态文件：由 global-setup 写入，所有 project 复用 */
export const STORAGE_STATE_PATH = 'test-results/.auth/seed.json'

export const SESSION_COOKIE_NAME = 'ai_interview_session'

export interface InterviewSeed {
  email: string
  password: string
  sessionId: string
}

/** 解析 `email:password:sessionId` 形式的 seed 变量 */
function parseSeed(raw: string | undefined): InterviewSeed | null {
  if (!raw) return null

  const parts = raw.split(':')
  if (parts.length !== 3) return null

  const [email, password, sessionId] = parts
  if (!email || !password || !sessionId) return null

  return { email, password, sessionId }
}

/**
 * 面试房间用例用的 seed：会话必须处于「计划已生成、**尚未开始**」（planned/IDLE），
 * 因为这些用例会点「开始面试」并驱动状态机前进。
 */
export function readSeed(): InterviewSeed | null {
  return parseSeed(process.env.E2E_INTERVIEW_SEED)
}

/**
 * 报告 / 历史 / 会员用例用的 seed：会话必须**已完成并生成报告**。
 *
 * 与 `readSeed()` 必须分开：同一个会话不可能既是「尚未开始」又是「已完成」。
 * 早期两者共用一个「跑完整场」的会话，导致面试房间页面报「还没有面试计划」，
 * 而 `/next` 试图 `REPORTING → FINISHED` 被状态机拒绝（422）。
 */
export function readReportSeed(): InterviewSeed | null {
  return parseSeed(process.env.E2E_REPORT_SEED)
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET)
}

/** 缺失前置条件的可读说明，用于 test.skip 的消息 */
export function missingReasons(seed: InterviewSeed | null): string[] {
  return [
    !hasDatabase() ? 'DATABASE_URL/AUTH_SECRET' : null,
    !seed ? 'E2E seed 变量（用 pnpm e2e:seed --write 生成）' : null,
  ].filter((item): item is string => item !== null)
}
