'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Alert } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiClientError } from '@/lib/api-client'
import { QUESTION_SOURCE_LABELS, SCORE_DIMENSION_LABELS } from '@/lib/constants/questions'
import { cn } from '@/lib/utils'

import { ConnectionBanner, useOnlineStatus } from './connection-banner'
import { MessageBubble } from './message-bubble'
import { QuestionTimer, useQuestionElapsed } from './question-timer'
import { VoiceInputButton } from './voice-input-button'

export interface StepQuestion {
  id: string
  orderIndex: number
  depth: number
  type: string
  source: string
  dimension: string
  content: string
  expectedPoints: string[]
  followUpAllowed: boolean
}

export interface StepMessage {
  id: string
  role: string
  type: string
  content: string
}

export interface Step {
  phase: string
  message: StepMessage | null
  question: StepQuestion | null
  progress: { answered: number; total: number }
  finished: boolean
  followUpReason?: string
  focus?: string
}

type TranscriptItem = StepMessage & { followUpReason?: string | null }

/**
 * 面试房间主容器（docs/UI.md §4）。
 *
 * 编排由服务端状态机驱动：本组件只展示「当前唯一一道题」并提交动作，
 * **不自行决定是否追问**（层数上限由服务端强制）。
 * 断线时禁用提交，恢复后自动同步进度。
 */
export function InterviewConsole({
  sessionId,
  initialStep,
}: {
  sessionId: string
  initialStep: Step
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(initialStep)
  const [answer, setAnswer] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptItem[]>(
    initialStep.message
      ? [{ ...initialStep.message, followUpReason: initialStep.followUpReason ?? null }]
      : [],
  )

  const online = useOnlineStatus()
  const elapsed = useQuestionElapsed(step.question?.id ?? null, !step.finished)
  const transcriptEndRef = useRef<HTMLDivElement | null>(null)

  // 新消息时滚动到底部（移动端体验）
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript.length])

  const applyStep = useCallback((next: Step) => {
    setStep(next)
    if (next.message) {
      setTranscript((previous) => [
        ...previous,
        { ...next.message!, followUpReason: next.followUpReason ?? null },
      ])
    }
  }, [])

  /** 断线恢复后同步服务端当前进度 */
  const syncProgress = useCallback(async () => {
    try {
      const latest = await api.get<Step>(`/api/sessions/${sessionId}/next`)
      if (latest.question && latest.question.id !== step.question?.id) {
        applyStep(latest)
      } else {
        setStep((previous) => ({ ...previous, progress: latest.progress, phase: latest.phase }))
      }
    } catch {
      // 同步失败不影响本地展示，下次操作仍会走服务端校验
    }
  }, [sessionId, step.question?.id, applyStep])

  async function submit(action: 'answer' | 'skip' | 'hint') {
    if (!online) {
      setError('当前处于离线状态，请在网络恢复后提交')
      return
    }

    setPending(true)
    setError(null)
    setNotice(null)

    try {
      const result = await api.post<Step & { recorded: StepMessage | null }>(
        `/api/sessions/${sessionId}/answers`,
        {
          action,
          questionId: step.question?.id,
          content: action === 'answer' ? answer : undefined,
          // 计时用于记录回答耗时（answers.duration_ms）
          durationMs: action === 'answer' ? elapsed * 1000 : undefined,
        },
      )

      if (result.recorded) {
        setTranscript((previous) => [...previous, result.recorded!])
      }
      if (action === 'answer') setAnswer('')
      applyStep(result)
      router.refresh()
    } catch (err) {
      // 失败时**不清空输入**，便于重试
      setError(err instanceof ApiClientError ? err.message : '提交失败，请检查网络后重试')
    } finally {
      setPending(false)
    }
  }

  async function finish() {
    setPending(true)
    setError(null)
    try {
      await api.post(`/api/sessions/${sessionId}/finish`)
      setStep({ ...step, phase: 'FINISHED', finished: true, message: null, question: null })
      setTranscript((previous) => [
        ...previous,
        { id: `local-${Date.now()}`, role: 'system', type: 'system', content: '面试已结束。' },
      ])
      setConfirmFinish(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '结束失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  const finished = step.finished || step.phase === 'FINISHED'
  const isFollowUp = (step.question?.depth ?? 0) > 0

  return (
    <div className="flex flex-col gap-4">
      {/* 顶栏：返回 / 进度 / 计时 */}
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <Link
          href={`/sessions/${sessionId}`}
          className="text-sm underline underline-offset-4"
          data-testid="back-to-plan"
        >
          ← 计划
        </Link>
        <Badge variant={finished ? 'secondary' : 'default'} data-testid="interview-status">
          {finished ? '已结束' : isFollowUp ? `追问 ${step.question?.depth}/2` : '进行中'}
        </Badge>
        <span className="text-sm text-muted-foreground" data-testid="progress">
          进度 {step.progress.answered}/{step.progress.total}
        </span>
        {!finished ? (
          <QuestionTimer seconds={elapsed} className="ml-auto" />
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        AI 生成内容 · 仅供练习参考，不构成任何录用判断
      </p>

      <ConnectionBanner onReconnect={syncProgress} />

      {error ? <Alert data-testid="interview-error">{error}</Alert> : null}
      {notice ? <Alert>{notice}</Alert> : null}

      {/* 对话区 */}
      <div className="space-y-4" data-testid="transcript">
        {transcript.map((item) => (
          <MessageBubble
            key={item.id}
            role={item.role as 'ai' | 'user' | 'system'}
            content={item.content}
            type={item.type}
            followUpReason={item.followUpReason}
            emphasize={item.type === 'question' || item.type === 'follow_up'}
          >
            {item.id === step.question?.id && step.question ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="outline">
                  {QUESTION_SOURCE_LABELS[
                    step.question.source as keyof typeof QUESTION_SOURCE_LABELS
                  ] ?? step.question.source}
                </Badge>
                <Badge variant="secondary">
                  {SCORE_DIMENSION_LABELS[
                    step.question.dimension as keyof typeof SCORE_DIMENSION_LABELS
                  ] ?? step.question.dimension}
                </Badge>
              </div>
            ) : null}
          </MessageBubble>
        ))}

        {transcript.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">暂无可回答的问题</CardTitle>
              <CardDescription>请返回面试计划页确认计划已生成。</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <div ref={transcriptEndRef} />
      </div>

      {/* 已结束状态 */}
      {finished ? (
        <Card data-testid="interview-finished">
          <CardHeader>
            <CardTitle className="text-base">面试已结束</CardTitle>
            <CardDescription>
              共完成 {step.progress.answered} / {step.progress.total} 道主问题。报告生成将在后续阶段实现。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/sessions/${sessionId}/report`} data-testid="view-report">
                  查看评分与报告
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/sessions/${sessionId}`}>返回面试计划</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 期望要点（自查用，默认折叠） */}
          {step.question && step.question.expectedPoints.length > 0 ? (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">查看期望要点（自查用）</summary>
              <ul className="mt-2 list-inside list-disc space-y-0.5">
                {step.question.expectedPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* 底部操作区（移动端贴底 + 安全区） */}
          <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <textarea
              aria-label="你的回答"
              data-testid="answer-input"
              rows={3}
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value)
                setNotice(null)
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  if (answer.trim().length > 0) void submit('answer')
                }
              }}
              placeholder="用文字作答，或按住下方「按住说话」用语音输入"
              className="max-h-40 min-h-[4.5rem] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <div className="flex flex-wrap items-center gap-2">
              <VoiceInputButton
                sessionId={sessionId}
                disabled={pending || !online}
                onTranscribed={(text) => {
                  setNotice('已转写为文字，请确认后提交')
                  setAnswer((previous) => (previous.trim().length > 0 ? `${previous} ${text}` : text))
                }}
                onError={(message) => setError(message)}
              />

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => submit('hint')}
                disabled={pending || !online}
              >
                请求提示
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => submit('skip')}
                disabled={pending || !online}
              >
                跳过此题
              </Button>

              <Button
                type="button"
                size="sm"
                className={cn('ml-auto')}
                onClick={() => submit('answer')}
                disabled={pending || !online || answer.trim().length === 0}
                data-testid="submit-answer"
              >
                {pending ? '提交中…' : '提交回答'}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                每道主问题最多追问 2 层；回答过短会追问更多细节。
              </span>
              {confirmFinish ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">确认结束？</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={finish}
                    disabled={pending}
                    data-testid="confirm-finish"
                  >
                    确认结束
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmFinish(false)}
                    disabled={pending}
                  >
                    取消
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmFinish(true)}
                  disabled={pending}
                  data-testid="finish-interview"
                >
                  结束面试
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
