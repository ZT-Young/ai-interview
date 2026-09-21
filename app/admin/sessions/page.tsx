import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminOrNull } from '@/lib/api/admin-guard'
import { listSessions } from '@/lib/services/admin-service'

export const metadata = { title: '面试会话' }
export const dynamic = 'force-dynamic'

/** 面试会话概览（docs/UI.md §8.1）—— 只读，不提供改动用户面试数据的入口 */
export default async function AdminSessionsPage() {
  // 必须在本页最早处守卫：layout 与 page 并行渲染，layout 的 notFound() 拦不住本页取数
  const admin = await getAdminOrNull()
  if (!admin) notFound()

  const sessions = await listSessions()

  return (
    <main className="container space-y-6 py-8" data-testid="admin-sessions">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">面试会话</h1>
        <p className="text-sm text-muted-foreground">
          共 {sessions.length} 场（最多展示最近 50 场）。此页只读，如需处理用户问题请通过客服流程。
        </p>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">暂无面试会话</CardTitle>
            <CardDescription>还没有用户创建面试会话。</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-normal">用户</th>
                <th className="py-2 pr-4 font-normal">状态</th>
                <th className="py-2 pr-4 font-normal">编排阶段</th>
                <th className="py-2 pr-4 text-right font-normal">题量</th>
                <th className="py-2 pr-4 text-right font-normal">总分</th>
                <th className="py-2 font-normal">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{session.userEmail}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={session.status === 'completed' ? 'default' : 'secondary'}>
                      {session.status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{session.phase}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{session.questionCount}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {session.hasReport ? session.totalScore : '—'}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {new Date(session.createdAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
