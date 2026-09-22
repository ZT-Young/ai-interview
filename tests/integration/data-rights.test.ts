import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { sessions, users } from '@/db/schema'
import { resolveSessionUser } from '@/lib/auth/verify-session'
import { deleteUserAccount, exportUserData } from '@/lib/services/handlers/data-rights-service'
import { login } from '@/lib/services/handlers/auth-service'
import type { StoragePort } from '@/lib/storage/s3'

import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
  TEST_PASSWORD,
} from '../helpers/db'

/**
 * 数据权利集成测试（AGENTS.md §7 C3）。
 *
 * 覆盖：**导出**（含 PII 边界）与**删除**（含会话失效、S3 清理）。
 * 需 DATABASE_URL + AUTH_SECRET；缺失时显式跳过。
 */

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

/** 记录删除了哪些 key 的存储替身 */
function fakeStorage() {
  const deleted: string[] = []
  const storage: StoragePort = {
    putObject: async () => undefined,
    getObject: async () => Buffer.from(''),
    deleteObject: async (key: string) => {
      deleted.push(key)
    },
  }
  return { storage, deleted }
}

/** 会失败的存储替身（验证「删除不因清理失败而回滚」） */
function failingStorage(): StoragePort {
  return {
    putObject: async () => undefined,
    getObject: async () => Buffer.from(''),
    deleteObject: async () => {
      throw new Error('对象存储不可用')
    },
  }
}

describe.skipIf(!hasTestDatabase())(
  `数据权利集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    describe('数据导出', () => {
      it('导出账号、同意记录与订单结构', async () => {
        const user = await createTestUser('export-basic')
        createdUserIds.push(user.id)

        const payload = await exportUserData(user.id)

        expect(payload.exportVersion).toBe('1.0')
        expect(payload.account.email).toBe(user.email)
        expect(payload.consents.length).toBeGreaterThan(0)
        expect(Array.isArray(payload.resumes)).toBe(true)
        expect(Array.isArray(payload.sessions)).toBe(true)
        expect(payload.legalVersion).toBeTruthy()
      })

      it('**绝不包含密码哈希与会话令牌**', async () => {
        const user = await createTestUser('export-nopii')
        createdUserIds.push(user.id)

        const serialized = JSON.stringify(await exportUserData(user.id))

        expect(serialized).not.toContain('scrypt$')
        expect(serialized).not.toContain('passwordHash')
        expect(serialized).not.toContain('password_hash')
        expect(serialized).not.toContain('tokenHash')
        expect(serialized).not.toContain(user.token)
      })

      it('只导出自己的数据（他人的会话不出现在结果里）', async () => {
        const owner = await createTestUser('export-owner')
        const other = await createTestUser('export-other')
        createdUserIds.push(owner.id, other.id)

        const payload = await exportUserData(owner.id)
        const sessionIds = payload.sessions.map((item) => item.id)

        // other 的会话 id 不应出现
        const db = getDb()
        const otherSessions = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.userId, other.id))

        for (const row of otherSessions) {
          expect(sessionIds).not.toContain(row.id)
        }
      })

      it('不存在的用户导出返回 404', async () => {
        await expect(
          exportUserData('00000000-0000-0000-0000-000000000000'),
        ).rejects.toMatchObject({ status: 404 })
      })
    })

    describe('删除账号', () => {
      it('删除后立即无法登录且会话失效', async () => {
        const user = await createTestUser('delete-basic')
        createdUserIds.push(user.id)

        // 删除前可用
        await expect(resolveSessionUser(user.token)).resolves.not.toBeNull()

        const { storage } = fakeStorage()
        const result = await deleteUserAccount(user.id, {}, storage)

        expect(result.deleted).toBe(true)
        // 会话立即失效
        await expect(resolveSessionUser(user.token)).resolves.toBeNull()
        // 无法再登录
        await expect(
          login({ email: user.email, password: TEST_PASSWORD }),
        ).rejects.toBeTruthy()
      })

      it('软删除写入 deleted_at 而非物理删除（保留审计轨迹）', async () => {
        const user = await createTestUser('delete-soft')
        createdUserIds.push(user.id)

        await deleteUserAccount(user.id, {}, fakeStorage().storage)

        const db = getDb()
        const rows = await db.select().from(users).where(eq(users.id, user.id))

        // 记录仍存在，但已软删除
        expect(rows).toHaveLength(1)
        expect(rows[0]!.deletedAt).not.toBeNull()
      })

      it('全部会话被吊销', async () => {
        const user = await createTestUser('delete-sessions')
        createdUserIds.push(user.id)

        // 再登录一次，制造两个会话
        const second = await login({ email: user.email, password: TEST_PASSWORD })

        await deleteUserAccount(user.id, {}, fakeStorage().storage)

        const db = getDb()
        const rows = await db
          .select({ revokedAt: sessions.revokedAt })
          .from(sessions)
          .where(eq(sessions.userId, user.id))

        expect(rows.length).toBeGreaterThanOrEqual(2)
        for (const row of rows) {
          expect(row.revokedAt).not.toBeNull()
        }

        await expect(resolveSessionUser(second.token)).resolves.toBeNull()
      })

      it('调用对象存储清理简历原件', async () => {
        const user = await createTestUser('delete-storage')
        createdUserIds.push(user.id)

        const { storage, deleted } = fakeStorage()
        const result = await deleteUserAccount(user.id, {}, storage)

        // 该用户没有简历时删除数为 0，但方法必须被正常调用不报错
        expect(result.storageObjectsRemoved).toBe(deleted.length)
        expect(result.storageFailures).toBe(0)
      })

      it('对象存储清理失败**不阻断**账号删除', async () => {
        const user = await createTestUser('delete-storage-fail')
        createdUserIds.push(user.id)

        const result = await deleteUserAccount(user.id, {}, failingStorage())

        // 账号删除仍成功（用户意图已生效）
        expect(result.deleted).toBe(true)

        const db = getDb()
        const rows = await db
          .select({ deletedAt: users.deletedAt })
          .from(users)
          .where(and(eq(users.id, user.id), isNull(users.deletedAt)))

        // 已软删除 → 查不到未删除的记录
        expect(rows).toHaveLength(0)
      })

      it('删除后邮箱可被重新注册（部分唯一索引生效）', async () => {
        const user = await createTestUser('delete-reuse')
        createdUserIds.push(user.id)

        await deleteUserAccount(user.id, {}, fakeStorage().storage)

        // 同一邮箱可再次注册（users_email_unique 带 deleted_at IS NULL 条件）
        const { register } = await import('@/lib/services/handlers/auth-service')
        const again = await register({
          email: user.email,
          password: TEST_PASSWORD,
          acceptTerms: true,
        })
        createdUserIds.push(again.user.id)

        expect(again.user.email).toBe(user.email)
      })
    })
  },
)
