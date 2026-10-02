import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { acceptInvite, revokeShare } from '@/lib/services/handlers/share-service'
import { acceptInviteSchema } from '@/lib/validators/share'

interface RouteContext {
  params: { id: string }
}

/**
 * POST /api/shares/:id/accept —— 候选人接受邀请。
 *
 * **这一步才真正产生授权**：面试官发起时并不知道候选人练过哪场，
 * 因此由候选人在接受时自选要分享哪一场面试（`sessionId`）与可见范围。
 * 在此之前数据库里没有任何可读内容（见 INTERVIEWER_SIDE §4.1）。
 */
export const POST = apiHandler(async (request: Request, context: RouteContext) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, acceptInviteSchema)
  const share = await acceptInvite(user.id, context.params.id, input)
  return ok({ share })
})

/**
 * DELETE /api/shares/:id —— 撤销已生效的分享，或拒绝待确认的邀请。
 *
 * 同一个接口不区分两种场景是有意的：对候选人来说撤销的语义就是「我不想给了」，
 * 至于那条记录处在 pending 还是 active，由服务层决定落到 declined 还是 revoked。
 */
export const DELETE = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const share = await revokeShare(user.id, context.params.id)
  return ok({ share })
})

export const dynamic = 'force-dynamic'
