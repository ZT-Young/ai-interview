import { z } from 'zod'

import { requireAdmin } from '@/lib/api/admin-guard'
import { apiHandler, ok, parseJsonBody } from '@/lib/api/respond'
import {
  adjustFreeCredits,
  MAX_FREE_CREDITS,
  MIN_FREE_CREDITS,
} from '@/lib/services/admin-service'

interface RouteContext {
  params: { id: string }
}

/** 只接受绝对值与原因；范围、目标存在性、审计全部在服务端处理 */
const bodySchema = z.object({
  freeCredits: z.number().int().min(MIN_FREE_CREDITS).max(MAX_FREE_CREDITS),
  reason: z.string().trim().min(1).max(200),
})

/**
 * POST /api/admin/users/:id/credits —— 手动调整免费次数。
 *
 * **敏感操作**：服务端校验范围 + 写入审计日志（含调整前后值与原因）。
 * 不提供任何批量修改或自我修改的接口，避免误操作与提权。
 */
export const POST = apiHandler(async (request: Request, context: RouteContext) => {
  const admin = await requireAdmin()
  const input = await parseJsonBody(request, bodySchema)

  const result = await adjustFreeCredits(admin.id, {
    userId: context.params.id,
    freeCredits: input.freeCredits,
    reason: input.reason,
  })

  return ok(result)
})

export const dynamic = 'force-dynamic'
