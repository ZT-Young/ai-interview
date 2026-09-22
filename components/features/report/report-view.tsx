'use client'

import { useState } from 'react'

import { Alert } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiClientError } from '@/lib/http/api-client'
import { cn } from '@/lib/utils/index'

import { DimensionRadar } from './dimension-radar'
import { ScoreSummary } from './score-summary'
import { TrainingSuggestions, type SuggestionItem } from './training-suggestions'

export interface ReportDataView {
  id: string
  sessionId: string
  totalScore: number
  dimensionScores: Record<string, number>
  highlights: string[]
  issues: string[]
  referenceAnswers: Array<{ question: string; improvement: string }>
  nextSteps: string[]
  resumeRisks: string[]
  summary: string | null
  isUnlocked: boolean
}

export interface EvaluationItemView {
  id: string
  questionContent: string
  answerContent: string
  questionScore: number
  dimensionScores: Record<string, number>
  feedback: string
  evidenceQuotes: Array<{ quote: string; reason: string }>
  /**
   * 该题的**参考答案**（示范怎么答），基于候选人真实经历生成。
   * 历史数据可能为 null。
   */
  referenceAnswer?: string | null
}

/** 基础训练建议（免费可见） */
export interface SuggestionView {
  text: string
  dimension?: string
}

/** 付费未解锁时的遮罩提示（付费内容由服务端裁剪，前端拿不到内容） */
function LockedNotice({ label }: { label: string }) {
  return (
    <div className="space-y-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      <p>{label}需解锁后查看。</p>
      <a href="/membership" className="underline underline-offset-4">
        查看会员权益
      </a>
    </div>
  )
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 参考答案正文。
 *
 * 参考答案由模型基于候选人**真实简历经历**生成，凡无法确定的具体信息
 * （数字、指标、时间、规模）都被要求写成 `【待补充：…】`。
 * 这里把占位符**高亮出来**并给出醒目提示，原因很实际：
 * 如果整段用同一种样式呈现，用户很可能直接背诵，把 `【待补充：…】`
 * 一起说出口，或在面试中报出不属于自己的数字。
 * 高亮 + 顶部提示能让「必须替换为自己的真实情况」这件事无法被忽略。
 */
function ReferenceAnswerBody({ text }: { text: string }) {
  const parts = text.split(/(【[^】]*】)/g)

  return (
    <div className="space-y-2">
      <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
        这是参考答案，用于学习结构与措辞。请把【】中的内容换成你的真实数据后再使用。
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {parts.map((part, index) =>
          part.startsWith('【') && part.endsWith('】') ? (
            <mark
              key={index}
              className="rounded bg-warning/20 px-1 font-medium text-warning-foreground"
            >
              {part}
            </mark>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
      </p>
    </div>
  )
}

/**
 * 报告主容器（docs/design/UI.md §5）。
 *
 * 免费可见：总分、岗位匹配度、六维雷达与数值、总评、优势、基础训练建议
 * 付费解锁：待改进、参考回答、简历风险点、完整建议、逐题反馈
 *
 * **未解锁时服务端不会返回付费内容**，这里只渲染遮罩。
 * 长页性能：逐题反馈默认折叠；不展开则不渲染内容。
 */
export function ReportView({
  sessionId,
  report: initialReport,
  evaluations: initialEvaluations,
  isUnlocked: initialUnlocked,
  lockedSections,
  matchScore,
  baseSuggestions,
}: {
  sessionId: string
  report: ReportDataView
  evaluations: EvaluationItemView[]
  isUnlocked: boolean
  lockedSections: string[]
  matchScore: number | null
  baseSuggestions: SuggestionView[]
}) {
  const [report, setReport] = useState(initialReport)
  const [evaluations, setEvaluations] = useState(initialEvaluations)
  const [isUnlocked, setIsUnlocked] = useState(initialUnlocked)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function reload() {
    const latest = await api.get<{
      report: ReportDataView
      isUnlocked: boolean
      lockedSections: string[]
      evaluations: EvaluationItemView[]
    }>(`/api/sessions/${sessionId}/report`)
    setReport(latest.report)
    setIsUnlocked(latest.isUnlocked)
    setEvaluations(latest.evaluations)
  }

  async function evaluateAll() {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.post<{ evaluated: number; total: number; failed: number }>(
        `/api/sessions/${sessionId}/evaluate`,
        {},
      )
      setNotice(`已完成 ${result.evaluated}/${result.total} 道题的评分`)
      await reload()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '评分失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  async function generateReport() {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      await api.post(`/api/sessions/${sessionId}/report`, { regenerate: report.id !== '' })
      setNotice('报告已生成')
      await reload()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '生成报告失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  const locked = (section: string) => !isUnlocked && lockedSections.includes(section)

  return (
    <div className="space-y-6">
      {error ? <Alert data-testid="report-error">{error}</Alert> : null}
      {notice ? <Alert>{notice}</Alert> : null}

      {!isUnlocked ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          当前为免费版报告：总分、六维得分、优势与基础建议可见；完整内容需解锁。
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={evaluateAll} disabled={pending} data-testid="evaluate-all">
          {pending ? '处理中…' : '逐题评分'}
        </Button>
        <Button variant="outline" onClick={generateReport} disabled={pending} data-testid="generate-report">
          生成报告
        </Button>
      </div>

      {/* 5.2 总分与岗位匹配度 */}
      <ScoreSummary totalScore={report.totalScore} matchScore={matchScore} />

      {/* 5.3 六维雷达图 + 数值列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">六维得分</CardTitle>
          <CardDescription>每项 0–5 分，由逐题评分聚合而来</CardDescription>
        </CardHeader>
        <CardContent data-testid="dimension-radar">
          <DimensionRadar scores={report.dimensionScores as never} />
        </CardContent>
      </Card>

      {report.summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">总评</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{report.summary}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">优势</CardTitle>
        </CardHeader>
        <CardContent>
          <BulletList items={report.highlights} empty="暂未生成，请先点「生成报告」。" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">待改进</CardTitle>
          <CardDescription>低分项会给出可执行的改进建议</CardDescription>
        </CardHeader>
        <CardContent>
          {locked('issues') ? (
            <LockedNotice label="待改进内容" />
          ) : (
            <BulletList items={report.issues} empty="暂无" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">参考回答</CardTitle>
          <CardDescription>基于你的真实经历给出改进要点，不会替你编造经历</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {locked('referenceAnswers') ? (
            <LockedNotice label="参考回答" />
          ) : report.referenceAnswers.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无</p>
          ) : (
            report.referenceAnswers.map((item, index) => (
              <div key={index} className="rounded-md border p-3 text-sm">
                <p className="font-medium">{item.question}</p>
                <p className="mt-1 text-muted-foreground">{item.improvement}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">简历风险点</CardTitle>
          <CardDescription>仅归纳简历中客观可验证的问题，不含主观评价</CardDescription>
        </CardHeader>
        <CardContent>
          {locked('resumeRisks') ? (
            <LockedNotice label="简历风险点" />
          ) : (
            <BulletList items={report.resumeRisks} empty="未发现明显风险点" />
          )}
        </CardContent>
      </Card>

      {/* 5.4 下一步训练建议：基础建议免费可见 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">下一步训练建议</CardTitle>
          <CardDescription>按你的低分维度自动生成，可直接执行</CardDescription>
        </CardHeader>
        <CardContent data-testid="training-suggestions">
          <TrainingSuggestions
            base={locked('nextSteps') ? [] : report.nextSteps.map((text) => ({ text }))}
            generated={baseSuggestions as SuggestionItem[]}
            locked={locked('nextSteps')}
          />
        </CardContent>
      </Card>

      {/* 5.5 逐题反馈：默认折叠，避免长页一次性渲染 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">逐题反馈</CardTitle>
          <CardDescription>每条评分都引用了你的回答原文</CardDescription>
        </CardHeader>
        <CardContent>
          {locked('evaluations') ? (
            <LockedNotice label="逐题反馈与证据" />
          ) : evaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚无逐题评分，请先点上方「逐题评分」。</p>
          ) : (
            <div className="space-y-2">
              {evaluations.map((item, index) => (
                <details
                  key={item.id}
                  className="rounded-md border p-3 text-sm"
                  data-testid="evaluation-item"
                >
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn('shrink-0')}>
                      {item.questionScore} 分
                    </Badge>
                    <span className="font-medium">
                      {index + 1}. {item.questionContent}
                    </span>
                  </summary>

                  <div className="mt-3 space-y-2">
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      你的回答：{item.answerContent}
                    </p>
                    <p className="max-h-64 overflow-auto whitespace-pre-wrap">{item.feedback}</p>

                    {item.evidenceQuotes.length > 0 ? (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p className="font-medium">评分依据（回答原文）</p>
                        {item.evidenceQuotes.map((quote, quoteIndex) => (
                          <p key={quoteIndex}>
                            「{quote.quote}」——{quote.reason}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    {/*
                      参考答案：放在逐题反馈的最下方。
                      顺序有意如此——先看自己的回答与评分依据（诊断），
                      再看参考答案（示范），避免用户直接跳到答案而跳过反思。
                    */}
                    {item.referenceAnswer ? (
                      <div className="space-y-2 border-t pt-3" data-testid="reference-answer">
                        <p className="text-xs font-medium">参考答案（基于你的简历经历）</p>
                        <ReferenceAnswerBody text={item.referenceAnswer} />
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
