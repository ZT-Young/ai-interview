import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { deleteJobJd, getJobJd, updateJobJd } from '@/lib/services/handlers/job-jd-service'
import { updateJobJdSchema } from '@/lib/validators/job-jd'

interface RouteContext {
  params: { id: string }
}

/** GET /api/job-jds/:id */
export const GET = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const jobJd = await getJobJd(user.id, context.params.id)
  return ok({ jobJd })
})

/** PATCH /api/job-jds/:id —— 可修正解析结果 */
export const PATCH = apiHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, updateJobJdSchema)
  const jobJd = await updateJobJd(user.id, context.params.id, input)
  return ok({ jobJd })
})

/** DELETE /api/job-jds/:id —— 软删除 */
export const DELETE = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  await deleteJobJd(user.id, context.params.id)
  return ok({ success: true })
})

export const dynamic = 'force-dynamic'
