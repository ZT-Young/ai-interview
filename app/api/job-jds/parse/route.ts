import { z } from 'zod'

import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { createJobJd, updateParseState } from '@/lib/services/job-jd-service'
import { parseJdText } from '@/lib/services/parse-service'
import { resolvePorts } from '@/lib/services/upload-service'

/**
 * POST /api/job-jds/parse —— 粘贴 JD 文本并解析（无需文件上传）。
 *
 * 这是最小可用输入路径（AGENTS.md §2 第 2 步「粘贴或上传 JD」）。
 */
const bodySchema = z.object({
  rawText: z.string().trim().min(10, 'JD 内容过短').max(200_000),
})

export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, bodySchema)

  const record = await createJobJd(user.id, { rawText: input.rawText })
  const parsed = await parseJdText(resolvePorts(), input.rawText)

  if (parsed.ok) {
    const jobJd = await updateParseState(user.id, record.id, {
      parseStatus: 'success',
      parsedData: parsed.data,
      title: parsed.data.title || null,
      company: parsed.data.company || null,
      parseError: null,
      extractionMeta: { ...parsed.meta, model: parsed.model, dropped: parsed.dropped },
    })
    return ok({ jobJd, parse: { status: 'success', meta: parsed.meta } })
  }

  const jobJd = await updateParseState(user.id, record.id, {
    parseStatus: 'failed',
    parsedData: null,
    parseError: parsed.error.userMessage,
    extractionMeta: { ...parsed.meta, dropped: parsed.dropped },
  })

  /**
   * ⚠️ 这里**不能**返回 503。
   *
   * 记录已经落库、原文已经保留，客户端拿到 503 会以为「整个请求失败」，
   * 因而丢弃 `jobJd.id` 并提示用户重试——但重试只会再建一条重复记录。
   * 语义上这是「已成功保存，只是自动解析没成功」，与上传路径一致（200 + failed），
   * 由前端引导用户去 review 页手动填写（AGENTS.md §2 第 4 步）。
   */
  return ok({
    jobJd,
    parse: { status: 'failed', error: parsed.error.userMessage, code: parsed.code },
  })
})

export const dynamic = 'force-dynamic'
