'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiClientError } from '@/lib/api-client'
import {
  QUESTION_SOURCE_LABELS,
  QUESTION_TYPE_LABELS,
  SCORE_DIMENSION_LABELS,
  type QuestionSource,
  type QuestionType,
  type ScoreDimension,
} from '@/lib/constants/questions'

export interface PlanQuestionItem {
  id: string
  orderIndex: number
  type: string
  source: string
  dimension: string
  content: string
  expectedPoints: string[]
  followUpAllowed: boolean
}

interface GenerateResponse {
  total: number
  quota: Record<string, number>
  questions: PlanQuestionItem[]
}

/** 五类题型的展示顺序（对应 AGENTS.md §2 第 5 步的面试环节） */
const TYPE_ORDER: QuestionType[] = [
  'self_intro',
  'project_dig',
  'technical',
  'behavioral',
  'reverse',
]

/**
 * 面试计划展示与生成。
 *
 * 需求：基础 UI 展示面试计划；每题展示文本/类型/来源/考察维度/期望要点/是否可追问。
 */
export function PlanView({
  sessionId,
  status,
  questions,
}: {
  sessionId: string
  status: string
  questions: PlanQuestionItem[]
}) {
  const router = useRouter()
  const [items, setItems] = useState<PlanQuestionItem[]>(questions)
  const [sessionStatus, setSessionStatus] = useState(status)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate(regenerate: boolean) {
    setPending(true)
    setError(null)
    try {
      const result = await api.post<GenerateResponse>(`/api/sessions/${sessionId}/plan`, {
        regenerate,
      })
      setItems(result.questions)
      setSessionStatus('planned')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '生成失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    label: QUESTION_TYPE_LABELS[type],
    items: items.filter((item) => item.type === type),
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={sessionStatus === 'planned' ? 'default' : 'secondary'}>
          {sessionStatus === 'planned' ? '计划已生成' : '尚未生成计划'}
        </Badge>
        <span className="text-sm text-muted-foreground">共 {items.length} 道题</span>
        <div className="ml-auto flex gap-2">
          {items.length === 0 ? (
            <Button onClick={() => generate(false)} disabled={pending}>
              {pending ? '生成中…' : '生成面试计划'}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => generate(true)} disabled={pending}>
              {pending ? '重新生成中…' : '重新生成计划'}
            </Button>
          )}
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {items.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          重新生成会清除当前计划下已有的答题记录，请谨慎操作。
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={`/sessions/${sessionId}/interview`}>开始面试</a>
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">还没有面试计划</CardTitle>
            <CardDescription>
              AI 会依据你的简历与目标岗位 JD 生成 8–12 道题，覆盖自我介绍、项目深挖、专业题、行为题与反问环节。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        grouped.map((group) =>
          group.items.length === 0 ? null : (
            <Card key={group.type}>
              <CardHeader>
                <CardTitle className="text-base">
                  {group.label}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {group.items.length} 题
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {group.items.map((item) => (
                  <div key={item.id} className="space-y-2 rounded-md border p-4">
                    <p className="font-medium">
                      {item.orderIndex + 1}. {item.content}
                    </p>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">
                        {QUESTION_SOURCE_LABELS[item.source as QuestionSource] ?? item.source}
                      </Badge>
                      <Badge variant="secondary">
                        {SCORE_DIMENSION_LABELS[item.dimension as ScoreDimension] ?? item.dimension}
                      </Badge>
                      <Badge variant={item.followUpAllowed ? 'default' : 'outline'}>
                        {item.followUpAllowed ? '可追问' : '不追问'}
                      </Badge>
                    </div>

                    {item.expectedPoints.length > 0 ? (
                      <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">期望要点：</span>
                        <ul className="mt-1 list-inside list-disc space-y-0.5">
                          {item.expectedPoints.map((point, index) => (
                            <li key={index}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ),
        )
      )}
    </div>
  )
}
