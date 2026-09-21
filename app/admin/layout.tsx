import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getAdminOrNull } from '@/lib/api/admin-guard'

export const dynamic = 'force-dynamic'
export const metadata = { title: '管理后台' }

const NAV = [
  { href: '/admin', label: '概览' },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/sessions', label: '面试会话' },
  { href: '/admin/orders', label: '订单' },
  { href: '/admin/logs', label: 'AI 与错误日志' },
  { href: '/admin/audit-logs', label: '审计日志' },
]

/**
 * 管理后台布局（docs/UI.md §8）。
 *
 * **独立于 `(app)` 布局**：普通用户的导航里不会出现后台入口。
 * 服务端守卫：非管理员 `notFound()` → 404，不暴露后台是否存在。
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminOrNull()
  if (!admin) notFound()

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="container flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Link href="/admin" className="font-semibold">
            管理后台
          </Link>
          <span className="text-xs text-muted-foreground">{admin.email}</span>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link href="/" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            返回前台
          </Link>
        </div>
      </header>
      {children}
    </div>
  )
}
