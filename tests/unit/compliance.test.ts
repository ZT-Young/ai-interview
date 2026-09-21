import { afterEach, describe, expect, it } from 'vitest'

import { getLegalDocument, LEGAL_DOCUMENTS, LEGAL_TYPES, LEGAL_VERSION, listLegalDocuments } from '@/lib/legal/documents'
import { redactFields } from '@/lib/observability/logger'
import { isErrorMonitoringEnabled } from '@/lib/observability/error-monitor'
import {
  assertRateLimit,
  checkRateLimit,
  clientKeyFromRequest,
  InMemoryRateLimitStore,
  RATE_LIMIT_RULES,
} from '@/lib/observability/rate-limit'
import { ApiError } from '@/lib/api/errors'

/**
 * 合规、可观测性与限流的**离线**测试（不需要数据库）。
 */

describe('法律文本', () => {
  it('三类文本齐备（协议 / 隐私 / AI 说明）', () => {
    expect(LEGAL_TYPES).toEqual(['terms', 'privacy', 'ai_disclosure'])
    expect(listLegalDocuments()).toHaveLength(3)
  })

  it('每份文本都有标题、版本、生效日期与正文', () => {
    for (const doc of listLegalDocuments()) {
      expect(doc.title.length).toBeGreaterThan(1)
      expect(doc.version).toBe(LEGAL_VERSION)
      expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(doc.sections.length).toBeGreaterThan(0)
      for (const section of doc.sections) {
        expect(section.heading.length).toBeGreaterThan(0)
        expect(section.paragraphs.length).toBeGreaterThan(0)
        for (const paragraph of section.paragraphs) {
          expect(paragraph.trim().length).toBeGreaterThan(10)
        }
      }
    }
  })

  it('隐私政策覆盖数据权利四要素（收集/用途/保存/权利）', () => {
    const privacy = LEGAL_DOCUMENTS.privacy
    const text = privacy.sections.flatMap((s) => [s.heading, ...s.paragraphs]).join('\n')

    expect(text).toContain('收集')
    expect(text).toContain('使用')
    expect(text).toContain('保存期限')
    expect(text).toContain('导出')
    expect(text).toContain('删除')
  })

  it('AI 说明明确「不得作为录用决策依据」（合规 C5）', () => {
    const text = LEGAL_DOCUMENTS.ai_disclosure.sections
      .flatMap((s) => [s.heading, ...s.paragraphs])
      .join('\n')

    expect(text).toContain('不得')
    expect(text).toContain('招聘')
    expect(text).toContain('AI 生成内容')
  })

  it('用户协议说明服务为练习工具，不做结果承诺', () => {
    const text = LEGAL_DOCUMENTS.terms.sections
      .flatMap((s) => [s.heading, ...s.paragraphs])
      .join('\n')

    expect(text).toContain('面试练习')
    expect(text).toContain('不提供任何形式的求职结果承诺')
  })

  it('getLegalDocument 未知类型返回 null（页面据此 404）', () => {
    expect(getLegalDocument('terms')).not.toBeNull()
    expect(getLegalDocument('nope')).toBeNull()
    expect(getLegalDocument('')).toBeNull()
  })
})

describe('日志脱敏（防 PII 写入）', () => {
  it('剔除密码、令牌、简历原文、作答与邮箱字段', () => {
    const result = redactFields({
      event: 'auth.login',
      email: 'user@example.com',
      password: 'secret',
      passwordHash: 'scrypt$...',
      token: 'abc',
      rawText: '简历原文',
      answer: '我的回答',
      nested: { content: '内容', ok: true },
    }) as Record<string, unknown>

    expect(result.event).toBe('auth.login')
    expect(result.email).toBe('[redacted]')
    expect(result.password).toBe('[redacted]')
    expect(result.passwordHash).toBe('[redacted]')
    expect(result.token).toBe('[redacted]')
    expect(result.rawText).toBe('[redacted]')
    expect(result.answer).toBe('[redacted]')

    const nested = result.nested as Record<string, unknown>
    expect(nested.content).toBe('[redacted]')
    expect(nested.ok).toBe(true)
  })

  it('数组被限制长度（防止整表写入日志）', () => {
    const result = redactFields({ items: Array.from({ length: 100 }, (_, i) => i) }) as {
      items: number[]
    }
    expect(result.items).toHaveLength(20)
  })

  it('深层嵌套被截断（防止循环/超大对象）', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'deep' } } } } } }
    expect(JSON.stringify(redactFields(deep))).toContain('[deep]')
  })

  it('基础类型原样返回', () => {
    expect(redactFields(42)).toBe(42)
    expect(redactFields('text')).toBe('text')
    expect(redactFields(null)).toBeNull()
  })
})

describe('错误监控端口', () => {
  const original = process.env.SENTRY_DSN

  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = original
  })

  it('未配置 DSN 时监控为关闭状态（降级为日志）', () => {
    delete process.env.SENTRY_DSN
    expect(isErrorMonitoringEnabled()).toBe(false)
  })

  it('配置合法 DSN 时启用', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1'
    expect(isErrorMonitoringEnabled()).toBe(true)
  })

  it('非法 DSN 视为未配置', () => {
    process.env.SENTRY_DSN = 'not-a-url'
    expect(isErrorMonitoringEnabled()).toBe(false)
  })
})

describe('限流', () => {
  it('窗口内未超限时放行并正确计算剩余额度', () => {
    const store = new InMemoryRateLimitStore()
    const rule = { windowMs: 60_000, max: 3 }

    const first = store.hit('k', rule, 1000)
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(2)
    expect(first.limit).toBe(3)

    const second = store.hit('k', rule, 1000)
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(1)

    const third = store.hit('k', rule, 1000)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)
  })

  it('超过上限后拒绝', () => {
    const store = new InMemoryRateLimitStore()
    const rule = { windowMs: 60_000, max: 2 }

    store.hit('k', rule, 0)
    store.hit('k', rule, 0)
    const third = store.hit('k', rule, 0)

    expect(third.allowed).toBe(false)
    expect(third.remaining).toBe(0)
  })

  it('窗口过后重新计数', () => {
    const store = new InMemoryRateLimitStore()
    const rule = { windowMs: 1000, max: 1 }

    expect(store.hit('k', rule, 0).allowed).toBe(true)
    expect(store.hit('k', rule, 500).allowed).toBe(false)
    expect(store.hit('k', rule, 1001).allowed).toBe(true)
  })

  it('不同 key 互不影响', () => {
    const store = new InMemoryRateLimitStore()
    const rule = { windowMs: 60_000, max: 1 }

    expect(store.hit('a', rule, 0).allowed).toBe(true)
    expect(store.hit('b', rule, 0).allowed).toBe(true)
    expect(store.hit('a', rule, 0).allowed).toBe(false)
  })

  it('assertRateLimit 超限时抛 429', () => {
    const store = new InMemoryRateLimitStore()
    const rule = RATE_LIMIT_RULES['auth.login']

    for (let index = 0; index < rule.max; index += 1) {
      assertRateLimit('auth.login', 'ip:1', { store, now: 0 })
    }

    try {
      assertRateLimit('auth.login', 'ip:1', { store, now: 0 })
      throw new Error('应当抛出 429')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(429)
      expect((error as ApiError).code).toBe('rate_limited')
    }
  })

  it('容量上限触发清理，不会无限增长内存', () => {
    const store = new InMemoryRateLimitStore(50)
    const rule = { windowMs: 1000, max: 1 }

    for (let index = 0; index < 500; index += 1) {
      store.hit(`key-${index}`, rule, index)
    }

    expect(store.size).toBeLessThanOrEqual(50)
  })

  it('checkRateLimit 对未配置的 scope 不崩溃（规则齐备性）', () => {
    for (const scope of Object.keys(RATE_LIMIT_RULES) as Array<keyof typeof RATE_LIMIT_RULES>) {
      const result = checkRateLimit(scope, 'test-key', { store: new InMemoryRateLimitStore() })
      expect(result.allowed).toBe(true)
      expect(result.limit).toBeGreaterThan(0)
    }
  })

  it('登录规则比回调规则严格（防暴力破解优先）', () => {
    expect(RATE_LIMIT_RULES['auth.login'].max).toBeLessThan(RATE_LIMIT_RULES['payments.callback'].max)
  })

  it('clientKeyFromRequest 优先取 x-forwarded-for 第一段', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    })
    expect(clientKeyFromRequest(request)).toBe('203.0.113.9')
  })

  it('clientKeyFromRequest 无代理头时回退', () => {
    const request = new Request('http://localhost')
    expect(clientKeyFromRequest(request)).toBe('unknown')
  })
})
