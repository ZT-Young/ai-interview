import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { optionalUser } from '@/lib/api/guard'
import { isFreeMode } from '@/lib/config/free-mode'
import { listSessions } from '@/lib/services/handlers/session-service'

export const metadata = { title: '工作台' }
export const dynamic = 'force-dynamic'

const RECENT = { limit: 3, offset: 0 }

const STATUS_LABEL: Record<string, string> = {
  draft: '待生成计划',
  planned: '计划已就绪',
  in_progress: '面试进行中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '异常终止',
}

/**
 * 登录后工作台 `/`（docs/design/UI.md §1）。
 *
 * 与公开落地页 `/intro` 分离：**未登录访问 `/` 会被重定向到 `/login`**，
 * 产品本体只在登录后可见。所属 `(app)` 布局已提供顶部导航与页脚，
 * 并在未登录时重定向，这里再取一次用户仅为组装视图模型。
 *
 * 最近面试读取失败时降级为空态（不让它把整个工作台拖成 500）。
 */
export default async function WorkbenchPage() {
  const user = await optionalUser()
  if (!user) redirect('/login')

  let recent: Awaited<ReturnType<typeof listSessions>>['items'] = []
  let total = 0
  try {
    const result = await listSessions(user.id, RECENT)
    recent = result.items
    total = result.total
  } catch {
    // 降级：工作台其余部分仍可用
  }

  const freeMode = isFreeMode()

  return (
    <main className="container space-y-6 py-10" data-testid="workbench">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">AI 模拟面试</h1>
        {/* 展示优先级：昵称 → 用户名 → 邮箱 → 手机号（纯手机号用户没有邮箱） */}
        <p className="text-sm text-muted-foreground">
          欢迎回来
          {user.name ? `，${user.name}` : user.username ? `，${user.username}` : ''}
          {user.email ? ` · ${user.email}` : user.phone ? ` · ${user.phone}` : ''}
        </p>
      </div>

      {/* 主入口：开始一场模拟面试 */}
      <Card className="border-primary/10 bg-gradient-to-br from-primary/5 to-transparent shadow-card">
        <CardHeader>
          <CardTitle className="text-lg">开始一场模拟面试</CardTitle>
          <CardDescription>
            准备简历与岗位 JD → AI 面试官追问作答 → 拿到六维评分与提升建议。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/sessions/new" data-testid="workbench-new-session">
              新建面试
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/resumes">我的简历</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/jd">岗位 JD</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* 账户概览 */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">账户</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">会员等级</span>
              <span className="font-medium">{user.membership}</span>
            </div>
            {!freeMode ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">剩余免费次数</span>
                <span className="font-medium tabular-nums">{user.freeCredits}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" size="sm">
                <Link href="/settings">账户设置</Link>
              </Button>
              {!freeMode ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/membership">会员权益</Link>
                </Button>
              ) : null}
              {user.isAdmin ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href="/admin">管理后台</Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* 最近面试 */}
        <Card className="shadow-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">最近面试</CardTitle>
              {total > 0 ? (
                <Badge variant="outline" className="tabular-nums">
                  共 {total} 场
                </Badge>
              ) : null}
            </div>
            <CardDescription>回看报告，或用同一份简历与 JD 再练一次。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                还没有面试记录，先准备好简历与岗位 JD 吧。
              </p>
            ) : (
              recent.map((session) => (
                <div
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">面试会话</span>
                      <Badge variant={session.status === 'completed' ? 'default' : 'secondary'}>
                        {STATUS_LABEL[session.status] ?? session.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {session.status === 'completed' ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/sessions/${session.id}/report`}>看报告</Link>
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/sessions/${session.id}`}>
                        {session.status === 'completed' ? '计划' : '继续'}
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
            {total > recent.length ? (
              <Button asChild variant="link" size="sm" className="px-0">
                <Link href="/sessions">查看全部 →</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        AI 生成内容 · 仅供练习参考，不构成任何录用判断
      </p>
    </main>
  )
}
