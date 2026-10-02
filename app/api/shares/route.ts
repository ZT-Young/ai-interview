import { apiHandler, created, ok, parseJsonBody } from '@/lib/api/respond'
import { requireUser } from '@/lib/api/guard'
import { createLinkShare, listCandidateShares } from '@/lib/services/handlers/share-service'
import { createLinkShareSchema } from '@/lib/validators/share'

/**
 * POST /api/shares —— 候选人创建「链接分享」。
 *
 * 响应里返回的 `token` **只出现这一次**，服务端只存 sha256 哈希。
 * 遗失令牌的唯一补救方式是撤销后重新生成 —— 这是有意为之：
 * 令牌必须无法从服务端还原，否则库一旦泄露所有分享链接同时失守。
 */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJsonBody(request, createLinkShareSchema)
  const result = await createLinkShare(user.id, input)
  return created({ share: result.share, token: result.token })
})

/** GET /api/shares —— 我发出的分享 + 待我处理的邀请 */
export const GET = apiHandler(async () => {
  const user = await requireUser()
  const result = await listCandidateShares(user.id)
  return ok(result)
})

export const dynamic = 'force-dynamic'
