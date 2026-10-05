'use client'

import {
  Coins,
  FileText,
  History,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/http/api-client'
import { cn } from '@/lib/utils/index'

/** 求职者侧入口 */
const NAV_ITEMS = [
  { href: '/resumes', label: '简历', icon: FileText },
  { href: '/jd', label: '岗位 JD', icon: Target },
  { href: '/sessions', label: '历史记录', icon: History },
  { href: '/membership', label: '会员', icon: Sparkles, paidOnly: true },
  { href: '/settings', label: '设置', icon: Settings },
] as const

/**
 * 面试官侧入口（B 端）。
 *
 * **不复用求职者那套**：简历 / JD / 历史记录都是求职者的练习资产，
 * 面试官看到会以为自己能用（点了才发现是空的），属于典型的「入口误导」。
 * 保留「设置」是因为改用户名、导出与删除账号是身份无关的。
 */
const INTERVIEWER_NAV_ITEMS = [
  { href: '/interviewer', label: '工作台', icon: Users },
  { href: '/settings', label: '设置', icon: Settings },
] as const

/**
 * 免费模式下过滤掉付费相关入口（会员页）。
 *
 * 由服务端通过 `freeMode` 传入，而不是在客户端读环境变量：
 * 导航是否展示属于渲染决策，判定仍以服务端权益为准（本组件不做任何门禁）。
 */
function visibleNavItems(freeMode: boolean) {
  return freeMode ? NAV_ITEMS.filter((item) => !('paidOnly' in item) || !item.paidOnly) : NAV_ITEMS
}

/** 按身份挑选导航项，再按免费模式过滤付费入口 */
function navItemsFor(user: AppNavUser, freeMode: boolean) {
  const base = user.role === 'interviewer' ? INTERVIEWER_NAV_ITEMS : NAV_ITEMS
  return freeMode ? base.filter((item) => !('paidOnly' in item) || !item.paidOnly) : base
}

export interface AppNavUser {
  /** 纯手机号注册的用户没有邮箱 */
  email: string | null
  /** 注册时自动生成的用户名，可作登录标识，也是展示的兜底名称 */
  username: string | null
  name: string | null
  membership: string
  freeCredits: number
  /**
   * 当前身份：`candidate` 求职者 / `interviewer` 面试官（DATA_MODEL §2.10）。
   * 决定导航里出现哪一套入口：求职者看「简历 / JD / 面试」，面试官看「面试官工作台」。
   */
  role: 'candidate' | 'interviewer'
  /**
   * 是否持有**管理端会话**（与 `isAdmin` 不是一回事）。
   *
   * 用户端与管理端分离后，后台入口的显示条件从「账号是管理员」
   * 收紧为「**确实在管理端登录过**」。管理员用用户端账号登录时，
   * 用户端界面里不应该出现任何后台痕迹。
   */
  hasAdminSession: boolean
}

/**
 * 顶部导航。
 *
 * 相比旧实现修掉三个实际问题：
 * 1. **用 `Link` 而非 `<a>`**：旧实现每次点击都整页刷新，
 *    已填写的表单内容与滚动位置全部丢失（典型场景：写了一半回答去查历史记录）。
 * 2. **当前页高亮**：5 个入口此前外观完全一样，用户不知道自己在哪。
 * 3. **移动端折叠**：375px 下 5 个入口会挤成两行且中英文混排换行错乱，
 *    现在收进抽屉；并显示剩余次数与退出入口（此前移动端无处退出）。
 */
export function AppNav({ user, freeMode = false }: { user: AppNavUser; freeMode?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const items = navItemsFor(user, freeMode)

  // 路由变化后自动收起抽屉，避免跳转后菜单仍悬在页面上
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await api.post('/api/auth/logout')
    } finally {
      router.push('/login')
      router.refresh()
      setLoggingOut(false)
    }
  }

  // 展示优先级：昵称 → 用户名 → 邮箱 → 兜底文案。
  // 纯手机号注册的用户没有邮箱，因此用户名必须排在邮箱前面。
  const displayName = user.name?.trim() || user.username || user.email || '我的账号'

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-14 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden sm:inline">AI 模拟面试</span>
        </Link>

        {/* 桌面端导航 */}
        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="主导航">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                isActive(item.href)
                  ? 'bg-primary-muted font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* 剩余次数：让「还能面几次」随时可见，避免用户跑到会员页才发现用不了。
              免费模式下面试次数不限，展示次数反而误导，因此隐藏。 */}
          {freeMode ? null : (
            <Link
              href="/membership"
              className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground sm:flex"
              title="剩余面试次数"
            >
              <Coins className="size-3.5" aria-hidden="true" />
              <span data-testid="nav-free-credits">
                {user.membership === 'plus' ? '无限' : `${user.freeCredits} 次`}
              </span>
            </Link>
          )}

          <span
            className="hidden max-w-[12rem] truncate text-sm text-muted-foreground lg:inline"
            title={user.email ?? user.username ?? undefined}
          >
            {displayName}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
            className="hidden md:inline-flex"
          >
            {loggingOut ? '退出中…' : '退出'}
          </Button>

          {user.hasAdminSession ? (
            <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
              <Link href="/admin">后台</Link>
            </Button>
          ) : null}

          {/* 移动端抽屉开关 */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            onClick={() => setMenuOpen((open) => !open)}
            data-testid="nav-toggle"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {/* 移动端抽屉 */}
      {menuOpen ? (
        <div id="mobile-nav" className="border-t bg-background md:hidden" data-testid="mobile-nav">
          <nav className="container flex flex-col py-2" aria-label="主导航（移动端）">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-2 py-2.5 text-sm',
                    isActive(item.href)
                      ? 'bg-primary-muted font-medium text-accent-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              )
            })}
            {user.hasAdminSession ? (
              <Link
                href="/admin"
                className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm text-muted-foreground"
              >
                <Settings className="size-4 shrink-0" aria-hidden="true" />
                管理后台
              </Link>
            ) : null}
          </nav>

          <div className="container flex items-center justify-between gap-3 border-t py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayName}</p>
              {freeMode ? null : (
                <p className="text-xs text-muted-foreground">
                  剩余 {user.membership === 'plus' ? '无限' : `${user.freeCredits} 次`}
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
              <LogOut className="size-4" aria-hidden="true" />
              {loggingOut ? '退出中…' : '退出登录'}
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  )
}
