import { apiHandler } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { auditDataExport, exportUserData } from '@/lib/services/data-rights-service'

/**
 * GET /api/auth/me/data-export —— 导出当前用户的全部数据（JSON 下载）。
 *
 * 安全要点：
 * - 只导出**当前登录用户**自己的数据（`requireUser()` 决定 userId，不接受任何参数）
 * - **不含** passwordHash / 会话令牌
 * - 每次导出写入审计日志（`user.data_exported`）
 */
export const GET = apiHandler(async () => {
  const user = await requireUser()
  const payload = await exportUserData(user.id)

  // 先记审计再返回；审计失败不应阻断用户行使权利，故不 await 失败
  await auditDataExport(user.id).catch(() => undefined)

  const body = JSON.stringify(payload, null, 2)

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 触发浏览器下载
      'content-disposition': `attachment; filename="ai-interview-data-export-${user.id.slice(0, 8)}.json"`,
      // 导出内容含个人信息，禁止任何中间层缓存
      'cache-control': 'no-store, private',
    },
  })
})

export const dynamic = 'force-dynamic'
