import { requireAdmin } from '@/lib/api/admin-guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { listUsers } from '@/lib/services/handlers/admin-service'

/**
 * GET /api/admin/users —— 用户列表。
 *
 * 不返回简历原文（`raw_text` / `parsed_data`），也不返回密码哈希。
 * 只给简历与会话的**数量**，便于运营判断活跃度。
 */
export const GET = apiHandler(async () => {
  await requireAdmin()
  const users = await listUsers()
  return ok({ users, total: users.length })
})

export const dynamic = 'force-dynamic'
