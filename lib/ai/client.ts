import { AiError, aiErrorFromStatus } from './errors'
import type { ChatCompletionOptions, ChatCompletionResult } from './types'

/**
 * 请求超时（毫秒）。
 *
 * 为什么不写死 60 秒：不同操作的合理耗时差异很大——追问/提示是短输出（秒级），
 * 简历解析与报告生成是长输出（可能几十秒）。更关键的是**推理型模型**
 * （如 deepseek-v4-pro）会先产出大量 reasoning token：实测同一份简历
 * 产生 5689 个 completion token 中 4732 个是推理 token，耗时 50.9 秒，
 * 紧贴 60 秒上限；换个稍长的简历就必然超时，表现为「解析服务暂时不可用」。
 *
 * 因此允许用 `LLM_TIMEOUT_MS` 调整，默认给到 120 秒以容纳长输出与推理模型。
 */
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 120_000)

interface ProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/** 读取并校验 LLM 配置；缺失时抛出可读错误（不在 import 阶段执行）。 */
function providerConfig(overrideModel?: string): ProviderConfig {
  const apiKey = process.env.LLM_API_KEY
  const baseUrl = process.env.LLM_BASE_URL
  const model = overrideModel ?? process.env.LLM_MODEL

  const missing: string[] = []
  if (!apiKey) missing.push('LLM_API_KEY')
  if (!baseUrl) missing.push('LLM_BASE_URL')
  if (!model) missing.push('LLM_MODEL')

  if (missing.length > 0) {
    throw new AiError(
      'missing_env',
      `[ai] 缺少环境变量：${missing.join(', ')}。请参考 .env.example 配置（OpenAI 兼容接口）。`,
    )
  }

  return { apiKey: apiKey!, baseUrl: baseUrl!.replace(/\/$/, ''), model: model! }
}

interface OpenAiChatResponse {
  model?: string
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

/** 视觉模型要求的 content 数组结构（OpenAI 兼容格式） */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface ProviderMessage {
  role: string
  content: string | ContentPart[]
}

/**
 * 构造请求消息。
 *
 * 有图片时把最后一条 user 消息改为 content 数组（text + image_url），
 * 这是 OpenAI 兼容视觉接口的通用写法（DeepSeek / Qwen-VL / GPT-4o 均支持）。
 */
function buildMessages(options: ChatCompletionOptions): ProviderMessage[] {
  const { messages, images } = options

  if (!images || images.length === 0) {
    return messages.map((message) => ({ role: message.role, content: message.content }))
  }

  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user')
  if (lastUserIndex === -1) {
    throw new AiError('invalid_response', '[ai] 传入图片时必须包含 user 消息。')
  }

  return messages.map((message, index) => {
    if (index !== lastUserIndex) return { role: message.role, content: message.content }

    const parts: ContentPart[] = [{ type: 'text', text: message.content }]
    for (const image of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
      })
    }
    return { role: message.role, content: parts }
  })
}

/**
 * 调用 OpenAI 兼容的 /chat/completions 接口。
 *
 * Phase 0 仅建立接线与错误处理骨架；出题、追问、评分、报告等业务逻辑
 * 由 Phase 3/4 在 lib/ai 内基于本函数实现（对齐 AGENTS.md §4：复杂 AI 逻辑只放 lib/ai）。
 */
export async function chatCompletion(
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const { apiKey, baseUrl, model } = providerConfig(options.model)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  // 允许调用方传入外部 signal（例如请求被取消）时一并中止
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(options),
        temperature: options.temperature ?? 0.7,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw aiErrorFromStatus(response.status, await response.text())
    }

    const payload = (await response.json()) as OpenAiChatResponse
    const content = payload.choices?.[0]?.message?.content
    const finishReason = payload.choices?.[0]?.finish_reason

    if (typeof content !== 'string' || content.length === 0) {
      throw new AiError('invalid_response', '[ai] LLM 返回内容为空或结构不符合预期。')
    }

    return {
      content,
      model: payload.model ?? model,
      // 透出结束原因：'length' = 被 max_tokens 截断（JSON 必然不完整）
      finishReason,
      usage: payload.usage
        ? {
            promptTokens: payload.usage.prompt_tokens ?? 0,
            completionTokens: payload.usage.completion_tokens ?? 0,
            totalTokens: payload.usage.total_tokens ?? 0,
          }
        : undefined,
    }
  } catch (error) {
    if (error instanceof AiError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiError('timeout', `[ai] LLM 请求超时（>${DEFAULT_TIMEOUT_MS}ms）。`, { cause: error })
    }
    throw new AiError(
      'provider_error',
      `[ai] 调用 LLM 失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
  }
}
