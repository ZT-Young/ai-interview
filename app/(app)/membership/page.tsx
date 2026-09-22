import Link from 'next/link'

import { RedeemForm } from '@/components/features/membership/redeem-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePageUser } from '@/lib/api/guard'
import { listProducts } from '@/lib/payments/products'
import { isPaymentConfigured } from '@/lib/payments/provider'
import { getEntitlements } from '@/lib/services/handlers/entitlement-service'
import { getMembership } from '@/lib/services/handlers/membership-service'

export const metadata = { title: '会员与权益' }
export const dynamic = 'force-dynamic'

function formatPrice(cents: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : ''
  return `${symbol}${(cents / 100).toFixed(2)}`
}

/**
 * 会员页（docs/design/UI.md §6）。
 *
 * 展示免费次数、权益对照、商品与兑换码入口。
 * **升级按钮仅在支付渠道配置后启用**，否则只显示兑换码路径 ——
 * 不给出无法完成的购买路径。
 */
export default async function MembershipPage() {
  const user = await requirePageUser()
  const [membership, entitlements] = await Promise.all([
    getMembership(user.id),
    getEntitlements(user.id),
  ])

  const products = listProducts()
  const paymentReady = isPaymentConfigured()

  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">会员与权益</h1>
        <p className="text-sm text-muted-foreground">当前等级：{membership.membershipLabel}</p>
      </div>

      <Card data-testid="membership-status">
        <CardHeader>
          <CardTitle className="text-base">我的账户</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">剩余面试次数</span>
            <span className="font-medium tabular-nums" data-testid="free-credits">
              {entitlements.unlimitedInterviews ? '无限' : entitlements.freeCreditsLeft}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">会员等级</span>
            <Badge variant={entitlements.isMember ? 'default' : 'secondary'}>
              {membership.membershipLabel}
            </Badge>
          </div>
          {!entitlements.isMember && entitlements.freeCreditsLeft === 0 ? (
            <p className="text-xs text-amber-600">
              免费次数已用完。已生成的报告仍可查看简版内容；解锁后可查看完整报告与语音面试。
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">你当前可用的能力</CardTitle>
          <CardDescription>权益由服务端计算，以下为实时状态</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {[
            { label: '发起模拟面试', ok: entitlements.canStartInterview || entitlements.unlimitedInterviews },
            { label: '详细报告（逐题反馈与证据）', ok: entitlements.reportDetail },
            { label: '语音面试', ok: entitlements.voiceInterview },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{item.label}</span>
              <Badge variant={item.ok ? 'default' : 'outline'}>{item.ok ? '可用' : '未解锁'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">权益对照</CardTitle>
          <CardDescription>
            免费版已包含总分、六维得分、优势与基础建议；完整内容需解锁
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="benefit-matrix">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-normal">功能</th>
                  <th className="py-2 pr-4 text-center font-normal">免费</th>
                  <th className="py-2 text-center font-normal">会员</th>
                </tr>
              </thead>
              <tbody>
                {membership.benefits.map((benefit) => (
                  <tr key={benefit.feature} className="border-b last:border-0">
                    <td className="py-2 pr-4">{benefit.feature}</td>
                    <td className="py-2 pr-4 text-center">
                      {benefit.free ? '✓' : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 text-center">
                      {benefit.member ? '✓' : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <RedeemForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">商品</CardTitle>
          <CardDescription>
            {paymentReady
              ? '价格由服务端定价，下单后跳转支付渠道'
              : '支付渠道尚未开放，当前请使用兑换码开通'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {products.map((product) => (
            <div
              key={product.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium tabular-nums">
                  {formatPrice(product.amountCents, product.currency)}
                </span>
                <Button size="sm" disabled data-testid={`buy-${product.id}`}>
                  暂不可购买
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">订单记录</CardTitle>
          <CardDescription>查看历史订单与解锁记录</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/orders" data-testid="orders-link">
              查看订单记录
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
