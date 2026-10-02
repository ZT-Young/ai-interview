import { apiHandler, ok } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { readSharedForInterviewer } from '@/lib/services/handlers/share-service'

interface RouteContext {
  params: { id: string }
}

/**
 * GET /api/interviewer/shares/:id —— 面试官读取**被授权给自己的**报告。
 *
 * 与 `GET /api/share/:token`（匿名凭令牌）的区别：
 * 这里校验的是「当前登录用户 = `report_shares.invitee_user_id`」。
 * 少了这一步，邀请链接被转发后任何人都能看到候选人报告。
 */
export const GET = apiHandler(async (_request: Request, context: RouteContext) => {
  const user = await requireUser()
  const payload = await readSharedForInterviewer(user.id, context.params.id)
  return ok(payload)
})

export const dynamic = 'force-dynamic'
