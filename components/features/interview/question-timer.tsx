'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils/index'

/** 秒 → mm:ss */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * 当前题计时（唯一实现）。
 *
 * 从题目出现开始计时；换题（questionId 变化）即重置。
 * **不强制限时**——超时不会自动提交，仅作节奏参考（docs/design/UI.md §4.2）。
 */
export function useQuestionElapsed(questionId: string | null, running: boolean): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    setSeconds(0)
  }, [questionId])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [running, questionId])

  return seconds
}

/** 计时展示 */
export function QuestionTimer({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <span
      className={cn('font-mono text-sm tabular-nums text-muted-foreground', className)}
      aria-label={`本题用时 ${formatDuration(seconds)}`}
    >
      {formatDuration(seconds)}
    </span>
  )
}
