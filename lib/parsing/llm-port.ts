import { chatCompletion } from '../ai/client'
import { AiError } from '../ai/errors'
import { logAiError, logAiSuccess, type AiOperation } from '../ai/logger'
import type { ChatImage } from '../ai/types'

/**
 * LLM 端口 —— 让解析服务可被测试替换。
 *
 * 真实实现走 lib/ai/client.ts（OpenAI 兼容接口）；
 * 测试注入 tests/helpers/llm.ts 中的 fake，从而在**不调用真实模型**的前提下
 * 覆盖「正常解析 / 解析失败 / Schema 校验失败」三类场景。
 */

export interface LlmRequest {
  system: string
  user: string
  /** 图片直读（视觉模型） */
  images?: ChatImage[]
  temperature?: number
  /** 输出 token 上限（出题等长输出场景需要） */
  maxTokens?: number
  /** 业务操作类型，用于 AI 调用日志（lib/ai/logger.ts） */
  operation?: AiOperation
  /** 关联用户与会话，便于从日志跳转排查 */
  userId?: string | null
  sessionId?: string | null
}

export interface LlmResponse {
  /** 模型返回的原始文本（应为 JSON） */
  content: string
  model: string
  /**
   * 供应商的结束原因；`'length'` 表示输出被 max_tokens 截断。
   * 上层据此给出准确提示，而不是含糊的「返回不是合法 JSON」。
   */
  finishReason?: string
}

export interface LlmPort {
  complete(request: LlmRequest): Promise<LlmResponse>
}

export class OpenAiCompatibleLlm implements LlmPort {
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const startedAt = Date.now()
    const operation: AiOperation = request.operation ?? 'unknown'

    try {
      const result = await chatCompletion({
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        images: request.images,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        json: true,
      })

      // 成功日志：fire-and-forget，不影响响应
      void logAiSuccess({
        operation,
        model: result.model,
        durationMs: Date.now() - startedAt,
        promptTokens: result.usage?.promptTokens ?? null,
        completionTokens: result.usage?.completionTokens ?? null,
        userId: request.userId ?? null,
        sessionId: request.sessionId ?? null,
      })

      return { content: result.content, model: result.model, finishReason: result.finishReason }
    } catch (error) {
      void logAiError({
        operation,
        durationMs: Date.now() - startedAt,
        userId: request.userId ?? null,
        sessionId: request.sessionId ?? null,
        errorCode: error instanceof AiError ? error.code : 'unknown',
        // 错误信息经 sanitizeLogText 截断，避免整段 prompt 泄漏
        errorMessage: error instanceof Error ? error.message : error,
      })

      if (error instanceof AiError) throw error
      throw error
    }
  }
}
