import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminOrNull } from '@/lib/api/admin-guard'
import { getOverview } from '@/lib/services/admin-service'

export const metadata = { title: '后台概览' }
export const dynamic = 'force-dynamic'

/** 后台概览（docs/UI.md §8.1） */
export default async function AdminOverviewPage() {
  // 必须在本页最早处守卫：layout 与 page 并行渲染，layout 的 notFound() 拦不住本页取数
  const admin = await getAdminOrNull()
  if (!admin) notFound()

  const overview = await getOverview()

  const cards = [
    { label: '用户数', value: overview.users, href: '/admin/users' },
    { label: '面试会话', value: overview.sessions, href: '/admin/sessions' },
    { label: '报告数', value: overview.reports, href: '/admin/sessions' },
    { label: '订单数', value: overview.orders, href: '/admin/orders' },
    { label: '近 24h AI 错误', value: overview.aiErrors24h, href: '/admin/logs?status=error' },
  ]

  return (
    <main className="container space-y-6 py-8" data-testid="admin-overview">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">概览</h1>
        <p className="text-sm text-muted-foreground">系统整体状态（列表类页面默认展示最近 50 条）</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="rounded-lg border p-4 hover:bg-muted/40">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{card.value}</p>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据可见性</CardTitle>
          <CardDescription>
            默认不向管理员展示用户简历原文（`raw_text` / `parsed_data`），避免无关人员接触敏感内容
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            简历原文当前：
            <span className={overview.resumeContentVisible ? 'text-amber-600' : 'text-emerald-600'}>
              {overview.resumeContentVisible ? '可见（已开启 ADMIN_VIEW_RESUME_CONTENT）' : '不可见（默认）'}
            </span>
          </p>
          {overview.resumeContentVisible ? (
            <p className="mt-1 text-xs text-muted-foreground">
              注意：每次查看都会写入审计日志（`admin.resume_content_viewed`）。
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
