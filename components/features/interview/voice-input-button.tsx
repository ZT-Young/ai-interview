'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDuration } from './question-timer'

/**
 * 按住说话（语音输入）。
 *
 * 交互（docs/UI.md §4.3）：
 *   pointerdown 开始录音 → 松开停止 → 上传 → 转写文本填入输入框（**不自动提交**）
 *
 * 安全：音频只上传到本站 `POST /api/sessions/:id/answers/audio`，
 * ASR 在服务端调用，**前端不持有任何 API Key**。
 *
 * 需要安全上下文（HTTPS 或 localhost），否则浏览器不提供麦克风。
 */

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'cancelled'

export interface VoiceInputButtonProps {
  sessionId: string
  disabled?: boolean
  /** 转写成功回调：把文本交给调用方填入输入框 */
  onTranscribed: (text: string) => void
  /** 失败/提示回调：展示可读错误 */
  onError: (message: string) => void
}

/** 录音最短时长（毫秒），低于此值视为误触 */
const MIN_RECORDING_MS = 500

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate
  }
  return ''
}

export function VoiceInputButton({
  sessionId,
  disabled,
  onTranscribed,
  onError,
}: VoiceInputButtonProps) {
  const [state, setState] = useState<VoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const cancelledRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    recorderRef.current = null
    chunksRef.current = []
    setElapsed(0)
    setState('idle')
  }, [])

  useEffect(() => cleanup, [cleanup])

  async function upload(blob: Blob, mimeType: string) {
    setState('transcribing')
    const form = new FormData()
    const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    form.append('audio', blob, `answer.${extension}`)

    try {
      const response = await fetch(`/api/sessions/${sessionId}/answers/audio`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })

      const payload = (await response.json().catch(() => ({}))) as {
        text?: string
        error?: { message?: string }
      }

      if (!response.ok) {
        onError(payload.error?.message ?? '语音识别失败，请手动输入')
        return
      }

      const text = (payload.text ?? '').trim()
      if (text.length === 0) {
        onError('未识别到有效语音内容，请重新录制或手动输入')
        return
      }

      onTranscribed(text)
    } catch {
      onError('网络异常，语音识别失败，请手动输入')
    } finally {
      setState('idle')
    }
  }

  async function startRecording() {
    if (disabled || state !== 'idle') return

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onError('当前浏览器不支持录音，请手动输入')
      return
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      onError('录音需要 HTTPS 或 localhost 环境，请手动输入')
      return
    }

    const mimeType = pickMimeType()
    if (!mimeType) {
      onError('当前浏览器不支持录音格式，请手动输入')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType })

      chunksRef.current = []
      cancelledRef.current = false

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType })
        const wasCancelled = cancelledRef.current
        const duration = Date.now() - startedAtRef.current

        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
        recorderRef.current = null

        if (wasCancelled) {
          setState('idle')
          setElapsed(0)
          return
        }
        if (duration < MIN_RECORDING_MS || audioBlob.size === 0) {
          setState('idle')
          setElapsed(0)
          onError('录音时间过短，请按住多说几秒')
          return
        }

        void upload(audioBlob, mimeType)
      }

      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setElapsed(0)
      setState('recording')
      recorder.start()

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 250)
    } catch (error) {
      cleanup()
      const name = error instanceof Error ? error.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        onError('未获得麦克风权限，请在浏览器设置中允许后重试，或手动输入')
      } else if (name === 'NotFoundError') {
        onError('未检测到麦克风设备，请手动输入')
      } else {
        onError('无法启动录音，请手动输入')
      }
    }
  }

  function stopRecording(cancelled: boolean) {
    cancelledRef.current = cancelled
    if (cancelled) setState('cancelled')
    recorderRef.current?.stop()
  }

  const label =
    state === 'recording'
      ? `松开发送 ${formatDuration(elapsed)}`
      : state === 'transcribing'
        ? '识别中…'
        : '按住说话'

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant={state === 'recording' ? 'destructive' : 'outline'}
      size="sm"
      disabled={disabled || state === 'transcribing'}
      className={cn('select-none touch-none', state === 'recording' && 'animate-pulse')}
      aria-label="按住说话，进行语音输入"
      aria-pressed={state === 'recording'}
      onPointerDown={(event) => {
        event.preventDefault()
        void startRecording()
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        if (state === 'recording') stopRecording(false)
      }}
      onPointerLeave={() => {
        // 指针移出按钮（未松开）视为取消，避免误发
        if (state === 'recording') stopRecording(true)
      }}
      onPointerCancel={() => {
        if (state === 'recording') stopRecording(true)
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state === 'recording' ? '● ' : '🎤 '}
      {label}
    </Button>
  )
}
