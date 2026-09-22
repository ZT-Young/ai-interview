import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok } from '@/lib/api/respond'
import {
  errorResponse,
  isUploadError,
  readUploadedFile,
  uploadAndParse,
} from '@/lib/services/handlers/upload-service'

/**
 * POST /api/resumes/upload —— 上传简历（PDF / Word / 图片）并立即解析。
 *
 * 解析失败仍返回 200 且 `parse.status = 'failed'`：
 * 失败是业务结果，前端需据此提示用户手动修改（AGENTS.md §2 第 4 步）。
 * 存储或 AI 未配置等**环境级**失败返回 503，且不留下脏记录。
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

  const outcome = await uploadAndParse(user.id, 'resume', {
    ...parsedFile,
    isPrimary: form.get('isPrimary') === 'true',
  })

  if (isUploadError(outcome)) return errorResponse(outcome)

  return ok({
    resume: outcome.resource,
    parse: { status: outcome.status, error: outcome.parseError ?? null },
  })
})

export const dynamic = 'force-dynamic'
