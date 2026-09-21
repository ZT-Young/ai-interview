import { notFound } from 'next/navigation'

import { CreditsAdjustForm } from '@/components/features/admin/credits-adjust-form'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminOrNull } from '@/lib/api/admin-guard'
import { isResumeContentVisible, listUsers } from '@/lib/services/admin-service'

export const metadata = { title: '用户管理' }
export const dynamic = 'force-dynamic'

/**
 * 用户列表（docs/UI.md §8.1）。
 *
 * **不展示简历原文** —— 只展示简历数量；原文需要单独的详情页 + 开关 + 审计。
 */
export default async function AdminUsersPage() {
  // 必须在本页最早处守卫：layout 与 page 并行渲染，layout 的 notFound() 拦不住本页取数
  const admin = await getAdminOrNull()
  if (!admin) notFound()

  const users = await listUsers()
  const resumeVisible = isResumeContentVisible()

  return (
    <main className="container space-y-6 py-8" data-testid="admin-users">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">用户</h1>
        <p className="text-sm text-muted-foreground">
          共 {users.length} 位（最多展示最近 50 位）。简历原文
          {resumeVisible ? '已开启可见' : '默认不可见'}。
        </p>
      </div>

      <div className="space-y-3">
        {users.map((user) => (
          <Card key={user.id}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{user.email}</span>
                {user.isAdmin ? <Badge variant="destructive">管理员</Badge> : null}
                <Badge variant={user.membership === 'free' ? 'secondary' : 'default'}>
                  {user.membership}
                </Badge>
                {!user.emailVerified ? <Badge variant="outline">邮箱未验证</Badge> : null}
              </div>

              <p className="text-xs text-muted-foreground">
                {user.name ? `${user.name} · ` : ''}
                简历 {user.resumeCount} 份 · 面试 {user.sessionCount} 场 · 剩余次数{' '}
                <span className="tabular-nums">{user.freeCredits}</span> · 注册于{' '}
                {new Date(user.createdAt).toLocaleString('zh-CN')}
              </p>

              <CreditsAdjustForm userId={user.id} currentCredits={user.freeCredits} />
            </CardContent>
          </Card>
        ))}

        {users.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">暂无用户</CardTitle>
              <CardDescription>还没有注册用户。</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </main>
  )
}
