import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminOrNull } from '@/lib/api/admin-guard'
import { listAllOrders } from '@/lib/services/admin-service'

export const metadata = { title: '订单' }
export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  failed: '支付失败',
  refunded: '已退款',
  cancelled: '已取消',
}

const UNLOCK_LABELS: Record<string, string> = {
  report: '单份报告解锁',
  package: '次数包',
  subscription: '订阅会员',
  free_trial: '免费额度消耗',
}

function formatAmount(cents: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : ''
  return `${symbol}${(cents / 100).toFixed(2)}`
}

/** 全部订单（docs/UI.md §8.1）—— 不返回渠道订单号 */
export default async function AdminOrdersPage() {
  // 必须在本页最早处守卫：layout 与 page 并行渲染，layout 的 notFound() 拦不住本页取数
  const admin = await getAdminOrNull()
  if (!admin) notFound()

  const orders = await listAllOrders()

  return (
    <main className="container space-y-6 py-8" data-testid="admin-orders">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">订单</h1>
        <p className="text-sm text-muted-foreground">
          共 {orders.length} 条（最多展示最近 50 条）。渠道订单号不在此展示。
        </p>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">暂无订单</CardTitle>
            <CardDescription>还没有订单记录。</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-normal">用户</th>
                <th className="py-2 pr-4 font-normal">类型</th>
                <th className="py-2 pr-4 font-normal">商品</th>
                <th className="py-2 pr-4 text-right font-normal">金额</th>
                <th className="py-2 pr-4 font-normal">状态</th>
                <th className="py-2 font-normal">时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{order.userEmail}</td>
                  <td className="py-2 pr-4">{UNLOCK_LABELS[order.unlockType] ?? order.unlockType}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{order.productId ?? '—'}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatAmount(order.amountCents, order.currency)}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={order.status === 'paid' ? 'default' : 'secondary'}>
                      {STATUS_LABELS[order.status] ?? order.status}
                    </Badge>
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {new Date(order.createdAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
