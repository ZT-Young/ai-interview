import { notFound } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminOrNull } from '@/lib/api/admin-guard'
import { listAuditLogs } from '@/lib/services/admin-service'

export const metadata = { title: '审计日志' }
export const dynamic = 'force-dynamic'

/**
 * 审计日志（只读，docs/UI.md §8.4）。
 *
 * **刻意不提供删除/修改入口**：审计日志只增不改（AGENTS.md §7 C6）。
 */
export default async function AdminAuditLogsPage() {
  // 必须在本页最早处守卫：layout 与 page 并行渲染，layout 的 notFound() 拦不住本页取数
  const admin = await getAdminOrNull()
  if (!admin) notFound()

  const logs = await listAuditLogs()

  return (
    <main className="container space-y-6 py-8" data-testid="admin-audit-logs">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">审计日志</h1>
        <p className="text-sm text-muted-foreground">
          共 {logs.length} 条（最多展示最近 50 条）。审计日志只增不改，无删除入口。
        </p>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">暂无审计记录</CardTitle>
            <CardDescription>
              登录、注册、支付发放、额度调整、简历原文查看等敏感操作会记录在这里。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-normal">时间</th>
                <th className="py-2 pr-4 font-normal">操作</th>
                <th className="py-2 pr-4 font-normal">操作者</th>
                <th className="py-2 pr-4 font-normal">目标</th>
                <th className="py-2 font-normal">详情</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{log.action}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{log.actorId?.slice(0, 8) ?? '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{log.targetId?.slice(0, 8) ?? '—'}</td>
                  <td className="max-w-[20rem] truncate py-2 font-mono text-xs" title={log.metadata ?? ''}>
                    {log.metadata ?? '—'}
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
