import { afterAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, consents, sessions, users } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { resolveSessionUser } from '@/lib/auth/verify-session'
import { deleteAccount, getUserById, login, logout, register, updateProfile } from '@/lib/services/handlers/auth-service'

import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
  TEST_PASSWORD,
  uniqueEmail,
} from '../helpers/db'

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

describe.skipIf(!hasTestDatabase())(
  `认证集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()})`,
  () => {
    describe('注册', () => {
      it('创建用户、同意记录、会话与审计日志', async () => {
        const email = uniqueEmail('register')
        const result = await register({ email: email.toUpperCase(), password: TEST_PASSWORD, acceptTerms: true })
        createdUserIds.push(result.user.id)

        // 邮箱被规范化为小写
        expect(result.user.email).toBe(email.toLowerCase())
        expect(result.user.freeCredits).toBe(1)
        expect(result.user.membership).toBe('free')
        expect(result.token).toBeTruthy()

        const db = getDb()

        const consentRows = await db
          .select()
          .from(consents)
          .where(eq(consents.userId, result.user.id))
        expect(consentRows.map((row) => row.consentType).sort()).toEqual([
          'ai_disclosure',
          'privacy',
          'terms',
        ])

        const sessionRows = await db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, result.user.id))
        expect(sessionRows).toHaveLength(1)
        // 数据库里只存哈希，绝不存明文令牌
        expect(sessionRows[0]!.tokenHash).not.toBe(result.token)

        const auditRows = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.actorId, result.user.id), eq(auditLogs.action, 'auth.register')))
        expect(auditRows).toHaveLength(1)
      })

      it('注册即可用返回的令牌通过会话校验', async () => {
        const created = await createTestUser('autologin')
        createdUserIds.push(created.id)

        const user = await resolveSessionUser(created.token)
        expect(user?.id).toBe(created.id)
        expect(user?.email).toBe(created.email)
      })

      it('同一邮箱重复注册抛 409', async () => {
        const created = await createTestUser('dup')
        createdUserIds.push(created.id)

        try {
          await register({ email: created.email, password: TEST_PASSWORD, acceptTerms: true })
          throw new Error('应当抛错')
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError)
          expect((error as ApiError).status).toBe(409)
        }
      })

      it('重复注册不会残留半成品用户（事务回滚）', async () => {
        const created = await createTestUser('rollback')
        createdUserIds.push(created.id)

        await expect(
          register({ email: created.email, password: TEST_PASSWORD, acceptTerms: true }),
        ).rejects.toThrow()

        const db = getDb()
        const rows = await db.select().from(users).where(eq(users.email, created.email))
        expect(rows).toHaveLength(1)
      })
    })

    describe('登录', () => {
      it('正确凭证登录成功并返回新令牌', async () => {
        const created = await createTestUser('login')
        createdUserIds.push(created.id)

        const result = await login({ email: created.email, password: TEST_PASSWORD })
        expect(result.user.id).toBe(created.id)
        expect(result.token).not.toBe(created.token)

        // 两个会话都应有效（多端登录）
        await expect(resolveSessionUser(created.token)).resolves.not.toBeNull()
        await expect(resolveSessionUser(result.token)).resolves.not.toBeNull()
      })

      it('邮箱大小写不敏感', async () => {
        const created = await createTestUser('case')
        createdUserIds.push(created.id)

        const result = await login({ email: created.email.toUpperCase(), password: TEST_PASSWORD })
        expect(result.user.id).toBe(created.id)
      })

      it('密码错误抛 401 且提示不区分账号是否存在', async () => {
        const created = await createTestUser('wrongpw')
        createdUserIds.push(created.id)

        let wrongPasswordMessage = ''
        let unknownAccountMessage = ''

        try {
          await login({ email: created.email, password: 'Wrong-Password-999' })
        } catch (error) {
          expect((error as ApiError).status).toBe(401)
          wrongPasswordMessage = (error as ApiError).message
        }

        try {
          await login({ email: uniqueEmail('ghost'), password: 'Wrong-Password-999' })
        } catch (error) {
          expect((error as ApiError).status).toBe(401)
          unknownAccountMessage = (error as ApiError).message
        }

        // 防账号枚举：两种情况提示完全一致
        expect(wrongPasswordMessage).toBe(unknownAccountMessage)
        expect(wrongPasswordMessage).not.toMatch(/不存在|未注册/)
      })

      it('登录写入审计日志', async () => {
        const created = await createTestUser('audit')
        createdUserIds.push(created.id)
        await login({ email: created.email, password: TEST_PASSWORD })

        const db = getDb()
        const rows = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.actorId, created.id), eq(auditLogs.action, 'auth.login')))
        expect(rows.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('会话管理', () => {
      it('无效令牌返回 null', async () => {
        await expect(resolveSessionUser('not-a-real-token')).resolves.toBeNull()
        await expect(resolveSessionUser(undefined)).resolves.toBeNull()
      })

      it('退出登录后令牌立即失效（非 JWT 的关键收益）', async () => {
        const created = await createTestUser('logout')
        createdUserIds.push(created.id)

        await expect(resolveSessionUser(created.token)).resolves.not.toBeNull()
        await logout(created.token)
        await expect(resolveSessionUser(created.token)).resolves.toBeNull()
      })

      it('退出登录幂等：重复退出与无令牌都不报错', async () => {
        const created = await createTestUser('logout-idem')
        createdUserIds.push(created.id)

        await logout(created.token)
        await expect(logout(created.token)).resolves.toBeUndefined()
        await expect(logout(undefined)).resolves.toBeUndefined()
      })

      it('退出只影响当前会话，其他设备仍在线', async () => {
        const created = await createTestUser('multi')
        createdUserIds.push(created.id)
        const second = await login({ email: created.email, password: TEST_PASSWORD })

        await logout(created.token)

        await expect(resolveSessionUser(created.token)).resolves.toBeNull()
        await expect(resolveSessionUser(second.token)).resolves.not.toBeNull()
      })

      it('过期会话不可用', async () => {
        const created = await createTestUser('expired')
        createdUserIds.push(created.id)

        const db = getDb()
        // 必须把 createdAt 一起往前挪：表上有 CHECK (expires_at > created_at)
        // （db/schema/sessions.ts），只改 expires_at 会被约束正当拒绝。
        // 这条约束是有意保留的——它能防住「一建出来就已过期」的会话。
        const expiresAt = new Date(Date.now() - 1000)
        await db
          .update(sessions)
          .set({ expiresAt, createdAt: new Date(expiresAt.getTime() - 60_000) })
          .where(eq(sessions.userId, created.id))

        await expect(resolveSessionUser(created.token)).resolves.toBeNull()
      })
    })

    describe('用户资料与删除', () => {
      it('getUserById 返回不含密码哈希的视图', async () => {
        const created = await createTestUser('profile')
        createdUserIds.push(created.id)

        const user = await getUserById(created.id)
        expect(JSON.stringify(user)).not.toContain('scrypt$')
        expect(user.email).toBe(created.email)
      })

      it('更新昵称', async () => {
        const created = await createTestUser('rename')
        createdUserIds.push(created.id)

        const updated = await updateProfile(created.id, { name: '新昵称' })
        expect(updated.name).toBe('新昵称')
      })

      it('删除账号后会话全部失效且无法再登录', async () => {
        const created = await createTestUser('delete')
        createdUserIds.push(created.id)

        await deleteAccount(created.id)

        await expect(resolveSessionUser(created.token)).resolves.toBeNull()
        await expect(
          login({ email: created.email, password: TEST_PASSWORD }),
        ).rejects.toBeInstanceOf(ApiError)
        await expect(getUserById(created.id)).rejects.toBeInstanceOf(ApiError)
      })
    })
  },
)
