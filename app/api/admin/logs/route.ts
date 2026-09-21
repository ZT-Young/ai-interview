import { z } from 'zod'

import { requireAdmin } from '@/lib/api/admin-guard'
import { validationError } from '@/lib/api/errors'
import { apiHandler, ok } from '@/lib/api/respond'
import { listAiLogs } from '@/lib/services/admin-service'

const querySchema = z.object({
  status: z.enum(['success', 'error']).optional(),
})

/**
 * GET /api/admin/logs —— AI 调用日志与错误日志（同一张表）。
 *
 * `?status=error` 只看失败调用。日志内容已在写入侧脱敏（不含 prompt 与原文）。
 */
export const GET = apiHandler(async (request: Request) => {
  await requireAdmin()

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
  })

  if (!parsed.success) throw validationError('status 只能是 success 或 error')

  const logs = await listAiLogs(parsed.data)
  return ok({ logs, total: logs.length })
})

export const dynamic = 'force-dynamic'
