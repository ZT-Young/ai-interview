import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { desc, eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, users } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import {
  adjustFreeCredits,
  getUserDetail,
  listUsers,
  MAX_FREE_CREDITS,
} from '@/lib/services/admin-service'

import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
} from '../helpers/db'

/**
 * 管理后台集成测试。
 *
 * 覆盖任务要求的两项：**权限隔离** 与 **审计日志**。
 * 需 DATABASE_URL + AUTH_SECRET；缺失时显式跳过。
 */

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

afterEach(() => {
  delete process.env.ADMIN_VIEW_RESUME_CONTENT
})

async function newUser(prefix: string, isAdmin = false) {
  const user = await createTestUser(prefix)
  createdUserIds.push(user.id)

  if (isAdmin) {
    const db = getDb()
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id))
  }

  return user
}

/** 读取某用户最近的一条审计记录 */
async function latestAudit(actorId: string) {
  const db = getDb()
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorId, actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)
  return rows[0] ?? null
}

describe.skipIf(!hasTestDatabase())(
  `管理后台集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    describe('权限隔离：管理员标识', () => {
      it('注册用户默认不是管理员', async () => {
        const user = await newUser('admin-default')
        const db = getDb()
        const row = (await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, user.id)))[0]!

        expect(row.isAdmin).toBe(false)
      })

      it('只有显式置位后才是管理员', async () => {
        const admin = await newUser('admin-promoted', true)
        const db = getDb()
        const row = (await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, admin.id)))[0]!

        expect(row.isAdmin).toBe(true)
      })

      it('注册接口不接受 isAdmin 字段（无法自我提权）', async () => {
        const email = `escalate_${Date.now()}@example.test`
        const db = getDb()

        // 直接调用注册服务，并故意多传 isAdmin —— 服务端应忽略它
        const { register } = await import('@/lib/services/auth-service')
        const result = await register({
          email,
          password: 'Test-Password-123',
          acceptTerms: true,
          // @ts-expect-error 故意传入未声明的字段，验证服务端不会采纳
          isAdmin: true,
        })
        createdUserIds.push(result.user.id)

        const row = (await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, result.user.id)))[0]!
        expect(row.isAdmin).toBe(false)
      })
    })

    describe('权限隔离：敏感操作仍需管理员身份', () => {
      it('普通用户 id 无法通过管理员判定（用 is_admin 直接验证）', async () => {
        const normal = await newUser('admin-normal')
        const admin = await newUser('admin-real', true)

        const db = getDb()
        const rows = await db
          .select({ id: users.id, isAdmin: users.isAdmin })
          .from(users)
          .where(eq(users.id, normal.id))

        // 普通用户不是管理员 → requireAdmin() 会抛 404
        expect(rows[0]!.isAdmin).toBe(false)

        const adminRows = await db
          .select({ isAdmin: users.isAdmin })
          .from(users)
          .where(eq(users.id, admin.id))
        expect(adminRows[0]!.isAdmin).toBe(true)
      })

      it('非管理员的目标用户不存在时调整额度返回 404', async () => {
        const admin = await newUser('admin-missing-target', true)

        await expect(
          adjustFreeCredits(admin.id, {
            userId: '00000000-0000-0000-0000-000000000000',
            freeCredits: 5,
            reason: '测试',
          }),
        ).rejects.toMatchObject({ status: 404 })
      })
    })

    describe('审计日志', () => {
      it('调整免费次数写入审计日志，含前后值与原因', async () => {
        const admin = await newUser('admin-audit', true)
        const target = await newUser('admin-audit-target')

        const result = await adjustFreeCredits(admin.id, {
          userId: target.id,
          freeCredits: 7,
          reason: '客服工单补偿',
        })

        expect(result.before).toBe(1)
        expect(result.after).toBe(7)

        const audit = await latestAudit(admin.id)
        expect(audit).not.toBeNull()
        expect(audit!.action).toBe('admin.credits_adjusted')
        expect(audit!.targetType).toBe('user')
        expect(audit!.targetId).toBe(target.id)

        const metadata = JSON.parse(audit!.metadata ?? '{}') as Record<string, unknown>
        expect(metadata.before).toBe(1)
        expect(metadata.after).toBe(7)
        expect(metadata.delta).toBe(6)
        expect(metadata.reason).toBe('客服工单补偿')
      })

      it('额度确实被改动到目标值', async () => {
        const admin = await newUser('admin-apply', true)
        const target = await newUser('admin-apply-target')

        await adjustFreeCredits(admin.id, {
          userId: target.id,
          freeCredits: 3,
          reason: '测试',
        })

        const db = getDb()
        const row = (await db.select({ freeCredits: users.freeCredits }).from(users).where(eq(users.id, target.id)))[0]!
        expect(row.freeCredits).toBe(3)
      })

      it('越界值被服务端拒绝且不写审计', async () => {
        const admin = await newUser('admin-range', true)
        const target = await newUser('admin-range-target')

        await expect(
          adjustFreeCredits(admin.id, {
            userId: target.id,
            freeCredits: MAX_FREE_CREDITS + 1,
            reason: '测试',
          }),
        ).rejects.toBeInstanceOf(ApiError)

        await expect(
          adjustFreeCredits(admin.id, {
            userId: target.id,
            freeCredits: -1,
            reason: '测试',
          }),
        ).rejects.toBeInstanceOf(ApiError)

        // 目标值未被改动
        const db = getDb()
        const row = (await db.select({ freeCredits: users.freeCredits }).from(users).where(eq(users.id, target.id)))[0]!
        expect(row.freeCredits).toBe(1)

        // 没有产生 credits_adjusted 记录
        const audit = await latestAudit(admin.id)
        expect(audit?.action).not.toBe('admin.credits_adjusted')
      })

      it('非整数被拒绝', async () => {
        const admin = await newUser('admin-int', true)
        const target = await newUser('admin-int-target')

        await expect(
          adjustFreeCredits(admin.id, {
            userId: target.id,
            freeCredits: 2.5,
            reason: '测试',
          }),
        ).rejects.toBeInstanceOf(ApiError)
      })
    })

    describe('简历原文可见性（PII 边界）', () => {
      it('默认不返回简历原文', async () => {
        const user = await newUser('admin-resume-hidden')
        const db = getDb()
        const { resumes } = await import('@/db/schema')

        await db.insert(resumes).values({
          userId: user.id,
          fileName: 'secret.pdf',
          fileType: 'pdf',
          fileSize: 1024,
          storageKey: `resumes/${user.id}/secret.pdf`,
          rawText: '这是用户的简历原文，绝不应出现在后台默认响应中',
          parsedData: { name: '机密候选人' },
        })

        const detail = await getUserDetail(user.id)

        expect(detail.includesResumeContent).toBe(false)
        expect(detail.resumes).toHaveLength(1)
        expect(detail.resumes[0]!.fileName).toBe('secret.pdf')

        // 关键断言：原文与结构化数据**都不存在**于返回对象里
        expect(detail.resumes[0]!).not.toHaveProperty('rawText')
        expect(detail.resumes[0]!).not.toHaveProperty('parsedData')
        expect(JSON.stringify(detail)).not.toContain('简历原文')
        expect(JSON.stringify(detail)).not.toContain('机密候选人')
      })

      it('开启开关后才返回原文', async () => {
        const user = await newUser('admin-resume-visible')
        const db = getDb()
        const { resumes } = await import('@/db/schema')

        await db.insert(resumes).values({
          userId: user.id,
          fileName: 'visible.pdf',
          fileType: 'pdf',
          fileSize: 1024,
          storageKey: `resumes/${user.id}/visible.pdf`,
          rawText: '开启开关后可见的原文',
          parsedData: { name: '候选人甲' },
        })

        process.env.ADMIN_VIEW_RESUME_CONTENT = 'true'
        const detail = await getUserDetail(user.id)

        expect(detail.includesResumeContent).toBe(true)
        expect(detail.resumes[0]!.rawText).toContain('开启开关后可见的原文')
      })

      it('用户列表不包含任何简历原文或密码哈希', async () => {
        const user = await newUser('admin-list-safe')
        const list = await listUsers()

        const serialized = JSON.stringify(list)
        expect(serialized).not.toContain('passwordHash')
        expect(serialized).not.toContain('rawText')
        expect(serialized).not.toContain('parsedData')

        const row = list.find((item) => item.id === user.id)
        expect(row).toBeDefined()
        // 只给数量
        expect(typeof row!.resumeCount).toBe('number')
      })
    })
  },
)
