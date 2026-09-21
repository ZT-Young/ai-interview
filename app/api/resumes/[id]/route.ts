import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { deleteResume, getResume, updateResume } from '@/lib/services/resume-service'
import { updateResumeSchema } from '@/lib/validators/resume'

interface RouteContext {
  params: { id: string }
}

/** GET /api/resumes/:id —— 仅能读取自己的简历，否则 404 */
export const GET = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const resume = await getResume(user.id, context.params.id)
  return ok({ resume })
})

/** PATCH /api/resumes/:id —— 可修改解析结果（AGENTS.md §2 第 4 步：允许用户修改） */
export const PATCH = apiHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, updateResumeSchema)
  const resume = await updateResume(user.id, context.params.id, input)
  return ok({ resume })
})

/** DELETE /api/resumes/:id —— 软删除 */
export const DELETE = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  await deleteResume(user.id, context.params.id)
  return ok({ success: true })
})

export const dynamic = 'force-dynamic'
