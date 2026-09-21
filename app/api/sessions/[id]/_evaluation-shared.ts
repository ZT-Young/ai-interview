import { z } from 'zod'

import type { LlmPort } from '@/lib/parsing/llm-port'
import { OpenAiCompatibleLlm } from '@/lib/parsing/llm-port'

/**
 * 评分与报告路由的共用部分。
 *
 * 与解析/出题/编排一致：LLM 端口可注入，测试用 fake 覆盖，避免真实调用。
 * **评分与报告是本项目最贵的两次 LLM 调用**（逐题 + 汇总），
 * 因此端口注入对测试尤为重要。
 */

export interface EvaluationRoutePorts {
  llm: LlmPort
}

let portsOverride: EvaluationRoutePorts | undefined

export function __setEvaluationPortsForTest(ports: EvaluationRoutePorts | undefined): void {
  portsOverride = ports
}

export function resolveEvaluationPorts(): EvaluationRoutePorts {
  return portsOverride ?? { llm: new OpenAiCompatibleLlm() }
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
