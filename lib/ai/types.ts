/** OpenAI 兼容接口的消息结构（DeepSeek / Qwen / GPT 通用） */
export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

/**
 * 视觉输入附件（简历/JD 图片直读）。
 * 采用 base64 data URL，避免供应商侧拉取私有对象存储。
 * 支持的 MIME 见 docs/engineering/AI_PROMPTS.md §4.2（png / jpeg / webp / gif）。
 */
export interface ChatImage {
  /** base64 编码的图片数据（不含 data URL 前缀） */
  base64: string
  mimeType: string
}

export interface ChatCompletionOptions {
  messages: ChatMessage[]
  /** 随最后一条 user 消息附带的图片（视觉模型直读） */
  images?: ChatImage[]
  /** 覆盖默认模型（默认取 LLM_MODEL） */
  model?: string
  temperature?: number
  maxTokens?: number
  /** 要求模型返回 JSON 对象（出题/评分/报告等结构化输出使用） */
  json?: boolean
  signal?: AbortSignal
}

export interface ChatCompletionResult {
  content: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /**
   * 供应商返回的结束原因。
   *
   * `'length'` 表示**输出被 max_tokens 截断**——此时 JSON 必然不完整，
   * 但上层只会看到「不是合法 JSON」这种误导性结论（实测踩过：
   * 出题 12 道题时 completion 正好卡在 max_tokens=4000，被截断后
   * 报「模型返回不是合法 JSON」，看起来像模型不会输出 JSON，
   * 实际是预算太小）。因此把这个信号透出来，让上层能给出准确提示。
   */
  finishReason?: string
}
