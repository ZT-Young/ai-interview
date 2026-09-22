'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'

/**
 * 手动调整用户免费次数（敏感操作，docs/design/UI.md §8.4）。
 *
 * 必须填写原因 —— 原因会写入审计日志，便于事后追溯「为什么改了这个数」。
 */
export function CreditsAdjustForm({
  userId,
  currentCredits,
}: {
  userId: string
  currentCredits: number
}) {
  const router = useRouter()
  const [value, setValue] = useState(String(currentCredits))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setDone(null)

    try {
      const result = await api.post<{ before: number; after: number }>(
        `/api/admin/users/${userId}/credits`,
        { freeCredits: Number(value), reason },
      )
      setDone(`已从 ${result.before} 调整为 ${result.after}`)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '调整失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border p-3">
      {error ? <Alert>{error}</Alert> : null}
      {done ? <p className="text-xs text-emerald-600">{done}</p> : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`credits-${userId}`} className="text-xs">
            免费次数
          </Label>
          <Input
            id={`credits-${userId}`}
            type="number"
            min={0}
            max={1000}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="h-8 w-24"
          />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Label htmlFor={`reason-${userId}`} className="text-xs">
            调整原因（写入审计日志）
          </Label>
          <Input
            id={`reason-${userId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：客服工单补偿"
            className="h-8"
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending || reason.trim().length === 0}>
          {pending ? '提交中…' : '调整'}
        </Button>
      </div>
    </form>
  )
}
