import { redirect } from 'next/navigation'

import { AppFooter, AppHeader } from '@/components/layout/app-header'
import { optionalUser } from '@/lib/api/guard'

export const dynamic = 'force-dynamic'

/**
 * 面试官区域布局。
 *
 * 与 `app/(app)/layout.tsx` 保持同一套骨架（导航 + 页脚），
 * 但**刻意不放在 `(app)` 分组内**：那一组的导航面向求职者（简历 / JD / 面试），
 * 面试官看这些是无意义的，两套身份的导航不应互相污染。
 *
 * 守卫同 `(app)`：必须用 `optionalUser()` + `redirect()`，
 * 不可用 `requireUser()`（后者在页面渲染中会变成 500，见 README 已知事项 15）。
 */
export default async function InterviewerLayout({ children }: { children: React.ReactNode }) {
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
