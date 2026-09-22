import { afterEach, describe, expect, it } from 'vitest'

import { readEnvGroup } from '@/lib/config/env'

const MANAGED_KEYS = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'S3_REGION',
] as const

const original: Record<string, string | undefined> = {}
for (const key of MANAGED_KEYS) original[key] = process.env[key]

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
})

describe('readEnvGroup', () => {
  it('变量齐备时返回 ok', () => {
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://api.example.com/v1'
    process.env.LLM_MODEL = 'test-model'

    const result = readEnvGroup('llm')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.LLM_MODEL).toBe('test-model')
    }
  })

  it('缺失变量时返回缺失清单而不是抛错', () => {
    delete process.env.LLM_API_KEY
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MODEL

    const result = readEnvGroup('llm')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(
        expect.arrayContaining(['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL']),
      )
    }
  })

  it('Base URL 非法时判为缺失', () => {
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'not-a-url'
    process.env.LLM_MODEL = 'test-model'

    const result = readEnvGroup('llm')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toContain('LLM_BASE_URL')
    }
  })

  it('可选键缺失不影响该分组就绪（S3_REGION）', () => {
    process.env.S3_ENDPOINT = 'https://s3.example.com'
    process.env.S3_ACCESS_KEY = 'ak'
    process.env.S3_SECRET_KEY = 'sk'
    process.env.S3_BUCKET = 'resumes'
    delete process.env.S3_REGION

    const result = readEnvGroup('storage')

    expect(result.ok).toBe(true)
    expect(result.data).not.toHaveProperty('S3_REGION')
  })
})
