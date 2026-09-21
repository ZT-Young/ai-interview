import { AiError } from '@/lib/ai/errors'
import type { LlmPort, LlmRequest, LlmResponse } from '@/lib/parsing/llm-port'
import type { StoragePort, PutObjectInput } from '@/lib/storage/s3'

/**
 * 测试替身。
 *
 * 解析服务通过注入 LlmPort / StoragePort 工作，因此测试可以在**完全不调用
 * 真实模型与 S3** 的前提下，覆盖正常解析、解析失败、Schema 校验失败三类场景。
 */

export type LlmStep =
  | { type: 'content'; content: string; model?: string }
  | { type: 'error'; error: Error }
  | { type: 'malformed'; content: string }

/** 按调用顺序返回预设结果；用尽后重复最后一个 */
export class FakeLlm implements LlmPort {
  readonly requests: LlmRequest[] = []
  private readonly steps: LlmStep[]

  constructor(steps: LlmStep[]) {
    if (steps.length === 0) throw new Error('FakeLlm 需要至少一个 step')
    this.steps = steps
  }

  /** 便捷构造：所有调用都返回同一段 JSON */
  static always(json: unknown, model = 'fake-model'): FakeLlm {
    return new FakeLlm([{ type: 'content', content: JSON.stringify(json), model }])
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request)
    const step = this.steps[Math.min(this.requests.length - 1, this.steps.length - 1)]

    if (step.type === 'error') throw step.error

    if (step.type === 'malformed') {
      return { content: step.content, model: 'fake-model' }
    }

    return { content: step.content, model: step.model ?? 'fake-model' }
  }

  get callCount(): number {
    return this.requests.length
  }
}

/** 返回合法信封 JSON 的 helper */
export function envelope(data: unknown, version = '1.0'): string {
  return JSON.stringify({ schema_version: version, data })
}

/** 内存对象存储替身 */
export class FakeStorage implements StoragePort {
  readonly objects = new Map<string, Buffer>()
  readonly puts: string[] = []
  readonly deletes: string[] = []
  /** 设为 true 时所有操作抛错，用于模拟未配置 S3 */
  failAll = false

  async putObject(input: PutObjectInput): Promise<void> {
    if (this.failAll) throw new Error('fake storage failure')
    this.objects.set(input.key, input.body)
    this.puts.push(input.key)
  }

  async getObject(key: string): Promise<Buffer> {
    if (this.failAll) throw new Error('fake storage failure')
    const value = this.objects.get(key)
    if (!value) throw new Error(`fake storage: 对象不存在 ${key}`)
    return value
  }

  async deleteObject(key: string): Promise<void> {
    if (this.failAll) throw new Error('fake storage failure')
    this.objects.delete(key)
    this.deletes.push(key)
  }
}

/** 便捷：构造一个「LLM 不可用」的错误（模拟未配置 API key） */
export function llmUnavailableError(): AiError {
  return new AiError('missing_env', '[ai] 缺少环境变量：LLM_API_KEY')
}
