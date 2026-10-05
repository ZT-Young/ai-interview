import { afterAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, consents, sessions, users } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { resolveSessionUser } from '@/lib/auth/verify-session'
import { deleteAccount, getUserById, login, logout, register, updateProfile } from '@/lib/services/handlers/auth-service'

import {
  createTestPhoneUser,
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
  TEST_PASSWORD,
  uniqueEmail,
  uniquePhone,
} from '../helpers/db'

const createdUserIds: string[] = []

/** 断言异步调用以指定 HTTP 状态码失败（比 toMatchObject 更稳，不受 Error 属性可枚举性影响） */
async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise
    throw new Error('应当抛错但没有抛')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(status)
  }
}

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

describe.skipIf(!hasTestDatabase())(
  `认证集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()})`,
  () => {
    describe('注册', () => {
      it('创建用户、同意记录、会话与审计日志', async () => {
        const email = uniqueEmail('register')
        const result = await register({
          channel: 'email',
          email: email.toUpperCase(),
          password: TEST_PASSWORD,
          acceptTerms: true,
        })
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
          await register({
            channel: 'email',
            email: created.email,
            password: TEST_PASSWORD,
            acceptTerms: true,
          })
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
          register({
            channel: 'email',
            email: created.email,
            password: TEST_PASSWORD,
            acceptTerms: true,
          }),
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

        const result = await login({
          mode: 'password',
          identifier: created.email,
          password: TEST_PASSWORD,
        })
        expect(result.user.id).toBe(created.id)
        expect(result.token).not.toBe(created.token)

        // 两个会话都应有效（多端登录）
        await expect(resolveSessionUser(created.token)).resolves.not.toBeNull()
        await expect(resolveSessionUser(result.token)).resolves.not.toBeNull()
      })

      it('邮箱大小写不敏感', async () => {
        const created = await createTestUser('case')
        createdUserIds.push(created.id)

        const result = await login({
          mode: 'password',
          identifier: created.email.toUpperCase(),
          password: TEST_PASSWORD,
        })
        expect(result.user.id).toBe(created.id)
      })

      it('密码错误抛 401 且提示不区分账号是否存在', async () => {
        const created = await createTestUser('wrongpw')
        createdUserIds.push(created.id)

        let wrongPasswordMessage = ''
        let unknownAccountMessage = ''

        try {
          await login({
            mode: 'password',
            identifier: created.email,
            password: 'Wrong-Password-999',
          })
        } catch (error) {
          expect((error as ApiError).status).toBe(401)
          wrongPasswordMessage = (error as ApiError).message
        }

        try {
          await login({
            mode: 'password',
            identifier: uniqueEmail('ghost'),
            password: 'Wrong-Password-999',
          })
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
        await login({ mode: 'password', identifier: created.email, password: TEST_PASSWORD })

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
        const second = await login({
          mode: 'password',
          identifier: created.email,
          password: TEST_PASSWORD,
        })

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
          login({ mode: 'password', identifier: created.email, password: TEST_PASSWORD }),
        ).rejects.toBeInstanceOf(ApiError)
        await expect(getUserById(created.id)).rejects.toBeInstanceOf(ApiError)
      })
    })

    describe('手机号注册与多标识登录', () => {
      it('手机号注册：默认用户名为「用户 + 尾号四位」，且未设密码、手机号已验证', async () => {
        const created = await createTestPhoneUser()
        createdUserIds.push(created.id)

        expect(created.username).toBe(`用户${created.phone.slice(-4)}`)

        const db = getDb()
        const rows = await db.select().from(users).where(eq(users.id, created.id))
        // 手机号通道未设密码 → 只能用验证码登录
        expect(rows[0]!.passwordHash).toBeNull()
        expect(rows[0]!.phoneVerifiedAt).not.toBeNull()
      })

      it('邮箱注册：默认用户名为「用户 + 随机四位」', async () => {
        const created = await createTestUser('defaultname')
        createdUserIds.push(created.id)

        const user = await getUserById(created.id)
        expect(user.username).toMatch(/^用户\d{4}$/)
      })

      it('可用用户名登录', async () => {
        const created = await createTestUser('login-by-username')
        createdUserIds.push(created.id)
        const user = await getUserById(created.id)

        const result = await login({
          mode: 'password',
          identifier: user.username!,
          password: TEST_PASSWORD,
        })
        expect(result.user.id).toBe(created.id)
      })

      it('手机号 + 验证码登录（演示固定码 8888）', async () => {
        const created = await createTestPhoneUser()
        createdUserIds.push(created.id)

        const result = await login({ mode: 'code', identifier: created.phone, code: '8888' })
        expect(result.user.id).toBe(created.id)
      })

      it('手机号 + 密码登录（注册时设置了密码）', async () => {
        const phone = uniquePhone()
        const result = await register({
          channel: 'phone',
          phone,
          code: '8888',
          password: TEST_PASSWORD,
          acceptTerms: true,
        })
        createdUserIds.push(result.user.id)

        const loggedIn = await login({
          mode: 'password',
          identifier: phone,
          password: TEST_PASSWORD,
        })
        expect(loggedIn.user.id).toBe(result.user.id)
      })

      it('错误验证码登录抛 401', async () => {
        const created = await createTestPhoneUser()
        createdUserIds.push(created.id)

        await expectStatus(
          login({ mode: 'code', identifier: created.phone, code: '0000' }),
          401,
        )
      })

      it('验证码登录仅限手机号：邮箱与用户名一律 401', async () => {
        const created = await createTestUser('code-mode-email')
        createdUserIds.push(created.id)
        const user = await getUserById(created.id)

        // 邮箱
        try {
          await login({ mode: 'code', identifier: created.email, code: '8888' })
          throw new Error('邮箱 + 验证码不应登录成功')
        } catch (error) {
          expect((error as ApiError).message).toBe('验证码登录请使用手机号')
        }

        // 用户名
        try {
          await login({ mode: 'code', identifier: user.username!, code: '8888' })
          throw new Error('用户名 + 验证码不应登录成功')
        } catch (error) {
          expect((error as ApiError).message).toBe('验证码登录请使用手机号')
        }
      })

      it('未设密码的手机号账号用密码登录失败，提示与「账号不存在」完全一致（防账号枚举）', async () => {
        const created = await createTestPhoneUser()
        createdUserIds.push(created.id)

        let noPasswordMessage = ''
        let unknownAccountMessage = ''

        try {
          await login({
            mode: 'password',
            identifier: created.phone,
            password: TEST_PASSWORD,
          })
        } catch (error) {
          noPasswordMessage = (error as ApiError).message
        }

        try {
          await login({
            mode: 'password',
            identifier: uniqueEmail('ghost-nopassword'),
            password: TEST_PASSWORD,
          })
        } catch (error) {
          unknownAccountMessage = (error as ApiError).message
        }

        expect(noPasswordMessage).toBe(unknownAccountMessage)
      })

      it('用户名被占用时更新资料抛 409', async () => {
        const first = await createTestUser('dupname-a')
        const second = await createTestUser('dupname-b')
        createdUserIds.push(first.id, second.id)

        const firstUser = await getUserById(first.id)
        await expectStatus(updateProfile(second.id, { username: firstUser.username! }), 409)
      })

      it('手机号被占用时注册抛 409', async () => {
        const created = await createTestPhoneUser()
        createdUserIds.push(created.id)

        await expectStatus(
          register({ channel: 'phone', phone: created.phone, code: '8888', acceptTerms: true }),
          409,
        )
      })

      it('改名后可用新用户名登录', async () => {
        const created = await createTestUser('rename-login')
        createdUserIds.push(created.id)

        const updated = await updateProfile(created.id, { username: '面试小能手' })
        expect(updated.username).toBe('面试小能手')

        const result = await login({
          mode: 'password',
          identifier: '面试小能手',
          password: TEST_PASSWORD,
        })
        expect(result.user.id).toBe(created.id)
      })
    })

    describe('身份：面试者与面试官', () => {
      it('注册不传 role 时默认为面试者', async () => {
        const created = await createTestUser('role-default')
        createdUserIds.push(created.id)
        expect(created.role).toBe('candidate')
      })

      it('注册时选面试官 → 账号身份为面试官', async () => {
        const email = uniqueEmail('role-iv')
        const result = await register({
          channel: 'email',
          email,
          password: TEST_PASSWORD,
          role: 'interviewer',
          acceptTerms: true,
        })
        createdUserIds.push(result.user.id)
        expect(result.user.role).toBe('interviewer')
      })

      it('登录时选的身份与账号当前身份不一致 → 顺带切换，且数据不丢', async () => {
        const created = await createTestUser('role-switch')
        createdUserIds.push(created.id)
        expect(created.role).toBe('candidate')

        const asInterviewer = await login({
          mode: 'password',
          identifier: created.email,
          password: TEST_PASSWORD,
          role: 'interviewer',
        })
        expect(asInterviewer.user.role).toBe('interviewer')

        // 切回去仍可正常登录，且是同一个账号（身份只是单值列，不是两个账号）
        const asCandidate = await login({
          mode: 'password',
          identifier: created.email,
          password: TEST_PASSWORD,
          role: 'candidate',
        })
        expect(asCandidate.user.id).toBe(created.id)
        expect(asCandidate.user.role).toBe('candidate')
      })

      it('登录不传 role 时不改变已有身份（向后兼容老客户端）', async () => {
        const email = uniqueEmail('role-keep')
        const registered = await register({
          channel: 'email',
          email,
          password: TEST_PASSWORD,
          role: 'interviewer',
          acceptTerms: true,
        })
        createdUserIds.push(registered.user.id)

        const result = await login({
          mode: 'password',
          identifier: email,
          password: TEST_PASSWORD,
        })
        expect(result.user.role).toBe('interviewer')
      })

      it('更新资料可切换身份', async () => {
        const created = await createTestUser('role-update')
        createdUserIds.push(created.id)

        const updated = await updateProfile(created.id, { role: 'interviewer' })
        expect(updated.role).toBe('interviewer')

        const back = await updateProfile(created.id, { role: 'candidate' })
        expect(back.role).toBe('candidate')
      })
    })
  },
)
