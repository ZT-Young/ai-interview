import { requireAdmin } from '@/lib/api/admin-guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { listSessions } from '@/lib/services/handlers/admin-service'

/** GET /api/admin/sessions —— 全部面试会话概览（跨用户，仅管理员可见） */
export const GET = apiHandler(async () => {
  await requireAdmin()
  const sessions = await listSessions()
  return ok({ sessions, total: sessions.length })
})

export const dynamic = 'force-dynamic'
