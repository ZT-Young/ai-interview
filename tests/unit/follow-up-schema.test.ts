import { describe, expect, it } from 'vitest'

import {
  followUpParseSchema,
  hintParseSchema,
  isHintAcceptable,
  normalizeFollowUp,
  type FollowUpData,
} from '@/lib/ai/schemas/interview'
import { buildFollowUpPrompt, buildHintPrompt } from '@/lib/ai/prompts/interview'

/** 归一化前的原始输入：follow_up 允许 null（模型常见返回） */
type FollowUpInput = Omit<FollowUpData, 'follow_up'> & { follow_up?: string | null }

function validFollowUp(overrides: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    action: 'follow_up',
    follow_up: '你提到优化了接口性能，具体是怎么做的？',
    reason: 'vague',
    focus: '优化了接口性能',
    ...overrides,
  }
}

/**
 * 原始输入 → 经 schema 规范化 → 交给 normalizeFollowUp。
 * 与生产路径一致：先过 schema，再过服务端归一化规则。
 */
function parsed(overrides: Partial<FollowUpInput> = {}): FollowUpData {
  const result = followUpParseSchema.safeParse({
    schema_version: '1.0',
    data: validFollowUp(overrides),
  })
  if (!result.success) throw new Error(`夹具不合法：${result.error.message}`)
  return result.data.data
}

describe('追问 schema', () => {
  it('接受合法的追问信封', () => {
    const result = followUpParseSchema.safeParse({
      schema_version: '1.0',
      data: validFollowUp(),
    })
    expect(result.success).toBe(true)
  })

  it('接受 next_question 且 follow_up 为 null', () => {
    const result = followUpParseSchema.safeParse({
      schema_version: '1.0',
      data: validFollowUp({ action: 'next_question', follow_up: null, reason: 'good_enough' }),
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.data.follow_up).toBe('')
  })

  it('拒绝非法 action', () => {
    const result = followUpParseSchema.safeParse({
      schema_version: '1.0',
      data: { ...validFollowUp(), action: 'ask_again' },
    })
    expect(result.success).toBe(false)
  })

  it('拒绝非法 reason', () => {
    const result = followUpParseSchema.safeParse({
      schema_version: '1.0',
      data: { ...validFollowUp(), reason: 'unclear' },
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 focus（追问必须给出依据）', () => {
    const { focus: _omitted, ...rest } = validFollowUp()
    const result = followUpParseSchema.safeParse({ schema_version: '1.0', data: rest })
    expect(result.success).toBe(false)
  })

  it('拒绝多余字段', () => {
    const result = followUpParseSchema.safeParse({
      schema_version: '1.0',
      data: { ...validFollowUp(), score: 5 },
    })
    expect(result.success).toBe(false)
  })

  it('拒绝缺少 schema_version', () => {
    expect(followUpParseSchema.safeParse({ data: validFollowUp() }).success).toBe(false)
  })
})

describe('追问归一化（服务端规则）', () => {
  it('合法追问原样通过', () => {
    const result = normalizeFollowUp(parsed())
    expect(result.action).toBe('follow_up')
    expect(result.adjusted).toBe(false)
  })

  it('action=follow_up 但内容为空 → 降级为 next_question', () => {
    const result = normalizeFollowUp(parsed({ follow_up: '' }))
    expect(result.action).toBe('next_question')
    expect(result.adjusted).toBe(true)
    expect(result.adjustReason).toContain('降级')
  })

  it('action=next_question 但带追问 → 丢弃追问', () => {
    const result = normalizeFollowUp(parsed({ action: 'next_question', reason: 'good_enough', follow_up: '\u591a\u4f59\u7684\u95ee\u9898' }))
    expect(result.action).toBe('next_question')
    expect(result.followUp).toBe('')
    expect(result.adjusted).toBe(true)
  })

  it('追问命中敏感词 → 降级为 next_question', () => {
    const result = normalizeFollowUp(parsed({ follow_up: '\u4f60\u4eca\u5e74\u591a\u5927\u4e86\uff1f' }))
    expect(result.action).toBe('next_question')
    expect(result.followUp).toBe('')
    expect(result.adjusted).toBe(true)
    expect(result.adjustReason).toContain('敏感')
  })

  it('追问命中录用建议类表述 → 降级', () => {
    const result = normalizeFollowUp(parsed({ follow_up: '\u4f60\u89c9\u5f97\u4f60\u4f1a\u88ab\u6dd8\u6c70\u5417\uff1f' }))
    expect(result.action).toBe('next_question')
    expect(result.adjusted).toBe(true)
  })
})

describe('提示 schema 与合规', () => {
  it('接受合法提示', () => {
    const result = hintParseSchema.safeParse({
      schema_version: '1.0',
      data: { hint: '可以从背景、做法、结果三块组织回答。' },
    })
    expect(result.success).toBe(true)
  })

  it('拒绝超长提示', () => {
    const result = hintParseSchema.safeParse({
      schema_version: '1.0',
      data: { hint: 'x'.repeat(201) },
    })
    expect(result.success).toBe(false)
  })

  it('isHintAcceptable 拦截敏感与禁止项', () => {
    expect(isHintAcceptable('可以从背景、做法、结果三块组织回答。')).toBe(true)
    expect(isHintAcceptable('短')).toBe(false)
    expect(isHintAcceptable('可以说你 28 岁，精力充沛。')).toBe(false)
    expect(isHintAcceptable('建议强调自己性格稳定、诚信可靠。')).toBe(false)
  })
})

describe('prompt 组装', () => {
  it('追问 prompt 注入问题、上下文与回答，并声明层数', () => {
    const prompt = buildFollowUpPrompt({
      question: '请介绍一次性能优化经历',
      answer: '做过一些优化',
      context: '岗位硬性要求：熟悉 PostgreSQL',
      depth: 1,
    })

    expect(prompt.user).toContain('请介绍一次性能优化经历')
    expect(prompt.user).toContain('做过一些优化')
    expect(prompt.user).toContain('熟悉 PostgreSQL')
    expect(prompt.system).toContain('已追问 1 层')
    expect(prompt.system).toContain('2 层')
  })

  it('too_short 时 prompt 追加确定性约束', () => {
    const prompt = buildFollowUpPrompt({
      question: 'Q',
      answer: '嗯',
      context: '',
      depth: 0,
      forcedReason: 'too_short',
    })
    expect(prompt.system).toContain('过短')
  })

  it('提示 prompt 列出期望要点且禁止给答案', () => {
    const prompt = buildHintPrompt({
      question: '请介绍一次性能优化经历',
      expectedPoints: ['说明背景', '给出量化结果'],
    })
    expect(prompt.user).toContain('说明背景')
    expect(prompt.system).toContain('不要给出完整答案')
  })
})
