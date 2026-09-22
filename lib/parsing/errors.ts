export type ParseErrorCode =
  | 'unsupported_type'
  | 'corrupted_file'
  | 'no_text_layer'
  | 'text_too_short'
  | 'ai_invalid_output'
  | 'ai_unavailable'
  /** AI 供应商余额/额度不足 —— 重试无用，需充值 */
  | 'ai_insufficient_balance'
  /** AI 调用超时 —— 通常是内容过长或模型过慢，重试可能成功 */
  | 'ai_timeout'
  /** AI 鉴权失败 / 未配置 —— 需修配置 */
  | 'ai_misconfigured'
  /** AI 限流 —— 稍后重试即可 */
  | 'ai_rate_limited'
  | 'not_in_scope'
  | 'plan_generation_failed'

/**
 * 解析错误 —— parseError 只承载**面向用户的中文提示**，
 * 供应商原始报错放在 cause 中，不得直接展示（docs/engineering/AI_PROMPTS.md §4.3）。
 */
export class ParseError extends Error {
  readonly code: ParseErrorCode
  /** 面向用户的提示文案 */
  readonly userMessage: string

  constructor(code: ParseErrorCode, userMessage: string, options?: { cause?: unknown }) {
    super(`[parse:${code}] ${userMessage}`, options)
    this.name = 'ParseError'
    this.code = code
    this.userMessage = userMessage
  }
}

/**
 * 面向用户的提示文案。
 *
 * ⚠️ 这些文案必须**区分可重试与不可重试**，否则会误导用户：
 * - 「余额不足」重试永远不会好，必须提示去充值/换密钥；
 * - 「未配置/鉴权失败」是运维问题，重试也无用；
 * - 「超时」「限流」重试可能成功。
 *
 * 历史缺陷：所有 AI 错误都被压成同一句「解析服务暂时不可用，请稍后重试或手动填写」，
 * 于是用户面对「余额不足」会一直点重试而永远不知道要去充值
 * （实测中一个 402 Insufficient Balance 就是这样被掩盖的）。
 */
export const PARSE_ERROR_MESSAGES: Record<ParseErrorCode, string> = {
  unsupported_type: '暂不支持该文件格式，请上传 PDF、Word 或图片',
  corrupted_file: '文件无法读取，可能已损坏或加密，请重新导出后上传',
  no_text_layer: '未能从文件中识别出文字，请上传更清晰的图片',
  text_too_short: '内容过短，无法提取有效信息，请补充后重试',
  ai_invalid_output: '解析结果格式异常，已保留原文，请手动填写要点',
  ai_unavailable: '解析服务暂时不可用，请稍后重试或手动填写',
  ai_insufficient_balance: 'AI 服务余额不足，请联系管理员充值后重试（你的内容已保存，可手动填写）',
  ai_timeout: '内容较长导致 AI 处理超时，请重试；若持续失败可精简内容或手动填写',
  ai_misconfigured: 'AI 服务未正确配置，请联系管理员检查密钥设置（你的内容已保存，可手动填写）',
  ai_rate_limited: 'AI 服务当前请求过多，请稍后重试（你的内容已保存，可手动填写）',
  not_in_scope: '该能力尚未开放，请手动填写',
  plan_generation_failed: '生成面试计划失败，可能是内容不足或服务异常，请稍后重试',
}

export function parseError(code: ParseErrorCode, options?: { cause?: unknown }): ParseError {
  return new ParseError(code, PARSE_ERROR_MESSAGES[code], options)
}

/**
 * 是否为「环境/供应商级」失败（**不应重试**，需要改配置或充值）。
 *
 * 为什么需要集中判定：各 service 里原本都是手写
 * `if (outcome.code === 'ai_unavailable')`——一旦新增错误码（例如 402 余额不足），
 * 没人会记得同步这些判断，于是新错误码会掉进「重试循环」：
 * 白白消耗 MAX_ATTEMPTS 次额度，最后还被压成通用的 `xxx_failed`，
 * 真实原因再次对用户不可见（实测踩过：余额不足被重试 2 次后报「评分失败」）。
 *
 * 注意 `ai_timeout` / `ai_rate_limited` **不在**此列：它们是暂时性的，
 * 换一次请求可能就成功，值得重试。
 */
export const NON_RETRYABLE_AI_PARSE_CODES: readonly ParseErrorCode[] = [
  'ai_unavailable',
  'ai_misconfigured',
  'ai_insufficient_balance',
]

export function isEnvironmentLevelParseFailure(code: ParseErrorCode): boolean {
  return NON_RETRYABLE_AI_PARSE_CODES.includes(code)
}
