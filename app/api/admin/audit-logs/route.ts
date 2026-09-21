import { requireAdmin } from '@/lib/api/admin-guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { listAuditLogs } from '@/lib/services/admin-service'

/**
 * GET /api/admin/audit-logs —— 审计日志（只读）。
 *
 * **刻意不提供删除/修改接口**：审计日志只增不改（AGENTS.md §7 C6）。
 */
export const GET = apiHandler(async () => {
  await requireAdmin()
  const logs = await listAuditLogs()
  return ok({ logs, total: logs.length })
})

export const dynamic = 'force-dynamic'
