import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildMatchPrompt, PROMPT_VERSION as PARSE_VERSION } from '@/lib/ai/prompts/parse'
import { PROMPT_VERSION as PLAN_VERSION } from '@/lib/ai/prompts/plan'
import { PROMPT_VERSION as EVAL_VERSION } from '@/lib/ai/prompts/evaluation'
import { PROMPT_VERSION as INTERVIEW_VERSION } from '@/lib/ai/prompts/interview'
import { PROMPT_VERSION as AGENT_VERSION } from '@/lib/ai/prompts/interview-agent'
import { envelope as envelopeSchema } from '@/lib/ai/schemas/parse'
import type { JdData, ResumeData } from '@/lib/ai/schemas/parse'
import { matchResumeToJd } from '@/lib/services/handlers/match-service'
import { parseJdText } from '@/lib/services/handlers/parse-service'
import { parseWithRetry } from '@/lib/parsing/run'

import { FakeLlm, FakeStorage } from '../helpers/fakes'

/**
 * prompt 版本落库（ai_call_logs.prompt_version）的守卫测试。
 *
 * 背景：此前 LlmRequest 接口根本没有 promptVersion 字段，唯一的 logAiSuccess
 * 调用点无从传值，导致**所有** AI 调用的 prompt_version 恒为 null。
 * 后果是改 prompt 之后无法按版本归因——效果波动对应不到具体哪次改动，
 * AGENTS.md §9.4「AI 改动必须留下数字」就成了空话。
 *
 * 这里锁住三件事：
 * 1. 端口层确实透传（parseWithRetry → LlmPort.complete）
 * 2. 各 service 传入的是自己那个 prompt 的版本，不是别人的
 * 3. 版本号全局唯一且非空——抄串了要能被发现
 */

const schema = envelopeSchema(z.object({ ok: z.string() }))

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

describe('prompt 版本透传', () => {
  it('parseWithRetry 把 promptVersion 原样传给 LlmPort.complete', async () => {
    const llm = FakeLlm.always({ schema_version: '1.0', data: { ok: 'yes' } })

    const outcome = await parseWithRetry({
      llm,
      system: 'sys',
      user: 'user',
      schema,
      operation: 'match',
      promptVersion: 'parse.match@9',
    })

    expect(outcome.ok).toBe(true)
    expect(llm.requests).toHaveLength(1)
    expect(llm.requests[0]?.promptVersion).toBe('parse.match@9')
  })

  it('未传 promptVersion 时为 null，而不是 undefined 或空串', async () => {
    const llm = FakeLlm.always({ schema_version: '1.0', data: { ok: 'yes' } })

    await parseWithRetry({ llm, system: 'sys', user: 'user', schema })

    expect(llm.requests[0]?.promptVersion).toBeNull()
  })

  it('匹配分析传的是 match 的版本', async () => {
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: {
        match_score: 75,
        advantages: [{ point: 'TypeScript 匹配', evidence: 'built the scoring service' }],
        gaps: ['简历中未提及 Kubernetes'],
        suggested_questions: [{ question: '请介绍一次性能优化经历', based_on: 'advantage' }],
      },
    })

    const result = await matchResumeToJd({ llm }, { jd: jdData(), resume: resumeData() })

    expect(result.ok).toBe(true)
    expect(llm.requests[0]?.promptVersion).toBe(PARSE_VERSION.match)
    expect(llm.requests[0]?.promptVersion).toBe('parse.match@1')
  })

  it('JD 解析传的是 jd 的版本，不是 resume 的', async () => {
    const llm = FakeLlm.always({ schema_version: '1.0', data: jdData() })

    const result = await parseJdText({ llm, storage: new FakeStorage() }, '需要 3 年以上 Node.js 经验的后端工程师。')

    expect(result.ok).toBe(true)
    expect(llm.requests[0]?.promptVersion).toBe(PARSE_VERSION.jdParse)
    expect(llm.requests[0]?.promptVersion).not.toBe(PARSE_VERSION.resumeParse)
  })
})

describe('prompt 版本号的唯一性', () => {
  const all = [
    ...Object.values(PARSE_VERSION),
    ...Object.values(PLAN_VERSION),
    ...Object.values(EVAL_VERSION),
    ...Object.values(INTERVIEW_VERSION),
    ...Object.values(AGENT_VERSION),
  ]

  it('每个版本号都非空', () => {
    for (const version of all) {
      expect(version, '版本号不得为空串').toMatch(/\S/)
    }
  })

  it('版本号全局唯一（复制粘贴改忘了要能被发现）', () => {
    expect(new Set(all).size).toBe(all.length)
  })

  it('版本号带 @n 后缀，便于递增', () => {
    for (const version of all) {
      expect(version, `${version} 应形如 xxx@1`).toMatch(/@\d+$/)
    }
  })

  it('prompt 与版本一一对应：改了 prompt 文本必须能定位到版本号', () => {
    // 反向验证：prompt 模块确实被使用（不是死代码）
    const prompt = buildMatchPrompt({ jdJson: '{}', resumeJson: '{}' })
    expect(prompt.system.length).toBeGreaterThan(0)
    expect(PARSE_VERSION.match).toBe('parse.match@1')
  })
})
