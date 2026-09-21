'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiClientError } from '@/lib/api-client'

export interface MatchAnalysisData {
  match_score: number
  advantages: Array<{ point: string; evidence: string }>
  gaps: string[]
  suggested_questions: Array<{ question: string; based_on: string }>
}

/**
 * 匹配分析展示与生成。
 *
 * 生成面试计划需要 match_analysis 作为输入，因此这是出题的前置步骤
 * （见 docs/AI_PROMPTS.md §3、§4）。
 *
 * match_score 仅表示简历与 JD 的**静态匹配程度**，用于帮用户定位准备重点，
 * **不是**能力评价，也不用于任何筛选决策。
 */
export function MatchPanel({
  sessionId,
  initial,
}: {
  sessionId: string
  initial: MatchAnalysisData | null
}) {
  const router = useRouter()
  const [analysis, setAnalysis] = useState<MatchAnalysisData | null>(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setPending(true)
    setError(null)
    try {
      const result = await api.post<{ matchAnalysis: MatchAnalysisData }>(
        `/api/sessions/${sessionId}/match`,
      )
      setAnalysis(result.matchAnalysis)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '生成匹配分析失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">匹配分析</CardTitle>
            <CardDescription>
              仅依据你的简历与 JD 对比得出，用于定位准备重点，不代表任何录用判断
            </CardDescription>
          </div>
          <Button variant={analysis ? 'outline' : 'default'} size="sm" onClick={generate} disabled={pending}>
            {pending ? '分析中…' : analysis ? '重新分析' : '生成匹配分析'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        {!analysis ? (
          <p className="text-sm text-muted-foreground">
            尚未生成匹配分析。生成后才能创建面试计划。
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">匹配度</span>
              <span className="text-2xl font-semibold">{analysis.match_score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>

            {analysis.advantages.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">优势</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {analysis.advantages.map((item, index) => (
                    <li key={index}>
                      {item.point}
                      {item.evidence ? <span className="block text-xs">依据：{item.evidence}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {analysis.gaps.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">待补充（简历中未体现）</p>
                <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {analysis.gaps.map((gap, index) => (
                    <li key={index}>{gap}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {analysis.suggested_questions.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">建议准备的问题</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {analysis.suggested_questions.map((item, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <Badge variant="outline">
                        {item.based_on === 'advantage' ? '优势' : '待补充'}
                      </Badge>
                      {item.question}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
