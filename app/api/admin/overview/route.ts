import { requireAdmin } from '@/lib/api/admin-guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { getOverview } from '@/lib/services/handlers/admin-service'

/**
 * GET /api/admin/overview —— 后台概览。
 *
 * 非管理员访问返回 **404**（不是 403）：不暴露后台入口是否存在。
 */
export const GET = apiHandler(async () => {
  await requireAdmin()
  const overview = await getOverview()
  return ok(overview)
})

export const dynamic = 'force-dynamic'
