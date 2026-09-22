import Link from 'next/link'

import { PlanView, type PlanQuestionItem } from '@/components/features/plan/plan-view'
import { MatchPanel, type MatchAnalysisData } from '@/components/features/plan/match-panel'
import { requirePageUser } from '@/lib/api/guard'
import { getSessionPlan } from '@/lib/services/handlers/plan-service'

export const metadata = { title: '面试计划' }
export const dynamic = 'force-dynamic'

/**
 * 面试计划页。
 *
 * 展示本次面试的问题清单（含来源、类型、考察维度、追问上限），
 * 并展示匹配分析（岗位匹配度、优势、差距），确认后进入面试房间。
 */
export default async function SessionPlanPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser()
  const plan = await getSessionPlan(user.id, params.id)

  const questions: PlanQuestionItem[] = plan.questions.map((item) => ({
    id: item.id,
    orderIndex: item.orderIndex,
    type: item.type,
    source: item.source,
    dimension: item.dimension,
    content: item.content,
    expectedPoints: item.expectedPoints,
    followUpAllowed: item.followUpAllowed,
  }))

  return (
    <main className="container max-w-3xl space-y-6 py-10">
      <div className="space-y-1">
        <Link href="/sessions" className="text-sm underline underline-offset-4">
          返回面试列表
        </Link>
        <h1 className="text-2xl font-bold">面试计划</h1>
        <p className="text-sm text-muted-foreground">
          以下题目由 AI 依据你的简历与目标 JD 生成，题目仅作模拟训练参考，不作为录用依据。详情见
          <Link href="/legal/ai-disclosure" className="ml-1 underline underline-offset-4">
            AI 生成内容说明
          </Link>
        </p>
      </div>

      <MatchPanel
        sessionId={plan.sessionId}
        initial={(plan.matchAnalysis as MatchAnalysisData | null) ?? null}
      />

      <PlanView sessionId={plan.sessionId} status={plan.status} questions={questions} />
    </main>
  )
}
