import Link from 'next/link'

import { RetrainButton } from '@/components/features/sessions/retrain-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePageUser } from '@/lib/api/guard'
import { listSessions } from '@/lib/services/handlers/session-service'

export const metadata = { title: '历史记录' }
export const dynamic = 'force-dynamic'

const PAGE = { limit: 50, offset: 0 }

const STATUS_LABEL: Record<string, string> = {
  draft: '待生成计划',
  planned: '计划已就绪',
  in_progress: '面试进行中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '异常终止',
}

/**
 * 历史记录页（docs/design/UI.md §7）。
 *
 * 每条记录提供：查看旧报告（若有）、再次训练（复用同一简历与 JD 新建会话）。
 * 报告是否存在通过题目状态推断：`completed` 且计划已生成时才可能有报告。
 */
export default async function SessionsPage() {
  const user = await requirePageUser()
  const { items, total } = await listSessions(user.id, PAGE)

  return (
    <main className="container space-y-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">历史记录</h1>
          <p className="text-sm text-muted-foreground">
            共 {total} 场模拟面试。可查看报告，或用同一份简历与 JD 再次训练。
          </p>
        </div>
        <Button asChild>
          <Link href="/sessions/new">新建面试</Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <Card data-testid="sessions-empty">
          <CardHeader>
            <CardTitle className="text-base">还没有面试会话</CardTitle>
            <CardDescription>
              先准备一份简历与一个岗位 JD，然后创建会话并生成面试计划。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/resumes">去准备简历</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/jd">去准备岗位 JD</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="sessions-list">
          {items.map((session) => {
            const isCompleted = session.status === 'completed'

            return (
              <Card key={session.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">面试会话</span>
                        <Badge variant={isCompleted ? 'default' : 'secondary'}>
                          {STATUS_LABEL[session.status] ?? session.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        最多 {session.config.maxQuestions} 题 · 难度 {session.config.difficulty} ·{' '}
                        {new Date(session.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {isCompleted ? (
                        <Button asChild size="sm" data-testid="view-report-link">
                          <Link href={`/sessions/${session.id}/report`}>查看报告</Link>
                        </Button>
                      ) : null}
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/sessions/${session.id}`}>
                          {isCompleted ? '面试计划' : '继续'}
                        </Link>
                      </Button>
                      <RetrainButton resumeId={session.resumeId} jobJdId={session.jobJdId} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {total > PAGE.limit ? (
            <p className="text-xs text-muted-foreground">
              仅显示最近 {PAGE.limit} 条记录（共 {total} 条）。
            </p>
          ) : null}
        </div>
      )}
    </main>
  )
}
