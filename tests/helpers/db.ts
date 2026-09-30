/**
 * 测试数据库辅助。
 *
 * 集成测试需要 DATABASE_URL 与 AUTH_SECRET：
 * - 两者齐备时正常执行；
 * - 缺失时由测试文件用 `describe.skipIf(!hasTestDatabase())` **显式跳过**，
 *   绝不用假的断言伪装通过（见 docs/engineering/ARCHITECTURE.md §8）。
 */
import { randomInt, randomUUID } from 'node:crypto'

import { inArray } from 'drizzle-orm'

import { closeDb, getDb, hasDatabaseUrl } from '@/db/client'
import { users } from '@/db/schema'
import { register } from '@/lib/services/handlers/auth-service'

export { closeDb }

/** 是否具备运行集成测试的条件 */
export function hasTestDatabase(): boolean {
  return hasDatabaseUrl() && Boolean(process.env.AUTH_SECRET)
}

/** 缺失条件的可读原因，用于测试标题与日志 */
export function missingTestEnvReason(): string {
  const missing: string[] = []
  if (!hasDatabaseUrl()) missing.push('DATABASE_URL')
  if (!process.env.AUTH_SECRET) missing.push('AUTH_SECRET')
  return missing.length > 0 ? `缺少 ${missing.join(', ')}` : ''
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}_${randomUUID()}@example.test`
}

/**
 * 生成唯一手机号：1 + 9 位随机数字（符合 /^1[3-9]\d{9}$/ 的校验）。
 * 第二位固定取 3–9 之一，保证能通过 phoneSchema。
 */
export function uniquePhone(): string {
  // 第二位取 3–9，其余 9 位随机，保证匹配 /^1[3-9]\d{9}$/
  const second = 3 + randomInt(0, 7)
  let rest = ''
  for (let i = 0; i < 9; i += 1) rest += randomInt(0, 10)
  return `1${second}${rest}`
}

export const TEST_PASSWORD = 'Test-Password-123'

export interface TestUser {
  id: string
  email: string
  token: string
}

/**
 * 通过真实的注册服务创建测试用户。
 * 复用生产代码路径（含同意记录、审计日志、会话创建），
 * 使集成测试覆盖的是真实行为而非测试专用捷径。
 */
export async function createTestUser(prefix = 'user'): Promise<TestUser> {
  const email = uniqueEmail(prefix)
  const result = await register({
    channel: 'email',
    email,
    password: TEST_PASSWORD,
    acceptTerms: true,
  })
  return { id: result.user.id, email, token: result.token }
}

/**
 * 通过**手机号通道**创建测试用户。
 *
 * 演示环境验证码固定为 8888（见 lib/auth/verification-code.ts），
 * 因此这里直接用固定码走真实注册路径，而不是绕过验证码。
 */
export async function createTestPhoneUser(prefix = 'phone'): Promise<{
  id: string
  phone: string
  username: string | null
  token: string
}> {
  const phone = uniquePhone()
  const result = await register({
    channel: 'phone',
    phone,
    code: '8888',
    acceptTerms: true,
  })
  return {
    id: result.user.id,
    phone,
    username: result.user.username,
    token: result.token,
  }
}

/** 清理本测试创建的软删除用户，避免数据堆积 */
export async function hardDeleteUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  const db = getDb()
  // 级联删除：sessions / consents / audit_logs 等随之清理
  await db.delete(users).where(inArray(users.id, userIds))
}
