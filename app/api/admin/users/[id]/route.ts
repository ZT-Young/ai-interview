import { requireAdmin } from '@/lib/api/admin-guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { auditResumeContentView, getUserDetail } from '@/lib/services/admin-service'

interface RouteContext {
  params: { id: string }
}

/**
 * GET /api/admin/users/:id —— 用户详情。
 *
 * **PII 边界**：
 * - 默认**不返回**简历原文；只有 `ADMIN_VIEW_RESUME_CONTENT=true` 时才附带
 * - 一旦响应包含原文，**必然写入审计日志**（`admin.resume_content_viewed`）
 */
export const GET = apiHandler(async (_request: Request, context: RouteContext) => {
  const admin = await requireAdmin()
  const detail = await getUserDetail(context.params.id)

  if (detail.includesResumeContent) {
    for (const resume of detail.resumes) {
      await auditResumeContentView(admin.id, context.params.id, resume.id)
    }
  }

  return ok(detail)
})

export const dynamic = 'force-dynamic'
