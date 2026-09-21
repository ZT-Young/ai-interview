import { NextResponse } from 'next/server'

import { apiHandler, created, ok, parseJsonBody, parsePagination } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { createResume, listResumes } from '@/lib/services/resume-service'
import { createResumeSchema } from '@/lib/validators/resume'

/** GET /api/resumes —— 仅列出当前用户的简历 */
export const GET = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const url = new URL(request.url)
  const page = parsePagination(url.searchParams)

  const { items, total } = await listResumes(user.id, page)
  return ok({ items, total, limit: page.limit, offset: page.offset })
})

/** POST /api/resumes —— 创建简历记录（文件上传在 Phase 2 接入 S3） */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, createResumeSchema)
  const resume = await createResume(user.id, input)
  return created({ resume })
})

export const dynamic = 'force-dynamic'

export function PUT(): NextResponse {
  return NextResponse.json(
    { error: { code: 'not_found', message: '请使用 POST /api/resumes 或 PATCH /api/resumes/:id' } },
    { status: 405 },
  )
}
