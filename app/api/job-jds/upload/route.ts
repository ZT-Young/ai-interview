import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok } from '@/lib/api/respond'
import {
  errorResponse,
  isUploadError,
  readUploadedFile,
  uploadAndParse,
} from '@/lib/services/upload-service'

/**
 * POST /api/job-jds/upload —— 上传 JD 图片并解析（视觉模型直读）。
 * 失败语义与简历上传一致，见该路由注释。
 */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return errorResponse({
      status: 422,
      code: 'validation_error',
      message: '请求格式不正确，需使用 multipart/form-data 上传文件',
    })
  }

  const parsedFile = readUploadedFile(form)
  if (isUploadError(parsedFile)) return errorResponse(parsedFile)

  const outcome = await uploadAndParse(user.id, 'job_jd', parsedFile)
  if (isUploadError(outcome)) return errorResponse(outcome)

  return ok({
    jobJd: outcome.resource,
    parse: { status: outcome.status, error: outcome.parseError ?? null },
  })
})

export const dynamic = 'force-dynamic'
