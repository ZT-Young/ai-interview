import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePageUser } from '@/lib/api/guard'
import { listOrders } from '@/lib/services/membership-service'

export const metadata = { title: '订单记录' }
export const dynamic = 'force-dynamic'

/** 订单状态中文名 */
const STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  failed: '支付失败',
  refunded: '已退款',
  cancelled: '已取消',
}

/** 解锁类型中文名 */
const UNLOCK_LABELS: Record<string, string> = {
  report: '单份报告解锁',
  package: '次数包',
  subscription: '订阅会员',
}

function formatAmount(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2)
  const symbol = currency === 'CNY' ? '¥' : ''
  return `${symbol}${amount} ${currency}`
}

/**
 * 订单记录页（docs/UI.md §6.1）。
 *
 * 支付渠道未接入，因此正常情况下为空列表 —— 空状态需明确说明原因，
 * 而不是让用户以为是加载失败。渠道订单号已脱敏展示。
 */
export default async function OrdersPage() {
  const user = await requirePageUser()
  const orders = await listOrders(user.id)

  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <div className="space-y-1">
        <Link href="/membership" className="text-sm underline underline-offset-4">
          返回会员页
        </Link>
        <h1 className="text-2xl font-bold">订单记录</h1>
      </div>

      {orders.length === 0 ? (
        <Card data-testid="orders-empty">
          <CardHeader>
            <CardTitle className="text-base">还没有订单记录</CardTitle>
            <CardDescription>
              支付功能开发中，开放后你的解锁记录会显示在这里。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="orders-list">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">
                      {formatAmount(order.amountCents, order.currency)}
                    </span>
                    <Badge variant={order.status === 'paid' ? 'default' : 'secondary'}>
                      {STATUS_LABELS[order.status] ?? order.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {UNLOCK_LABELS[order.unlockType] ?? order.unlockType} ·{' '}
                    {new Date(order.createdAt).toLocaleString('zh-CN')}
                  </p>
                  {order.providerOrderMasked ? (
                    <p className="text-xs text-muted-foreground">
                      渠道订单号：{order.providerOrderMasked}
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  )
}
