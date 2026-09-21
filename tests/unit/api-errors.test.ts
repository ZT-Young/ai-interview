import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from '@/db/schema'
import { jobJds, resumes } from '@/db/schema'
import { ApiError, conflict, errorResponse, notFound, unauthorized } from '@/lib/api/errors'
import { ownedBy, ownedByActive } from '@/lib/api/ownership'

import { hasTestDatabase, missingTestEnvReason } from '../helpers/db'

describe('API 错误契约', () => {
  it('notFound 映射为 404', () => {
    expect(notFound().status).toBe(404)
    expect(notFound().code).toBe('not_found')
  })

  it('unauthorized 映射为 401', () => {
    expect(unauthorized().status).toBe(401)
  })

  it('conflict 映射为 409', () => {
    expect(conflict('邮箱已注册').status).toBe(409)
  })

  it('errorResponse 输出统一结构', async () => {
    const response = errorResponse(notFound('简历不存在'))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('not_found')
    expect(body.error.message).toBe('简历不存在')
  })

  it('未知异常收敛为 500 且不泄露内部细节', async () => {
    const response = errorResponse(new Error('数据库连接串 postgres://secret@host/db 失败'))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('internal_error')
    expect(body.error.message).not.toContain('secret')
    expect(body.error.message).toBe('服务器内部错误')
  })

  it('ApiError 实例可被识别', () => {
    expect(notFound() instanceof ApiError).toBe(true)
  })
})

/**
 * 归属过滤 SQL 断言。
 *
 * 需要编译真实查询，因此依赖 DATABASE_URL；缺失时显式跳过而非伪装通过。
 * 这些断言的价值：证明 ownedBy / ownedByActive 生成的 SQL **确实同时包含**
 * id 与 user_id 条件 —— 这是权限隔离的最后一道保险。
 */
describe.skipIf(!hasTestDatabase())(
  `归属过滤 SQL（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    const db = drizzle(postgres(process.env.DATABASE_URL!, { max: 1, prepare: false }), { schema })

    it('ownedBy 同时包含 id 与 user_id 条件', () => {
      const query = db.select().from(resumes).where(ownedBy(resumes, 'resume-id', 'user-id')).toSQL()
      expect(query.sql).toContain('"resumes"."id"')
      expect(query.sql).toContain('"resumes"."user_id"')
      expect(query.params).toContain('user-id')
    })

    it('ownedByActive 额外排除软删除记录', () => {
      const query = db
        .select()
        .from(jobJds)
        .where(ownedByActive(jobJds, 'jd-id', 'user-id'))
        .toSQL()
      expect(query.sql).toContain('"job_jds"."id"')
      expect(query.sql).toContain('"job_jds"."user_id"')
      expect(query.sql).toContain('"job_jds"."deleted_at" is null')
    })

    it('不同用户生成的查询参数不同（无法跨用户命中同一行）', () => {
      const asUserA = db
        .select()
        .from(resumes)
        .where(ownedByActive(resumes, 'same-id', 'user-a'))
        .toSQL()
      const asUserB = db
        .select()
        .from(resumes)
        .where(ownedByActive(resumes, 'same-id', 'user-b'))
        .toSQL()

      expect(asUserA.params).toContain('user-a')
      expect(asUserB.params).toContain('user-b')
      expect(asUserA.params).not.toEqual(asUserB.params)
    })
  },
)
