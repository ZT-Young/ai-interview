import type { z } from 'zod'

import { AiError } from '../ai/errors'
import type { AiOperation } from '../ai/logger'
import type { ChatImage } from '../ai/types'

import {
  PARSE_ERROR_MESSAGES,
  ParseError,
  parseError,
  type ParseErrorCode,
} from './errors'
import type { LlmPort } from './llm-port'

/**
 * 解析编排 —— schema 校验 + 重试 + 空内容检测。
 *
 * 契约见 docs/AI_PROMPTS.md §5.4：
 *   第 1 次尝试（temperature 0.7）
 *     ↓ 失败
 *   第 2 次尝试（temperature 0.2）
 *     ↓ 仍失败
 *   ok:false + 用户可读错误
 *
 * 本模块**不访问数据库、不访问网络**（只依赖注入的 LlmPort），因此可完整单测。
 */

/** 最多尝试次数（1 次原始 + 1 次降温重试） */
export const MAX_ATTEMPTS = 2
const RETRY_TEMPERATURE = 0.2

export type ParseOutcome<T> =
  | {
      ok: true
      data: T
      model: string
      attempts: number
      /** 模型自报的不确定字段，与后置过滤结果合并 */
      lowConfidenceFields: string[]
    }
  | {
      ok: false
      code: ParseErrorCode
      error: ParseError
      attempts: number
      /** 最后一次的原始返回，便于审计与排障（不展示给用户） */
      lastRawOutput?: string
      /**
       * 最后一次失败的具体原因（被截断 / 不是 JSON / 不符合 schema）。
       *
       * 为什么要单独带出来：默认文案「解析结果格式异常」对排查毫无帮助，
       * 上层服务（出题、评分、报告）会把它汇入 violations 里。
       * 实测中「输出被 max_tokens 截断」曾被误报成「模型返回不是合法 JSON」，
       * 导致方向完全找错。
       */
      violation?: string
    }

export interface AttemptInput<S extends z.ZodTypeAny> {
  llm: LlmPort
  system: string
  user: string
  images?: ChatImage[]
  /** 业务操作类型，用于 AI 调用日志（lib/ai/logger.ts） */
  operation?: AiOperation
  /** 关联用户与会话，便于从日志跳转排查 */
  userId?: string | null
  sessionId?: string | null
  /**
   * 输出 token 预算。
   *
   * 长输出场景（出题 8-12 题、报告）必须显式给足，否则会被供应商截断，
   * 表现为 JSON 不完整 → 被判为「不是合法 JSON」。
   * 默认按 `LLM_MAX_TOKENS` 环境变量取，未设置时用各调用方的值。
   */
  maxTokens?: number
  /**
   * 采样温度。首次尝试用调用方给的值，重试时会自动降到
   * `RETRY_TEMPERATURE`（降温以脱离不合规输出）。
   */
  temperature?: number
  /** 信封 schema：{ schema_version, data } */
  schema: S
  /** 空内容判定；返回 true 视为解析失败 */
  isEmpty?: (data: never) => boolean
  /** 模型自报的低置信度字段（可选，通常来自输出中的额外字段） */
  extractLowConfidence?: (raw: unknown) => string[]
}

/** 从模型返回中提取 JSON 对象；容忍 ```json 包裹等常见噪声 */
export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim()

  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced?.[1]) {
    const inner = tryParse(fenced[1].trim())
    if (inner !== undefined) return inner
  }

  // 退一步：截取第一个 { 到最后一个 }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const sliced = tryParse(trimmed.slice(start, end + 1))
    if (sliced !== undefined) return sliced
  }

  return undefined
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 把 LLM 抛出的错误映射为用户可读的 ParseError。
 *
 * 关键：**按真实原因分流**，不要全部压成 `ai_unavailable`。
 * 原因不同，用户该做的事完全不同：
 * - `missing_env` / `unauthorized` → 运维改配置，重试无用
 * - `insufficient_balance`       → 去充值，重试无用
 * - `rate_limited`               → 稍后重试即可
 * - `timeout`                    → 重试或精简内容
 * - 其它                          → 通用「暂时不可用」
 *
 * 原始错误保留在 `cause` 中，同时 `lib/parsing/llm-port.ts` 会把
 * `error_code` + `error_message` 写入 `ai_call_logs`，因此运维侧
 * 始终能看到精确原因（见 /admin/logs 的错误视图）。
 */
function mapLlmError(error: unknown): ParseError {
  if (error instanceof AiError) {
    const byCode: Partial<Record<AiError['code'], ParseErrorCode>> = {
      missing_env: 'ai_misconfigured',
      unauthorized: 'ai_misconfigured',
      insufficient_balance: 'ai_insufficient_balance',
      rate_limited: 'ai_rate_limited',
      timeout: 'ai_timeout',
    }
    return parseError(byCode[error.code] ?? 'ai_unavailable', { cause: error })
  }
  return parseError('ai_unavailable', { cause: error })
}

/**
 * 带重试的结构化解析。
 */
export async function parseWithRetry<S extends z.ZodTypeAny>(
  input: AttemptInput<S>,
): Promise<ParseOutcome<z.infer<S>>> {
  let lastRawOutput: string | undefined
  /** 最后一次失败的可读原因，用于给出**准确**的错误提示而不是笼统结论 */
  let lastViolation: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: { content: string; model: string; finishReason?: string }
    try {
      response = await input.llm.complete({
        system: input.system,
        user: input.user,
        images: input.images,
        temperature: attempt === 1 ? input.temperature : RETRY_TEMPERATURE,
        maxTokens: input.maxTokens,
        operation: input.operation,
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
      })
    } catch (error) {
      // 调用层面失败（网络/鉴权/限流）→ 不再重试，直接判定服务不可用
      const mapped = mapLlmError(error)
      return { ok: false, code: mapped.code, error: mapped, attempts: attempt }
    }

    lastRawOutput = response.content

    /**
     * 输出被 max_tokens 截断（`finish_reason === 'length'`）。
     *
     * 必须单独识别：截断的 JSON 必然解析失败，若只报「返回不是合法 JSON」，
     * 会让人以为模型不会输出 JSON，而真实原因是**预算不够**
     * （实测：出题 12 道题时 completion 正好卡在 max_tokens=4000）。
     */
    if (response.finishReason === 'length') {
      lastViolation = '模型输出被 max_tokens 截断（内容过长），请提高该操作的 token 预算或减少题目数量'
      continue
    }

    const raw = extractJsonObject(response.content)
    if (raw === undefined) {
      lastViolation = '模型返回不是合法 JSON'
      continue
    }

    const result = input.schema.safeParse(raw)
    if (!result.success) {
      lastViolation = `模型返回不符合 schema：${result.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('；')}`
      continue
    }

    const envelopeValue = result.data as { data: unknown }
    const data = envelopeValue.data

    if (input.isEmpty && input.isEmpty(data as never)) {
      lastViolation = '模型返回的内容为空'
      continue
    }

    const lowConfidence = input.extractLowConfidence?.(raw) ?? []

    return {
      ok: true,
      data: result.data,
      model: response.model,
      attempts: attempt,
      lowConfidenceFields: lowConfidence,
    }
  }

  // 带上最后一次的具体原因：默认的「解析结果格式异常」无法区分
  // 「被截断」「不是 JSON」「不符合 schema」，排查时只能猜
  const error = new ParseError(
    'ai_invalid_output',
    PARSE_ERROR_MESSAGES.ai_invalid_output,
    { cause: lastViolation },
  )
  return {
    ok: false,
    code: error.code,
    error,
    attempts: MAX_ATTEMPTS,
    lastRawOutput,
    violation: lastViolation,
  }
}

/** 从成功的信封结果中取出 data 部分 */
export function envelopeData<T>(envelope: { data: T }): T {
  return envelope.data
}
