/** 业务代码可识别的 AI 层错误类型，便于路由层映射为 HTTP 状态码。 */
export class AiError extends Error {
  readonly code:
    | 'missing_env'
    | 'unauthorized'
    | 'rate_limited'
    | 'timeout'
    | 'provider_error'
    | 'invalid_response'
    /**
     * 供应商侧余额/额度不足（HTTP 402）。
     *
     * 必须与其他错误区分：这是**唯一**一种「稍后重试永远不会好」的可恢复错误——
     * 用户/运维需要去充值。早期实现把它归入通用 provider_error，
     * 上层再压成「解析服务暂时不可用，请稍后重试或手动填写」，
     * 于是用户会反复重试而永远不知道要去充值（实测踩过这个坑：
     * 一个 402 Insufficient Balance 被显示成「服务暂时不可用」）。
     */
    | 'insufficient_balance'

  constructor(code: AiError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AiError'
    this.code = code
  }
}

/** 把供应商 HTTP 状态码映射为稳定的错误类型 */
export function aiErrorFromStatus(status: number, body: string): AiError {
  const detail = body.slice(0, 500)
  if (status === 401 || status === 403) {
    return new AiError('unauthorized', `LLM 鉴权失败（${status}）：请检查 LLM_API_KEY。${detail}`)
  }
  if (status === 402) {
    return new AiError(
      'insufficient_balance',
      `LLM 余额不足（402）：请为该 API Key 充值或更换密钥。${detail}`,
    )
  }
  if (status === 429) {
    return new AiError('rate_limited', `LLM 触发限流（429）：请降低并发或稍后重试。${detail}`)
  }
  if (status === 408 || status === 504) {
    return new AiError('timeout', `LLM 请求超时（${status}）。${detail}`)
  }
  return new AiError('provider_error', `LLM 返回错误（${status}）：${detail}`)
}
