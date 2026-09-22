import { requireUser } from '@/lib/api/guard'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { submitAnswer } from '@/lib/services/handlers/orchestration-service'

import {
  resolveOrchestrationPorts,
  submitBodySchema,
  type SessionRouteContext,
} from '../_shared'

/**
 * POST /api/sessions/:id/answers —— 提交回答 / 跳过 / 请求提示。
 *
 * 行为：
 * - `action: "answer"`（默认）：写入 answers + interview_messages，
 *   然后由服务端决定「追问」还是「下一题」。**层数上限由服务端强制**。
 * - `action: "skip"`：不写 answers，记录跳过消息并推进到下一题。
 * - `action: "hint"`：生成提示（不给答案），停留在当前题。
 *
 * 返回体中的 `message` 最多 1 条提问/追问 —— 保证「一次只问一个问题」。
 */
export const POST = apiHandler(async (request: Request, context: SessionRouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, submitBodySchema)

  const result = await submitAnswer(
    user.id,
    context.params.id,
    {
      action: input.action,
      questionId: input.questionId,
      content: input.content,
      durationMs: input.durationMs,
    },
    resolveOrchestrationPorts(),
  )

  return ok(result)
})

export const dynamic = 'force-dynamic'
