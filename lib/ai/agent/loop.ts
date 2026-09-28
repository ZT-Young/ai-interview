import {
  buildInterviewAgentSystem,
  buildObservationMessage,
  PROMPT_VERSION,
} from '@/lib/ai/prompts/interview-agent'
import { agentStepParseSchema } from '@/lib/ai/schemas/interview-agent'
import { parseWithRetry } from '@/lib/parsing/run'
import type { LlmPort } from '@/lib/parsing/llm-port'

import { executeTool, TOOL_DESCRIPTIONS, type AgentContext, type ToolResult } from './tools'

export type { AgentContext, ToolResult }

/**
 * 面试官 Agent 循环 —— 「思考 → 调用工具 → 观察结果 → 再决策」。
 *
 * 与旧的单次调用（直接输出 decision）相比，模型多了两件事：
 * 1. **自主决定要看什么**（检索简历 / 检索 JD / 看历史 / 看已问题目），
 *    而不是被动接受一份固定拼好的上下文
 * 2. **基于检索结果修正判断**，最多 `maxRounds` 轮
 *
 * 护栏（模型**无法绕过**，全部由服务端强制）：
 * - 轮数上限：超过 `maxRounds` 仍未给出决策 → 判定失败，由调用方降级
 * - 工具白名单：schema 枚举限定，未知工具不会被执行
 * - 每轮输出必须落 schema（含 final / tool_calls 互斥约束）
 * - 最终决策仍要过 `normalizeFollowUp()` 的敏感词与后置校验
 */

/** 最多检索轮数：再多就是浪费，且说明模型在打转 */
export const MAX_AGENT_ROUNDS = 3

export interface AgentDecision {
  action: 'follow_up' | 'next_question'
  followUp: string
  reason: 'vague' | 'too_short' | 'off_topic' | 'good_enough'
  focus: string
}

export interface AgentRunSuccess {
  ok: true
  decision: AgentDecision
  /** 工具调用轨迹（可审计、可展示：模型到底看了什么） */
  toolTrace: ToolResult[]
  /** 实际轮数（1 = 直接决策，未用工具） */
  rounds: number
  /** 每轮的思考，用于调试与评测 */
  thoughts: string[]
  model: string
}

export interface AgentRunFailure {
  ok: false
  reason: 'agent_failed' | 'no_decision'
  toolTrace: ToolResult[]
  rounds: number
  thoughts: string[]
  detail?: string
}

export type AgentRunResult = AgentRunSuccess | AgentRunFailure

export interface AgentRunInput {
  llm: LlmPort
  context: AgentContext
  maxRounds?: number
  /** 已追问层数，仅用于提示模型（上限由调用方强制） */
  depth: number
}

export async function runInterviewAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const { llm, context, depth } = input
  const maxRounds = input.maxRounds ?? MAX_AGENT_ROUNDS

  const system = buildInterviewAgentSystem({ tools: TOOL_DESCRIPTIONS, depth, maxRounds })
  const toolTrace: ToolResult[] = []
  const thoughts: string[] = []
  let model = ''
  let lastDetail: string | undefined

  /** 累积的检索结果，作为下一轮的观察输入 */
  let observations = ''

  for (let round = 1; round <= maxRounds; round += 1) {
    const user = [
      `当前主问题：\n"""\n${context.mainQuestion}\n"""`,
      `候选人本次回答：\n"""\n${context.currentAnswer}\n"""`,
      observations.length > 0 ? `\n你此前检索到的信息：\n${observations}` : '',
      '\n请给出下一步：要么请求工具（tool_calls），要么给出最终决策（final）。',
    ]
      .filter((part) => part.length > 0)
      .join('\n')

    const outcome = await parseWithRetry({
      llm,
      operation: 'follow_up',
      system,
      user,
      schema: agentStepParseSchema,
      temperature: 0.4,
      promptVersion: PROMPT_VERSION.agent,
    })

    if (!outcome.ok) {
      lastDetail = outcome.violation ?? outcome.code
      // 输出不合规：降温重试已在 parseWithRetry 内做过，这里不再死循环
      continue
    }

    model = outcome.model
    const step = outcome.data.data
    thoughts.push(step.thought)

    // 已有最终决策 → 收敛
    if (step.final) {
      return {
        ok: true,
        decision: {
          action: step.final.action,
          followUp: (step.final.follow_up ?? '').trim(),
          reason: step.final.reason,
          focus: (step.final.focus ?? '').trim(),
        },
        toolTrace,
        rounds: round,
        thoughts,
        model,
      }
    }

    // 执行工具，把结果累加成下一轮的观察
    const rendered = step.tool_calls.map((call) => {
      const result = executeTool(call, context)
      toolTrace.push(result)
      return buildObservationMessage(result)
    })
    observations = `${observations}\n${rendered.join('\n')}`.trim()
  }

  return {
    ok: false,
    reason: toolTrace.length > 0 ? 'no_decision' : 'agent_failed',
    toolTrace,
    rounds: maxRounds,
    thoughts,
    detail: lastDetail,
  }
}
