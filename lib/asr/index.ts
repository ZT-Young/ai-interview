/**
 * ASR 端口 —— 语音转文字。
 *
 * 供应商选型仍为 TBD（AGENTS.md §9.2），因此本模块只定义端口与「未配置」实现。
 * 供应商确定后新增一个实现类并在 createAsrPort 中接线即可，
 * 路由与前端无需改动。
 *
 * 安全约束（AGENTS.md §7 C3、§8）：ASR 调用**只在服务端**发生，
 * API Key 仅从服务端环境变量读取，绝不进入前端 bundle。
 */

export interface TranscribeInput {
  audio: Buffer
  /** 音频 MIME 类型，如 audio/webm */
  mimeType: string
  /** 原始文件名，部分供应商用于判断容器格式 */
  fileName: string
  /** 语言提示（可选），如 'zh' */
  language?: string
}

export interface TranscribeResult {
  text: string
  /** 供应商返回的识别语言（若有） */
  language?: string
}

export class AsrError extends Error {
  readonly code: 'not_configured' | 'provider_error' | 'invalid_audio'
  /** 面向用户的中文提示 */
  readonly userMessage: string

  constructor(
    code: AsrError['code'],
    userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(`[asr:${code}] ${userMessage}`, options)
    this.name = 'AsrError'
    this.code = code
    this.userMessage = userMessage
  }
}

export interface AsrPort {
  /** 是否已具备可用的 ASR 配置 */
  isConfigured(): boolean
  transcribe(input: TranscribeInput): Promise<TranscribeResult>
}

/**
 * 未配置实现：明确告知「暂不可用」，**绝不伪造转写文字**。
 *
 * 前端据此提示用户改用手动输入；这也是当前默认行为。
 */
export class UnconfiguredAsr implements AsrPort {
  isConfigured(): boolean {
    return false
  }

  async transcribe(): Promise<TranscribeResult> {
    throw new AsrError('not_configured', '语音识别暂不可用，请手动输入')
  }
}

/** 支持的上传音频类型（浏览器 MediaRecorder 常见输出） */
export const SUPPORTED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
] as const

/** 单段录音大小上限：10MB（约 5-10 分钟 opus） */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/**
 * 工厂：当前一律返回未配置实现。
 *
 * TODO(ASR 选型确定后)：在此返回具体供应商实现，
 * 例如 `new OpenAiCompatibleAsr()`（/audio/transcriptions）或国内 ASR 适配器。
 */
export function createAsrPort(): AsrPort {
  return new UnconfiguredAsr()
}
