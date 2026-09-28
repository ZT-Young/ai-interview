import { describe, expect, it } from 'vitest'

import { runInterviewAgent, MAX_AGENT_ROUNDS } from '@/lib/ai/agent/loop'
import { executeTool, type AgentContext } from '@/lib/ai/agent/tools'
import { agentStepParseSchema } from '@/lib/ai/schemas/interview-agent'
import { SCHEMA_VERSION } from '@/lib/ai/schemas/parse'
import type { LlmPort, LlmRequest, LlmResponse } from '@/lib/parsing/llm-port'

/**
 * 面试官 Agent 的离线测试（注入 fake LLM，不调用真实模型）。
 *
 * 覆盖三件事，缺一不可：
 * 1. 工具执行是否安全（未知工具不崩、无数据有兜底）
 * 2. 循环能否收敛（该用工具时用、用完能收、卡住时不死循环）
 * 3. schema 的互斥约束（final 与 tool_calls 不能同时出现）
 */

const RESUME = {
  name: '候选人 A',
  skills: ['JMeter 并发压测', 'Selenium 自动化', 'LLM 幻觉检测'],
  projects: [{ name: 'AI 智能客服', highlights: ['设计 80+ 测试用例', '回归脚本缩减率 45%'] }],
}

const JD = {
  must_have: ['有 LLM / Agent 应用测试经验'],
  responsibilities: ['设计并执行幻觉与 Prompt 鲁棒性专项测试'],
}

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    resume: RESUME,
    jd: JD,
    mainQuestion: '说说你为 AI 客服设计的测试用例',
    currentAnswer: '我设计了 80 多个用例，覆盖幻觉和多轮对话。',
    history: [{ question: '说说你为 AI 客服设计的测试用例', answer: '我设计了 80 多个用例。', depth: 0 }],
    askedQuestions: ['自我介绍', '说说你为 AI 客服设计的测试用例'],
    ...overrides,
  }
}

/** 按脚本顺序返回响应的 fake LLM */
class ScriptedLlm implements LlmPort {
  calls: string[] = []

  constructor(private readonly responses: Array<unknown | Error>) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request.user)
    // 耗尽后重复最后一条：parseWithRetry 内部有 2 次尝试，脚本长度不易对齐
    const next = this.responses.length > 1 ? this.responses.shift() : this.responses[0]
    if (next instanceof Error) throw next
    return { content: JSON.stringify(next), model: 'fake-model' }
  }
}

function envelope(data: unknown) {
  return { schema_version: SCHEMA_VERSION, data }
}

function step(payload: Record<string, unknown>) {
  return envelope({ thought: '思考', tool_calls: [], final: null, ...payload })
}

describe('工具执行', () => {
  it('按关键词检索简历，命中即返回片段', () => {
    const result = executeTool({ name: 'search_resume', argument: '幻觉' }, context())

    expect(result.ok).toBe(true)
    expect(result.output).toContain('幻觉检测')
  })

  it('关键词无命中时退回简历摘要，而不是返回空（模型需要兜底信息）', () => {
    const result = executeTool({ name: 'search_resume', argument: '量子计算' }, context())

    expect(result.ok).toBe(true)
    expect(result.output).toContain('候选人 A')
  })

  it('未关联简历时明确告知，不编造', () => {
    const result = executeTool({ name: 'search_resume', argument: '' }, context({ resume: null }))
    expect(result.output).toContain('未关联简历')
  })

  it('检索 JD 命中硬性要求', () => {
    const result = executeTool({ name: 'search_jd', argument: '幻觉' }, context())
    expect(result.output).toContain('幻觉')
  })

  it('历史问答与已问题目可读', () => {
    expect(executeTool({ name: 'recent_answers', argument: '' }, context()).output).toContain('80 多个用例')
    expect(executeTool({ name: 'asked_questions', argument: '' }, context()).output).toContain('自我介绍')
  })

  it('未知工具不抛异常，转成可回灌的失败观察', () => {
    const result = executeTool({ name: 'not_a_tool' as never, argument: '' }, context())

    expect(result.ok).toBe(false)
    expect(result.output).toContain('未知工具')
  })
})

describe('Agent 循环', () => {
  it('先检索再决策：执行工具并把结果回灌到下一轮', async () => {
    const llm = new ScriptedLlm([
      step({ tool_calls: [{ name: 'search_resume', argument: '幻觉' }] }),
      step({
        final: {
          action: 'follow_up',
          follow_up: '你说覆盖幻觉，具体是怎么判定一条输出属于幻觉的？',
          reason: 'vague',
          focus: '我设计了 80 多个用例，覆盖幻觉和多轮对话',
        },
      }),
    ])

    const result = await runInterviewAgent({ llm, context: context(), depth: 0 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rounds).toBe(2)
    expect(result.toolTrace).toHaveLength(1)
    expect(result.toolTrace[0].name).toBe('search_resume')
    expect(result.decision.action).toBe('follow_up')
    // 检索结果必须出现在第二轮的输入里，否则「工具白调了」
    expect(llm.calls[1]).toContain('幻觉检测')
  })

  it('不需要工具时直接决策，rounds = 1', async () => {
    const llm = new ScriptedLlm([
      step({ final: { action: 'next_question', follow_up: null, reason: 'good_enough', focus: '' } }),
    ])

    const result = await runInterviewAgent({ llm, context: context(), depth: 0 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rounds).toBe(1)
    expect(result.toolTrace).toHaveLength(0)
    expect(result.decision.action).toBe('next_question')
  })

  it('一直不收敛时按轮数上限停止，不无限循环', async () => {
    const llm = new ScriptedLlm([
      step({ tool_calls: [{ name: 'search_jd', argument: '要求' }] }),
      step({ tool_calls: [{ name: 'search_resume', argument: '项目' }] }),
      step({ tool_calls: [{ name: 'recent_answers', argument: '' }] }),
    ])

    const result = await runInterviewAgent({ llm, context: context(), depth: 0 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no_decision')
    expect(result.rounds).toBe(MAX_AGENT_ROUNDS)
    expect(result.toolTrace).toHaveLength(MAX_AGENT_ROUNDS)
  })

  it('模型输出始终不合法时不抛异常，返回 agent_failed', async () => {
    const llm = new ScriptedLlm([
      '这不是 JSON',
      envelope({ thought: 'x', tool_calls: [], final: null }),
      '仍然不是 JSON',
    ])

    const result = await runInterviewAgent({ llm, context: context(), depth: 0 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('agent_failed')
  })

  it('决策结果带上思考轨迹，便于审计与调试', async () => {
    const llm = new ScriptedLlm([
      step({ thought: '先确认简历里的项目细节', tool_calls: [{ name: 'search_resume', argument: '智能客服' }] }),
      step({ thought: '回答缺少判定方法，追问', final: { action: 'follow_up', follow_up: '怎么判定的？', reason: 'vague', focus: '覆盖幻觉' } }),
    ])

    const result = await runInterviewAgent({ llm, context: context(), depth: 1 })

    expect(result.thoughts).toEqual(['先确认简历里的项目细节', '回答缺少判定方法，追问'])
  })
})

describe('Agent step schema', () => {
  it('final 与 tool_calls 同时出现 → 拒绝（否则循环无法收敛）', () => {
    const payload = step({
      tool_calls: [{ name: 'search_resume', argument: '' }],
      final: { action: 'next_question', follow_up: null, reason: 'good_enough', focus: '' },
    })

    expect(agentStepParseSchema.safeParse(payload).success).toBe(false)
  })

  it('两者都为空 → 拒绝（模型卡住时必须重试，不能静默推进）', () => {
    expect(agentStepParseSchema.safeParse(step({})).success).toBe(false)
  })

  it('未知工具名 → 拒绝（工具白名单在 schema 层就收紧）', () => {
    const payload = step({ tool_calls: [{ name: 'drop_database', argument: '' }] })
    expect(agentStepParseSchema.safeParse(payload).success).toBe(false)
  })

  it('合法的工具请求与合法的最终决策都能通过', () => {
    expect(
      agentStepParseSchema.safeParse(step({ tool_calls: [{ name: 'search_jd', argument: '要求' }] })).success,
    ).toBe(true)
    expect(
      agentStepParseSchema.safeParse(
        step({
          final: { action: 'follow_up', follow_up: '具体怎么做的？', reason: 'vague', focus: '我做了测试' },
        }),
      ).success,
    ).toBe(true)
  })
})
