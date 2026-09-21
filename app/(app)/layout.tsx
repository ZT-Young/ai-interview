import { redirect } from 'next/navigation'

import { AppFooter, AppHeader } from '@/components/layout/app-header'
import { optionalUser } from '@/lib/api/guard'

export const dynamic = 'force-dynamic'

/**
 * 已登录区域布局。
 *
 * **守卫必须用 `optionalUser()` + `redirect()`**，不可用 `requireUser()`：
 * 后者抛的是 API 层 401 异常，在页面渲染中会变成 500
 * （见 README「已知事项」第 15 条，/resumes、/jd 曾因此返回 500）。
 *
 * 结构上使用 `flex min-h-dvh flex-col` + `mt-auto` 页脚：
 * 内容不足一屏时页脚贴底，不会浮在页面中间。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await optionalUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppHeader />
      <div id="main" className="flex-1">
        {children}
      </div>
      <AppFooter />
    </div>
  )
}
