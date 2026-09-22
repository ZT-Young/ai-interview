import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminOrNull } from '@/lib/api/admin-guard'
import { listAiLogs } from '@/lib/services/handlers/admin-service'

export const metadata = { title: 'AI 与错误日志' }
export const dynamic = 'force-dynamic'

const OPERATION_LABELS: Record<string, string> = {
  parse_jd: 'JD 解析',
  parse_resume: '简历解析',
  match: '匹配分析',
  plan: '出题',
  follow_up: '追问',
  hint: '提示',
  evaluate: '逐题评分',
  report: '报告生成',
  unknown: '未知',
}

/**
 * AI 调用日志与错误日志（同一张表，按 `status` 区分，docs/design/UI.md §8.1）。
 *
 * 日志**不含**提示词与简历原文（写入侧已由 `sanitizeLogText` 脱敏），
 * 因此后台也无法从日志里还原用户敏感内容。
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  // 必须在本页最早处守卫：layout 与 page 并行渲染，layout 的 notFound() 拦不住本页取数
  const admin = await getAdminOrNull()
  if (!admin) notFound()

  const status = searchParams.status === 'error' ? 'error' : searchParams.status === 'success' ? 'success' : undefined
  const logs = await listAiLogs(status ? { status } : {})

  return (
    <main className="container space-y-6 py-8" data-testid="admin-logs">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">AI 与错误日志</h1>
        <p className="text-sm text-muted-foreground">
          共 {logs.length} 条（最多展示最近 50 条）。日志只记录元数据，不含提示词与用户原文。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {[
          { label: '全部', href: '/admin/logs', active: !status },
          { label: '仅成功', href: '/admin/logs?status=success', active: status === 'success' },
          { label: '仅错误', href: '/admin/logs?status=error', active: status === 'error' },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={
              item.active
                ? 'rounded-md border border-primary px-2 py-1 text-primary'
                : 'rounded-md border px-2 py-1 text-muted-foreground hover:text-foreground'
            }
          >
            {item.label}
          </Link>
        ))}
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">暂无日志</CardTitle>
            <CardDescription>
              还没有 AI 调用记录。调用 LLM 的功能（解析/出题/评分/报告）运行后会在这里出现。
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
                <th className="py-2 pr-4 font-normal">状态</th>
                <th className="py-2 pr-4 font-normal">模型</th>
                <th className="py-2 pr-4 text-right font-normal">耗时</th>
                <th className="py-2 pr-4 text-right font-normal">tokens</th>
                <th className="py-2 font-normal">错误</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="py-2 pr-4">{OPERATION_LABELS[log.operation] ?? log.operation}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={log.status === 'error' ? 'destructive' : 'default'}>
                      {log.status === 'error' ? '失败' : '成功'}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{log.model ?? '—'}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {log.durationMs === null ? '—' : `${log.durationMs}ms`}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {log.promptTokens === null && log.completionTokens === null
                      ? '—'
                      : `${log.promptTokens ?? 0}/${log.completionTokens ?? 0}`}
                  </td>
                  <td className="max-w-[16rem] truncate py-2 text-xs text-destructive" title={log.errorMessage ?? ''}>
                    {log.errorCode ? `${log.errorCode}: ` : ''}
                    {log.errorMessage ?? '—'}
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
