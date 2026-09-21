/**
 * 测试数据库辅助。
 *
 * 集成测试需要 DATABASE_URL 与 AUTH_SECRET：
 * - 两者齐备时正常执行；
 * - 缺失时由测试文件用 `describe.skipIf(!hasTestDatabase())` **显式跳过**，
 *   绝不用假的断言伪装通过（见 docs/ARCHITECTURE.md §8）。
 */
import { randomUUID } from 'node:crypto'

import { inArray } from 'drizzle-orm'

import { closeDb, getDb, hasDatabaseUrl } from '@/db/client'
import { users } from '@/db/schema'
import { register } from '@/lib/services/auth-service'

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
    email,
    password: TEST_PASSWORD,
    acceptTerms: true,
  })
  return { id: result.user.id, email, token: result.token }
}

/** 清理本测试创建的软删除用户，避免数据堆积 */
export async function hardDeleteUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  const db = getDb()
  // 级联删除：sessions / consents / audit_logs 等随之清理
  await db.delete(users).where(inArray(users.id, userIds))
}
