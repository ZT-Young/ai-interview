import { describe, expect, it } from 'vitest'

import { LOG_TEXT_MAX_LENGTH, sanitizeLogText } from '@/db/schema/ai-call-logs'
import {
  isResumeContentVisible,
  MAX_FREE_CREDITS,
  MIN_FREE_CREDITS,
} from '@/lib/services/admin-service'

/**
 * 管理后台的**离线**测试（不需要数据库）。
 *
 * 重点验证「日志脱敏」—— 这是防止用户简历原文随错误信息写进日志的关键防线。
 */

describe('日志文本脱敏（防 PII 泄漏）', () => {
  it('去除换行与多余空白（避免整段 prompt 落库）', () => {
    const result = sanitizeLogText('第一行\n第二行\r\n第三行\t带制表符')
    expect(result).toBe('第一行 第二行 第三行 带制表符')
    expect(result).not.toContain('\n')
  })

  it('超长文本被截断到上限并加省略号', () => {
    const long = 'x'.repeat(LOG_TEXT_MAX_LENGTH + 200)
    const result = sanitizeLogText(long)

    expect(result).not.toBeNull()
    expect(result!.length).toBe(LOG_TEXT_MAX_LENGTH + 1)
    expect(result!.endsWith('…')).toBe(true)
  })

  it('恰好等于上限时不截断', () => {
    const exact = 'y'.repeat(LOG_TEXT_MAX_LENGTH)
    expect(sanitizeLogText(exact)).toBe(exact)
  })

  it('null / undefined 返回 null', () => {
    expect(sanitizeLogText(null)).toBeNull()
    expect(sanitizeLogText(undefined)).toBeNull()
  })

  it('全空白返回 null（不写入无意义行）', () => {
    expect(sanitizeLogText('   \n\t  ')).toBeNull()
  })

  it('非字符串输入被安全转换', () => {
    expect(sanitizeLogText(42)).toBe('42')
    expect(sanitizeLogText({ code: 'err' })).toContain('err')
  })

  it('模拟真实错误信息：去掉换行后仍可读，且不含换行', () => {
    const message = `[ai] 调用 LLM 失败：socket hang up\n  at fetch (node:internal)\n  提示词：${'x'.repeat(1000)}`
    const result = sanitizeLogText(message)

    expect(result).not.toBeNull()
    expect(result!.includes('\n')).toBe(false)
    expect(result!.length).toBeLessThanOrEqual(LOG_TEXT_MAX_LENGTH + 1)
  })
})

describe('管理后台配置与边界', () => {
  const original = process.env.ADMIN_VIEW_RESUME_CONTENT

  it('默认不可见简历原文', () => {
    delete process.env.ADMIN_VIEW_RESUME_CONTENT
    expect(isResumeContentVisible()).toBe(false)
  })

  it('只有显式设为 "true" 才可见', () => {
    process.env.ADMIN_VIEW_RESUME_CONTENT = 'true'
    expect(isResumeContentVisible()).toBe(true)

    process.env.ADMIN_VIEW_RESUME_CONTENT = '1'
    expect(isResumeContentVisible()).toBe(false)

    process.env.ADMIN_VIEW_RESUME_CONTENT = 'TRUE'
    expect(isResumeContentVisible()).toBe(false)

    if (original === undefined) delete process.env.ADMIN_VIEW_RESUME_CONTENT
    else process.env.ADMIN_VIEW_RESUME_CONTENT = original
  })

  it('免费次数调整范围合理（0 到 1000）', () => {
    expect(MIN_FREE_CREDITS).toBe(0)
    expect(MAX_FREE_CREDITS).toBe(1000)
    expect(MAX_FREE_CREDITS).toBeGreaterThan(MIN_FREE_CREDITS)
  })
})
