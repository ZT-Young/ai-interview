import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api/guard'
import { serviceUnavailable, validationError, forbidden } from '@/lib/api/errors'
import { apiHandler, ok } from '@/lib/api/respond'
import { getEntitlements } from '@/lib/services/entitlement-service'
import { getSession } from '@/lib/services/session-service'
import { AsrError, MAX_AUDIO_BYTES, SUPPORTED_AUDIO_TYPES, createAsrPort } from '@/lib/asr'
import { S3Storage, buildStorageKey } from '@/lib/storage/s3'

interface RouteContext {
  params: { id: string }
}

/**
 * POST /api/sessions/:id/answers/audio —— 语音转文字（不落库）。
 *
 * 设计要点：
 * - 只做「音频 → 文本」，转写结果返回给前端填入输入框，**由用户确认后再提交答案**。
 *   因此本路由**不写** answers / interview_messages，用户放弃的录音不会污染面试记录（数据最小化）。
 * - 音频先暂存对象存储，转写后**立即删除**。
 * - ASR 供应商未配置时返回 503 + 明确提示，前端引导手动输入；
 *   **绝不返回伪造的转写文字**。
 * - API Key 只在服务端使用，响应体不含任何凭证。
 */
export const POST = apiHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser()
  // 归属校验：他人会话返回 404
  await getSession(user.id, context.params.id)

  // 权益门禁：语音面试为付费能力（服务端权威，不信任前端）
  const entitlements = await getEntitlements(user.id)
  if (!entitlements.voiceInterview) {
    throw forbidden('语音面试为会员功能，升级后即可使用；当前可手动输入回答')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw validationError('请求格式不正确，需使用 multipart/form-data 上传音频')
  }

  const file = form.get('audio')
  if (!(file instanceof File)) throw validationError('缺少音频文件')
  if (file.size === 0) throw validationError('录音内容为空，请重新录制')
  if (file.size > MAX_AUDIO_BYTES) {
    throw validationError(`录音不能超过 ${Math.floor(MAX_AUDIO_BYTES / 1024 / 1024)}MB`)
  }

  const mimeType = (file.type || 'audio/webm').split(';')[0]!.trim()
  if (!SUPPORTED_AUDIO_TYPES.includes(mimeType as (typeof SUPPORTED_AUDIO_TYPES)[number])) {
    throw validationError('暂不支持该音频格式，请使用浏览器录音功能')
  }

  const port = createAsrPort()
  if (!port.isConfigured()) {
    // 供应商未定：明确告知不可用，而不是静默失败
    throw serviceUnavailable('语音识别暂不可用，请手动输入')
  }

  const storage = new S3Storage()
  const extension = mimeType.split('/')[1] ?? 'webm'
  const storageKey = buildStorageKey({
    kind: 'audio',
    userId: user.id,
    fileId: crypto.randomUUID(),
    extension,
  })

  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    await storage.putObject({ key: storageKey, body: buffer, contentType: mimeType })
  } catch (error) {
    console.error('[asr] 音频暂存失败', error)
    throw serviceUnavailable('录音上传失败，请稍后重试')
  }

  try {
    const result = await port.transcribe({
      audio: buffer,
      mimeType,
      fileName: file.name || `answer.${extension}`,
      language: 'zh',
    })

    return ok({ text: result.text, language: result.language ?? null, durationMs: null })
  } catch (error) {
    if (error instanceof AsrError) {
      if (error.code === 'not_configured') throw serviceUnavailable(error.userMessage)
      if (error.code === 'invalid_audio') throw validationError(error.userMessage)
      throw serviceUnavailable(error.userMessage)
    }
    console.error('[asr] 转写失败', error)
    throw serviceUnavailable('语音识别失败，请重试或手动输入')
  } finally {
    // 无论成功与否都清理临时音频（用户未确认的内容不长期保留）
    await storage.deleteObject(storageKey).catch(() => undefined)
  }
})

export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  return NextResponse.json(
    { error: { code: 'not_found', message: '请使用 POST 上传音频' } },
    { status: 405 },
  )
}
