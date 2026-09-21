import { describe, expect, it } from 'vitest'

import type { JdData, ResumeData } from '@/lib/ai/schemas/parse'
import { matchResumeToJd } from '@/lib/services/match-service'

import { FakeLlm, llmUnavailableError } from '../helpers/fakes'

/**
 * 匹配分析单测。
 *
 * 该能力位于 lib/services/match-service.ts（独立于解析服务），
 * 因此这里不需要对象存储替身 —— 它只依赖 LLM 端口。
 */

function jdData(): JdData {
  return {
    title: 'AI Backend Engineer',
    company: 'Example Tech',
    must_have: ['3+ years Node.js'],
    nice_to_have: [],
    responsibilities: ['build backend services'],
    keywords: ['TypeScript'],
  }
}

function resumeData(): ResumeData {
  return {
    name: 'Zhang Wei',
    years: 3,
    skills: ['TypeScript', 'PostgreSQL'],
    projects: [
      {
        name: 'AI Interview Platform',
        role: 'Backend Engineer',
        actions: ['built the scoring service'],
        results: ['P95 latency reduced'],
        evidence: ['built the scoring service'],
      },
    ],
    education: [],
    risks: [],
  }
}

function validMatch() {
  return {
    schema_version: '1.0',
    data: {
      match_score: 75,
      advantages: [{ point: 'TypeScript 匹配', evidence: 'built the scoring service' }],
      gaps: ['简历中未提及 Kubernetes'],
      suggested_questions: [{ question: '请介绍一次性能优化经历', based_on: 'advantage' }],
    },
  }
}

describe('匹配分析', () => {
  it('正常返回并保留六维之外的匹配度', async () => {
    const llm = FakeLlm.always(validMatch())
    const result = await matchResumeToJd({ llm }, { jd: jdData(), resume: resumeData() })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.match_score).toBe(75)
      expect(result.data.advantages).toHaveLength(1)
      expect(result.meta.attempts).toBe(1)
      expect(result.model).toBe('fake-model')
    }
  })

  it('越界 match_score → 校验失败', async () => {
    const llm = FakeLlm.always({
      ...validMatch(),
      data: { ...validMatch().data, match_score: 150 },
    })
    const result = await matchResumeToJd({ llm }, { jd: jdData(), resume: resumeData() })
    expect(result.ok).toBe(false)
  })

  it('非法 based_on 取值 → 校验失败', async () => {
    const llm = FakeLlm.always({
      ...validMatch(),
      data: {
        ...validMatch().data,
        suggested_questions: [{ question: 'Q', based_on: 'unknown' }],
      },
    })
    const result = await matchResumeToJd({ llm }, { jd: jdData(), resume: resumeData() })
    expect(result.ok).toBe(false)
  })

  it('LLM 未配置 → ai_misconfigured（重试无用，需改配置）', async () => {
    const llm = new FakeLlm([{ type: 'error', error: llmUnavailableError() }])
    const result = await matchResumeToJd({ llm }, { jd: jdData(), resume: resumeData() })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('ai_misconfigured')
  })

  it('后置过滤剔除敏感内容，并记入低置信字段', async () => {
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: {
        match_score: 60,
        advantages: [
          { point: '技术栈匹配', evidence: 'TypeScript' },
          { point: '年龄合适', evidence: '28 岁' },
        ],
        gaps: ['简历中未提及分布式经验', '性格不稳定'],
        suggested_questions: [
          { question: '请介绍一次性能优化经历', based_on: 'advantage' },
          { question: '你打算什么时候结婚', based_on: 'gap' },
        ],
      },
    })

    const result = await matchResumeToJd({ llm }, { jd: jdData(), resume: resumeData() })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.advantages).toHaveLength(1)
      expect(result.data.gaps).toEqual(['简历中未提及分布式经验'])
      expect(result.data.suggested_questions).toHaveLength(1)
      expect(result.dropped.length).toBeGreaterThanOrEqual(3)
      expect(result.meta.low_confidence_fields.length).toBeGreaterThan(0)
    }
  })
})
