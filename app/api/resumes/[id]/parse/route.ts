import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { getResume, updateParseState } from '@/lib/services/handlers/resume-service'
import { parseResumeFile } from '@/lib/services/handlers/parse-service'
import { errorResponse, resolvePorts } from '@/lib/services/handlers/upload-service'
import { mimeTypeOf } from '@/lib/parsing/extract'

interface RouteContext {
  params: { id: string }
}

/**
 * POST /api/resumes/:id/parse —— 对已上传的简历重新解析。
 *
 * 用于用户在确认页点击「重新解析」；失败时保留已有内容并记录 parse_error。
 * 归属校验由 getResume 完成（他人资源返回 404）。
 */
export const POST = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const resume = await getResume(user.id, context.params.id)

  const parsed = await parseResumeFile(resolvePorts(), {
    storageKey: resume.storageKey,
    fileName: resume.fileName,
    mimeType: mimeTypeOf(resume.fileName),
  })

  if (parsed.ok) {
    const updated = await updateParseState(user.id, resume.id, {
      parseStatus: 'success',
      parsedData: parsed.data,
      parseError: null,
      extractionMeta: { ...parsed.meta, model: parsed.model, dropped: parsed.dropped },
    })
    return ok({ resume: updated, parse: { status: 'success', meta: parsed.meta } })
  }

  const failed = await updateParseState(user.id, resume.id, {
    parseStatus: 'failed',
    parseError: parsed.error.userMessage,
    extractionMeta: { ...parsed.meta, dropped: parsed.dropped },
  })

  /**
   * 环境级失败（未配置 LLM）用 503 明确告知——这是「重试也不会好」的情况，
   * 需要用户去改配置，而不是反复点重试。
   *
   * ⚠️ 但**必须先落库 parse_error**（上面已做）：
   * 早期实现在这个分支直接 return，不写 parse_error，
   * 于是确认页显示「待确认」却没有任何失败原因，用户无从判断该做什么；
   * 而同一件事在 200 分支却会写 parse_error，同一语义两种记录方式。
   */
  if (parsed.code === 'ai_unavailable' || parsed.code === 'not_in_scope') {
    return errorResponse({
      status: 503,
      code: 'parse_unavailable',
      message: parsed.error.userMessage,
    })
  }

  return ok({ resume: failed, parse: { status: 'failed', error: parsed.error.userMessage } })
})

export const dynamic = 'force-dynamic'
