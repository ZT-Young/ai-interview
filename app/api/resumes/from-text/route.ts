import { z } from 'zod'

import { serviceUnavailable } from '@/lib/api/errors'
import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { buildStorageKey, createStorage, isStorageUnavailable } from '@/lib/storage'
import { parseResumeText } from '@/lib/services/handlers/parse-service'
import { createResume, updateParseState } from '@/lib/services/handlers/resume-service'
import { resolvePorts } from '@/lib/services/handlers/upload-service'

/**
 * POST /api/resumes/from-text —— **粘贴简历文本**创建并解析（无需上传文件）。
 *
 * 为什么需要它：AGENTS.md §2 第 3 步要求「上传简历（PDF / Word / 图片）」，
 * 但用户手上常常只有一段纯文本（从招聘网站复制、或从旧简历粘贴），
 * 强制先转成 PDF 才能用是不必要的门槛。这条路径与 JD 的「粘贴文本」对称。
 *
 * 关键设计：**粘贴的文本也真实写入存储**（key 形如 `resumes/<uid>/<id>.txt`）。
 * 用假 storage_key 占位会让「存储里有原件」这一保证失真；
 * 真实写入后 `resumes.storage_key`（NOT NULL）的语义保持正确，
 * 用户之后仍可从存储取回原文。
 *
 * 失败语义与上传保持一致：
 * - 存储不可用 → 503（此时任何东西都存不下来）
 * - 文本过短 / 模型未配置等 → **200** 且 `parseStatus='failed'`，
 *   记录与原文都保留，用户可在 review 页手动填写（AGENTS.md §2 第 4 步）
 */
const bodySchema = z.object({
  rawText: z.string().trim().min(10, '简历内容过短').max(200_000),
  fileName: z.string().trim().min(1).max(120).optional(),
})

export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, bodySchema)
  const text = input.rawText
  const fileName = input.fileName ?? '粘贴的简历.txt'

  const storageKey = buildStorageKey({
    kind: 'resumes',
    userId: user.id,
    fileId: crypto.randomUUID(),
    extension: 'txt',
  })

  try {
    await createStorage().putObject({
      key: storageKey,
      body: Buffer.from(text, 'utf8'),
      contentType: 'text/plain; charset=utf-8',
    })
  } catch (error) {
    if (isStorageUnavailable(error)) {
      throw serviceUnavailable(
        '文件存储未配置或不可用。本地开发可设置 STORAGE_DRIVER=local，' +
          '或配置 S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET。',
      )
    }
    throw error
  }

  const record = await createResume(user.id, {
    fileName,
    // fileType 枚举里没有 txt；按「文本类」取最接近的 pdf 以通过枚举校验
    fileType: 'pdf',
    fileSize: Buffer.byteLength(text, 'utf8') || 1,
    storageKey,
  })

  const parsed = await parseResumeText(resolvePorts(), text)

  if (parsed.ok) {
    const resume = await updateParseState(user.id, record.id, {
      parseStatus: 'success',
      rawText: text,
      parsedData: parsed.data,
      parseError: null,
      extractionMeta: { ...parsed.meta, model: parsed.model, dropped: parsed.dropped },
    })
    return ok({ resume, parse: { status: 'success' } })
  }

  // 解析失败也保留记录与原文，供用户手动修改
  const resume = await updateParseState(user.id, record.id, {
    parseStatus: 'failed',
    rawText: text,
    parsedData: null,
    parseError: parsed.error.userMessage,
    extractionMeta: { ...parsed.meta, dropped: parsed.dropped },
  })

  return ok({
    resume,
    parse: { status: 'failed', error: parsed.error.userMessage, code: parsed.code },
  })
})

export const dynamic = 'force-dynamic'
