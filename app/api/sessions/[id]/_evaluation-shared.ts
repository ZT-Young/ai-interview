import { z } from 'zod'

import type { LlmPort } from '@/lib/parsing/llm-port'
import { OpenAiCompatibleLlm } from '@/lib/parsing/llm-port'

/**
 * 评分与报告路由的共用部分。
 *
 * **评分与报告是本项目最贵的两次 LLM 调用**（逐题 + 汇总）。
 */

export interface EvaluationRoutePorts {
  llm: LlmPort
}

/**
 * 生产环境端口。
 *
 * 这里曾经留过 `portsOverride` + `__setEvaluationPortsForTest`，实际**无人调用**
 * （`?? ` 右支永远走不到），已删除 —— 与 `plan/route.ts` 的处理保持一致。
 * 需要替换实现时改这一处即可。
 */
export function resolveEvaluationPorts(): EvaluationRoutePorts {
  return { llm: new OpenAiCompatibleLlm() }
}

export interface SessionRouteContext {
  params: { id: string }
}

export const evaluateBodySchema = z.object({
  /** 不传则对全部「已作答但未评分」的题目评分 */
  questionId: z.string().uuid().optional(),
  regenerate: z.boolean().optional().default(false),
})

export const reportBodySchema = z.object({
  regenerate: z.boolean().optional().default(false),
})
