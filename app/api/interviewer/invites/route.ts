import { apiHandler, created, ok, parseJsonBody } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { createInvite, listSharedWithMe } from '@/lib/services/handlers/share-service'
import { createInviteSchema } from '@/lib/validators/share'

/**
 * POST /api/interviewer/invites —— 面试官向候选人发起查看邀请。
 *
 * **本路由只创建一个 pending 请求，不产生任何可读数据。**
 * 候选人接受后才有内容可读（见 INTERVIEWER_SIDE §4.1）。
 *
 * 查不到该候选人时返回 422（而非 404 + 详情），避免把「这个邮箱注册过吗」
 * 变成可枚举的信息。
 */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, createInviteSchema)
  const share = await createInvite(user.id, input)
  return created({ share })
})

/** GET /api/interviewer/invites —— 我发出的邀请及其状态 */
export const GET = apiHandler(async () => {
  const user = await requireUser()
  const shares = await listSharedWithMe(user.id)
  return ok({ shares })
})

export const dynamic = 'force-dynamic'
