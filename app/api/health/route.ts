import { apiHandler, ok } from '@/lib/api/respond'
import { checkDatabase } from '@/db/client'

/**
 * GET /api/health —— 健康检查。
 * 不要求登录；数据库不可用时不抛 500，而是返回 degraded 状态，便于探针区分。
 */
export const GET = apiHandler(async () => {
  const database = await checkDatabase()
  return ok({
    status: database.ok ? 'ok' : 'degraded',
    database: database.ok ? { ok: true } : { ok: false, error: database.error },
    timestamp: new Date().toISOString(),
  })
})

export const dynamic = 'force-dynamic'
