import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { sessions, users as usersTable } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { hashSessionToken } from '@/lib/auth/session'
import {
  resolveAdminSessionUser,
  resolveSessionUser,
} from '@/lib/auth/verify-session'
import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  TEST_PASSWORD,
  uniqueEmail,
} from '../helpers/db'
import { login, loginAdmin, register } from '@/lib/services/handlers/auth-service'

/**
 * 用户端与管理端**会话分离**的集成测试。
 *
 * 要证明的是：两端各有各的会话，互不相认。
 * 只靠「两个 Cookie 名」是不够的（Cookie 名客户端可改），
 * 真正的判定在 `sessions.kind`，因此这里直接测解析层。
 */

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

/** 造一个管理员账号（is_admin 只能改库，系统无自我提权接口） */
async function newAdmin(prefix: string) {
  const user = await createTestUser(prefix)
  createdUserIds.push(user.id)
  const db = getDb()
  await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.id, user.id))
  return user
}

describe('用户端与管理端会话分离', () => {
  it('管理端登录产出 kind=admin 的会话，用户端产出 kind=user', async () => {
    const admin = await newAdmin('sep-admin')
    const normal = await createTestUser('sep-normal')
    createdUserIds.push(normal.id)

    const adminLogin = await loginAdmin({
      mode: 'password',
      identifier: admin.email,
      password: TEST_PASSWORD,
    })
    const userLogin = await login({
      mode: 'password',
      identifier: normal.email,
      password: TEST_PASSWORD,
    })

    expect(await kindOf(adminLogin.token)).toBe('admin')
    expect(await kindOf(userLogin.token)).toBe('user')
  })

  it('用户端会话进不了管理端（哪怕账号 is_admin 为 true）', async () => {
    const admin = await newAdmin('sep-cross')
    const viaUserSide = await login({
      mode: 'password',
      identifier: admin.email,
      password: TEST_PASSWORD,
    })

    // 同一条会话：用户端认，管理端不认
    expect(await resolveSessionUser(viaUserSide.token, 'user')).not.toBeNull()
    expect(await resolveAdminSessionUser(viaUserSide.token)).toBeNull()
  })

  it('管理端会话不被用户端接口接受', async () => {
    const admin = await newAdmin('sep-cross2')
    const viaAdminSide = await loginAdmin({
      mode: 'password',
      identifier: admin.email,
      password: TEST_PASSWORD,
    })

    expect(await resolveAdminSessionUser(viaAdminSide.token)).not.toBeNull()
    // 反向：拿管理端会话去刷用户端接口也不行
    expect(await resolveSessionUser(viaAdminSide.token, 'user')).toBeNull()
  })

  it('非管理员登录管理端：抛错且文案与密码错误一致（防账号枚举）', async () => {
    const normal = await createTestUser('sep-not-admin')
    createdUserIds.push(normal.id)

    let notAdminMessage = ''
    try {
      await loginAdmin({
        mode: 'password',
        identifier: normal.email,
        password: TEST_PASSWORD,
      })
    } catch (error) {
      notAdminMessage = (error as ApiError).message
    }

    let wrongPasswordMessage = ''
    try {
      await loginAdmin({
        mode: 'password',
        identifier: normal.email,
        password: 'Wrong-Password-999',
      })
    } catch (error) {
      wrongPasswordMessage = (error as ApiError).message
    }

    expect(notAdminMessage).toBe('账号或密码不正确')
    expect(notAdminMessage).toBe(wrongPasswordMessage)
  })

  it('非管理员登录管理端时，过程中产生的用户端会话已被撤销', async () => {
    const normal = await createTestUser('sep-revoke')
    createdUserIds.push(normal.id)
    const db = getDb()

    // 注册时本身就建了一条会话，先全部吊销，才能干净地观察本次登录的残留
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, normal.id))

    try {
      await loginAdmin({
        mode: 'password',
        identifier: normal.email,
        password: TEST_PASSWORD,
      })
    } catch {
      // 预期失败
    }

    // 失败路径不该留下任何可用会话：否则「非管理员登录后台」会顺带变成一次正常登录
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, normal.id), isNull(sessions.revokedAt)))
    expect(rows).toHaveLength(0)
  })

  it('权限被回收后已存在的管理端会话立即失效', async () => {
    const admin = await newAdmin('sep-demote')
    const result = await loginAdmin({
      mode: 'password',
      identifier: admin.email,
      password: TEST_PASSWORD,
    })
    expect(await resolveAdminSessionUser(result.token)).not.toBeNull()

    const db = getDb()
    await db.update(usersTable).set({ isAdmin: false }).where(eq(usersTable.id, admin.id))

    expect(await resolveAdminSessionUser(result.token)).toBeNull()
  })

  it('注册永远不产生管理端会话', async () => {
    const email = uniqueEmail('sep-register')
    const result = await register({
      channel: 'email',
      email,
      password: TEST_PASSWORD,
      acceptTerms: true,
    })
    createdUserIds.push(result.user.id)

    expect(await kindOf(result.token)).toBe('user')
  })
})

/** 查某条会话属于哪一端 */
async function kindOf(token: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({ kind: sessions.kind })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1)
  return rows[0]?.kind ?? null
}
