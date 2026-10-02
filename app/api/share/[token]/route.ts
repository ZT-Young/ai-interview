import { NextResponse } from 'next/server'

import { apiHandler, ok } from '@/lib/api/respond'
import { requestContext } from '@/lib/api/guard'
import { readSharedByToken } from '@/lib/services/handlers/share-service'
import { shareAccessQuerySchema } from '@/lib/validators/share'

interface RouteContext {
  params: { token: string }
}

/**
 * GET /api/share/:token —— **无需登录**，凭令牌读取候选人主动分享的报告。
 *
 * 这是全站少数几个「匿名可读」的端点，因此判定格外苛刻：
 * 令牌不存在 / 已过期 / 已撤销 / 访问码不对，**一律返回同一个 404**，
 * 不告诉试探者到底是哪一步错了（与全项目「越权返回 404」同一口径）。
 */
export const GET = apiHandler(async (request: Request, context: RouteContext) => {
  const url = new URL(request.url)
  const query = shareAccessQuerySchema.safeParse({
    code: url.searchParams.get('code') ?? undefined,
  })
  // 查询参数非法时按「访问码不对」处理，同样不给额外信息
  const code = query.success ? query.data.code : undefined
  const ctx = requestContext(request)

  const payload = await readSharedByToken(context.params.token, {
    accessCode: code,
    ip: ctx.ip ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
  })

  return ok(payload)
})

export const dynamic = 'force-dynamic'

export function POST(): NextResponse {
  return NextResponse.json(
    { error: { code: 'not_found', message: '请使用 GET /api/share/:token' } },
    { status: 405 },
  )
}
