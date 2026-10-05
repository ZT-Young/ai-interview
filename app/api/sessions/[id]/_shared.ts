import { z } from 'zod'

import type { LlmPort } from '@/lib/parsing/llm-port'
import { OpenAiCompatibleLlm } from '@/lib/parsing/llm-port'
import type { OrchestrationPorts } from '@/lib/services/handlers/orchestration-service'

/**
 * 面试编排路由的共用部分。
 *
 * 复杂 AI 逻辑只在 lib/ai 与其服务层（AGENTS.md §4），路由只负责取默认端口并转发。
 */

/**
 * 生产环境端口。
 *
 * 这里曾经留过 `portsOverride` + `__setOrchestrationPortsForTest`，实际**无人调用**
 * （`?? ` 右支永远走不到），已删除 —— 与 `plan/route.ts` 的处理保持一致。
 * 需要替换实现时改这一处即可。
 */
export function resolveOrchestrationPorts(): OrchestrationPorts {
  return { llm: new OpenAiCompatibleLlm() }
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
