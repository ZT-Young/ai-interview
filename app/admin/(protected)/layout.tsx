import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAdminOrNull } from '@/lib/api/admin-guard'
import { AdminLogoutButton } from '@/components/features/admin/admin-logout-button'

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
 * 管理后台布局（docs/design/UI.md §8）—— 只包裹**受保护的**后台页面。
 *
 * **为什么套一层 `(protected)` 路由组**：`/admin/login` 必须能匿名访问，
 * 若守卫写在 `app/admin/layout.tsx`，登录页会被自己的守卫拦成 404，
 * 表现为「后台登录页打不开」，而日志里只有一条 404，极难定位。
 * 把受保护页面收进路由组，守卫的作用域就正好等于它们。
 *
 * **独立于 `(app)` 布局**：普通用户的导航里不会出现后台入口。
 *
 * 没有管理端会话时**重定向到 `/admin/login`** 而不是 404：
 * 后台页面是给人用的，404 会让真正的管理员一头雾水
 * （而重定向不泄露任何信息 —— 它对所有人一视同仁，不区分你是谁）。
 * 接口层（`requireAdmin`）仍保持 401 / 404，那里没有「跳转到登录页」的语义。
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminOrNull()
  if (!admin) redirect('/admin/login')

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
          {/*
            退出的是**管理端会话**，用户端会话保持不动 ——
            两端分离的直接体现：退出后台不需要把前台也登出。
          */}
          <AdminLogoutButton />
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            返回前台
          </Link>
        </div>
      </header>
      {children}
    </div>
  )
}
