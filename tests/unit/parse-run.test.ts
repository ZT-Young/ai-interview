import { describe, expect, it } from 'vitest'

import { AiError, aiErrorFromStatus } from '@/lib/ai/errors'
import { jdParseSchema } from '@/lib/ai/schemas/parse'
import { extractJsonObject, MAX_ATTEMPTS, parseWithRetry } from '@/lib/parsing/run'

import { envelope, FakeLlm, llmUnavailableError } from '../helpers/fakes'

const validJdData = {
  title: 'AI 工程师',
  company: '示例公司',
  must_have: ['熟悉 TypeScript'],
  nice_to_have: [],
  responsibilities: ['负责后端开发'],
  keywords: ['TypeScript'],
}

function attempt(llm: FakeLlm) {
  return parseWithRetry({
    llm,
    system: 'system',
    user: 'user',
    schema: jdParseSchema,
    isEmpty: (data) => (data as typeof validJdData).title === '' && (data as typeof validJdData).must_have.length === 0,
  })
}

describe('extractJsonObject', () => {
  it('解析纯 JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('解析 markdown 代码块包裹的 JSON', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('解析前后带解释文字的 JSON', () => {
    expect(extractJsonObject('好的，结果如下：{"a":1} 完毕')).toEqual({ a: 1 })
  })

  it('无法解析时返回 undefined', () => {
    expect(extractJsonObject('完全不是 JSON')).toBeUndefined()
  })
})

describe('parseWithRetry：正常解析', () => {
  it('一次成功时 attempts 为 1', async () => {
    const llm = FakeLlm.always({ schema_version: '1.0', data: validJdData })
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.attempts).toBe(1)
      expect(outcome.data.data.title).toBe('AI 工程师')
      expect(outcome.model).toBe('fake-model')
    }
    expect(llm.callCount).toBe(1)
  })

  it('容忍 markdown 包裹的返回', async () => {
    const llm = new FakeLlm([
      { type: 'content', content: '```json\n' + envelope(validJdData) + '\n```' },
    ])
    const outcome = await attempt(llm)
    expect(outcome.ok).toBe(true)
  })

  it('第一次失败、第二次成功时 attempts 为 2 且降温重试', async () => {
    const llm = new FakeLlm([
      { type: 'malformed', content: '这不是 JSON' },
      { type: 'content', content: envelope(validJdData) },
    ])
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.attempts).toBe(2)
    expect(llm.callCount).toBe(2)
    // 第二次尝试应带降温参数
    expect(llm.requests[1]!.temperature).toBe(0.2)
  })
})

describe('parseWithRetry：Schema 校验失败', () => {
  it('缺少 schema_version 时重试后判定失败', async () => {
    const llm = FakeLlm.always({ data: validJdData })
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('ai_invalid_output')
      expect(outcome.error.userMessage).toBe('解析结果格式异常，已保留原文，请手动填写要点')
      expect(outcome.attempts).toBe(MAX_ATTEMPTS)
    }
    expect(llm.callCount).toBe(MAX_ATTEMPTS)
  })

  it('缺少必填字段时判定失败', async () => {
    const { must_have: _omitted, ...partial } = validJdData
    const outcome = await attempt(FakeLlm.always({ schema_version: '1.0', data: partial }))

    expect(outcome.ok).toBe(false)
  })

  it('多余字段时判定失败（strict）', async () => {
    const outcome = await attempt(
      FakeLlm.always({ schema_version: '1.0', data: { ...validJdData, extra: 1 } }),
    )
    expect(outcome.ok).toBe(false)
  })

  it('类型错误时判定失败', async () => {
    const outcome = await attempt(
      FakeLlm.always({ schema_version: '1.0', data: { ...validJdData, must_have: 'x' } }),
    )
    expect(outcome.ok).toBe(false)
  })

  it('保留最后一次原始输出以便排障', async () => {
    const outcome = await attempt(FakeLlm.always({ schema_version: '1.0', data: { bad: true } }))

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.lastRawOutput).toContain('schema_version')
    }
  })

  it('内容全空视为失败', async () => {
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: {
        title: '',
        company: '',
        must_have: [],
        nice_to_have: [],
        responsibilities: [],
        keywords: [],
      },
    })
    const outcome = await attempt(llm)
    expect(outcome.ok).toBe(false)
  })
})

describe('parseWithRetry：调用层面失败', () => {
  /**
   * ⚠️ 按**真实原因**分流，不再全部压成 ai_unavailable。
   *
   * 原因本身决定用户该做什么，压平会造成误导：
   * 实测中一个 402「Insufficient Balance」被显示成「服务暂时不可用，
   * 请稍后重试」，用户会一直重试而永远不知道要去充值。
   */
  it('缺少环境变量 → ai_misconfigured（运维问题，重试无用）', async () => {
    const llm = new FakeLlm([{ type: 'error', error: llmUnavailableError() }])
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('ai_misconfigured')
      expect(outcome.attempts).toBe(1)
      // 文案必须能区分于「稍后重试」
      expect(outcome.error.userMessage).toContain('未正确配置')
    }
    // 环境级失败不做无意义重试
    expect(llm.callCount).toBe(1)
  })

  it('余额不足（402）→ ai_insufficient_balance，文案提示充值', async () => {
    const llm = new FakeLlm([
      { type: 'error', error: new AiError('insufficient_balance', 'LLM 余额不足（402）') },
    ])
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('ai_insufficient_balance')
      expect(outcome.error.userMessage).toContain('余额不足')
      // 不能只说「稍后重试」——重试永远不会好
      expect(outcome.error.userMessage).toContain('充值')
    }
  })

  it('超时 → ai_timeout，文案提示可重试', async () => {
    const llm = new FakeLlm([{ type: 'error', error: new AiError('timeout', '超时') }])
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('ai_timeout')
      expect(outcome.error.userMessage).toContain('重试')
    }
  })

  it('限流（429）→ ai_rate_limited', async () => {
    const llm = new FakeLlm([{ type: 'error', error: new AiError('rate_limited', '限流') }])
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('ai_rate_limited')
  })

  it('未知异常 → 通用 ai_unavailable', async () => {
    const llm = new FakeLlm([{ type: 'error', error: new Error('socket hang up') }])
    const outcome = await attempt(llm)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('ai_unavailable')
  })
})

describe('供应商状态码映射', () => {
  it('402 映射为余额不足，而不是通用供应商错误', () => {
    const error = aiErrorFromStatus(402, '{"error":{"message":"Insufficient Balance"}}')
    expect(error.code).toBe('insufficient_balance')
    expect(error.message).toContain('余额不足')
  })

  it('401 / 403 映射为鉴权失败', () => {
    expect(aiErrorFromStatus(401, '').code).toBe('unauthorized')
    expect(aiErrorFromStatus(403, '').code).toBe('unauthorized')
  })

  it('429 映射为限流，504 映射为超时', () => {
    expect(aiErrorFromStatus(429, '').code).toBe('rate_limited')
    expect(aiErrorFromStatus(504, '').code).toBe('timeout')
  })
})
