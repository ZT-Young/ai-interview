import { apiHandler, created, ok, parseJsonBody, parsePagination } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { createJobJd, listJobJds } from '@/lib/services/job-jd-service'
import { createJobJdSchema } from '@/lib/validators/job-jd'

/** GET /api/job-jds —— 仅列出当前用户的 JD */
export const GET = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const url = new URL(request.url)
  const page = parsePagination(url.searchParams)

  const { items, total } = await listJobJds(user.id, page)
  return ok({ items, total, limit: page.limit, offset: page.offset })
})

/** POST /api/job-jds —— 粘贴 JD 原文创建 */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, createJobJdSchema)
  const jobJd = await createJobJd(user.id, input)
  return created({ jobJd })
})

export const dynamic = 'force-dynamic'
