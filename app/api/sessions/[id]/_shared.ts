import { z } from 'zod'

import type { LlmPort } from '@/lib/parsing/llm-port'
import { OpenAiCompatibleLlm } from '@/lib/parsing/llm-port'
import type { OrchestrationPorts } from '@/lib/services/orchestration-service'

/**
 * 面试编排路由的共用部分。
 *
 * 与解析/出题保持一致：LLM 端口可注入，测试用 fake 覆盖，
 * 避免真实调用（AGENTS.md §4：复杂 AI 逻辑只在 lib/ai 与其服务层）。
 */

let portsOverride: OrchestrationPorts | undefined

export function __setOrchestrationPortsForTest(ports: OrchestrationPorts | undefined): void {
  portsOverride = ports
}

export function resolveOrchestrationPorts(): OrchestrationPorts {
  return portsOverride ?? { llm: new OpenAiCompatibleLlm() }
}

export interface SessionRouteContext {
  params: { id: string }
}

export const submitBodySchema = z.object({
  /** 回答 / 跳过 / 请求提示 */
  action: z.enum(['answer', 'skip', 'hint']).optional().default('answer'),
  /** 不传则使用会话当前的 currentQuestionId */
  questionId: z.string().uuid().optional(),
  content: z.string().max(10_000).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
})

export type LlmOnlyPorts = { llm: LlmPort }
