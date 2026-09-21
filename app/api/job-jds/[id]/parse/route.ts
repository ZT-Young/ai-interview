import { requireUser } from '@/lib/api/guard'
import { errorResponse } from '@/lib/api/errors'
import { apiHandler, ok } from '@/lib/api/respond'
import { getJobJd, updateParseState } from '@/lib/services/job-jd-service'
import { parseJdText } from '@/lib/services/parse-service'
import { resolvePorts } from '@/lib/services/upload-service'

interface RouteContext {
  params: { id: string }
}

/**
 * POST /api/job-jds/:id/parse —— 对已存在的 JD 重新解析。
 *
 * 用于确认页点击「重新解析」：
 * - 粘贴型 JD：直接用库里的 `rawText` 重跑模型（无需存储）
 * - 图片型 JD：走存储重新抽取文字后解析
 *
 * 归属校验由 `getJobJd` 完成（他人资源返回 404）。
 */
export const POST = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const jobJd = await getJobJd(user.id, context.params.id)

  const rawText = jobJd.rawText?.trim() ?? ''
  if (rawText.length < 10) {
    // 没有可用原文（例如图片型 JD 还没抽到文字）→ 明确告知，不要假装成功
    const updated = await updateParseState(user.id, jobJd.id, {
      parseStatus: 'failed',
      parsedData: null,
      parseError: '该 JD 没有可用的原文，无法重新解析。请重新粘贴 JD 文本或上传图片。',
    })
    return ok({ jobJd: updated, parse: { status: 'failed', error: updated.parseError } })
  }

  const parsed = await parseJdText(resolvePorts(), rawText)

  if (parsed.ok) {
    const updated = await updateParseState(user.id, jobJd.id, {
      parseStatus: 'success',
      parsedData: parsed.data,
      title: parsed.data.title || null,
      company: parsed.data.company || null,
      parseError: null,
      extractionMeta: { ...parsed.meta, model: parsed.model, dropped: parsed.dropped },
    })
    return ok({ jobJd: updated, parse: { status: 'success', meta: parsed.meta } })
  }

  // 无论哪种失败都先落库 parse_error，保证「待确认」状态下用户能看到原因
  const failed = await updateParseState(user.id, jobJd.id, {
    parseStatus: 'failed',
    parsedData: null,
    parseError: parsed.error.userMessage,
    extractionMeta: { ...parsed.meta, dropped: parsed.dropped },
  })

  if (parsed.code === 'ai_unavailable' || parsed.code === 'not_in_scope') {
    return errorResponse({
      status: 503,
      code: 'parse_unavailable',
      message: parsed.error.userMessage,
    })
  }

  return ok({ jobJd: failed, parse: { status: 'failed', error: parsed.error.userMessage } })
})

export const dynamic = 'force-dynamic'
