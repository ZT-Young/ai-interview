import { z } from 'zod'

import { envelope } from './parse'

/**
 * 面试官 Agent 的结构化契约 —— docs/engineering/AI_PROMPTS.md §5.6 的代码实现。
 *
 * 与旧链路（单次调用直接输出 decision）的区别：
 * 模型可以**先检索再决策**，一轮输出要么是要调的工具、要么是最终决策，
 * 由服务端执行工具并把结果回灌，最多 `MAX_AGENT_ROUNDS` 轮。
 *
 * 为什么用「结构化 tool_calls」而不是供应商的 function calling：
 * - 不依赖供应商能力（DeepSeek / Qwen / GPT 的 tools 支持程度不一），换模型零成本
 * - 工具调用与思考过程都在**同一份 schema 内**，可校验、可限速、可落审计
 * - 现有的 `parseWithRetry`（schema 校验 + 降温重试）可以直接复用
 */

export const AGENT_TOOL_NAMES = [
  'search_resume',
  'search_jd',
  'recent_answers',
  'asked_questions',
] as const
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]

export const agentToolCallSchema = z
  .object({
    name: z.enum(AGENT_TOOL_NAMES),
    /** 检索关键词；不需要参数的工具传空字符串 */
    argument: z.string().max(100),
  })
  .strict()

export const agentFinalSchema = z
  .object({
    action: z.enum(['follow_up', 'next_question']),
    follow_up: z.string().max(300).nullable(),
    reason: z.enum(['vague', 'too_short', 'off_topic', 'good_enough']),
    focus: z.string().max(300).nullable(),
  })
  .strict()

export const agentStepDataSchema = z
  .object({
    /** 简短推理：为什么需要这个工具 / 为什么这样决策（用于审计与调试） */
    thought: z.string().max(300),
    tool_calls: z.array(agentToolCallSchema).max(2),
    /** 最终决策；未准备好时为 null */
    final: agentFinalSchema.nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasFinal = data.final !== null
    const hasCalls = data.tool_calls.length > 0

    // 互斥：给出最终决策时不应还在要工具，否则循环无法收敛
    if (hasFinal && hasCalls) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'final 与 tool_calls 互斥：给出最终决策时不应再请求工具',
        path: ['tool_calls'],
      })
    }
    // 两者都空 = 模型卡住了，必须重试而不是静默推进
    if (!hasFinal && !hasCalls) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '必须给出最终决策，或至少请求一个工具',
        path: ['final'],
      })
    }
  })

export const agentStepParseSchema = envelope(agentStepDataSchema)
export type AgentStepData = z.infer<typeof agentStepDataSchema>
export type AgentToolCall = z.infer<typeof agentToolCallSchema>
export type AgentFinal = z.infer<typeof agentFinalSchema>
