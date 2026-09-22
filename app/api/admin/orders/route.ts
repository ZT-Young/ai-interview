import { requireAdmin } from '@/lib/api/admin-guard'
import { apiHandler, ok } from '@/lib/api/respond'
import { listAllOrders } from '@/lib/services/handlers/admin-service'

/**
 * GET /api/admin/orders —— 全部订单。
 *
 * 不返回渠道订单号（可用于对账的标识），避免无关人员获取。
 */
export const GET = apiHandler(async () => {
  await requireAdmin()
  const orders = await listAllOrders()
  return ok({ orders, total: orders.length })
})

export const dynamic = 'force-dynamic'
