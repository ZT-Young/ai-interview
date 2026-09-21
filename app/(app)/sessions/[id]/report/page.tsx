import Link from 'next/link'

import {
  ReportView,
  type EvaluationItemView,
  type ReportDataView,
  type SuggestionView,
} from '@/components/features/report/report-view'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api/errors'
import { requirePageUser } from '@/lib/api/guard'
import { listEvaluations } from '@/lib/services/evaluation-service'
import { getReportBySession } from '@/lib/services/report-service'

export const metadata = { title: '面试报告' }
export const dynamic = 'force-dynamic'

/**
 * 面试报告页（docs/UI.md §5）。
 *
 * 服务端只下发「用户有权看到」的内容：
 * - 未解锁 → 付费区块内容不下发，仅给 `lockedSections` 字段名用于渲染遮罩（C 端付费墙）
 * - 未解锁时**不请求**逐题评分，避免越权数据经过网络
 *
 * 逐题评分仅在已解锁时加载，因此该请求失败不影响报告主体展示。
 */
export default async function ReportPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser()

  let report: ReportDataView | null = null
  let isUnlocked = false
  let lockedSections: string[] = []
  let matchScore: number | null = null
  let baseSuggestions: SuggestionView[] = []
  let sessionMissing = false

  try {
    const result = await getReportBySession(user.id, params.id)
    report = result.report as ReportDataView
    isUnlocked = result.isUnlocked
    lockedSections = result.lockedSections
    matchScore = result.matchScore
    baseSuggestions = result.baseSuggestions
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') {
      // 区分「会话不存在」与「报告还没生成」：前者引导回列表，后者引导去生成
      sessionMissing = error.message.includes('会话')
      report = null
    } else {
      throw error
    }
  }

  let evaluations: EvaluationItemView[] = []
  if (report && isUnlocked) {
    evaluations = (await listEvaluations(user.id, params.id)) as EvaluationItemView[]
  }

  if (sessionMissing) {
    return (
      <main className="container max-w-3xl space-y-4 py-6">
        <h1 className="text-xl font-bold">面试报告</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">没有找到这场面试</CardTitle>
            <CardDescription>会话可能已被删除，或它不属于当前账号。</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/sessions" className="text-sm underline underline-offset-4">
              返回我的面试
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!report) {
    return (
      <main className="container max-w-3xl space-y-4 py-6">
        <h1 className="text-xl font-bold">面试报告</h1>
        <Card data-testid="report-not-ready">
          <CardHeader>
            <CardTitle className="text-base">报告还没有生成</CardTitle>
            <CardDescription>请先完成面试并结束会话，系统会自动生成评分报告。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Link
              href={`/sessions/${params.id}/interview`}
              className="text-sm underline underline-offset-4"
            >
              继续面试
            </Link>
            <Link href={`/sessions/${params.id}`} className="text-sm underline underline-offset-4">
              查看面试计划
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="container max-w-3xl space-y-4 py-6">
      <h1 className="text-xl font-bold">面试报告</h1>
      <ReportView
        sessionId={params.id}
        report={report}
        evaluations={evaluations}
        isUnlocked={isUnlocked}
        lockedSections={lockedSections}
        matchScore={matchScore}
        baseSuggestions={baseSuggestions}
      />
    </main>
  )
}
