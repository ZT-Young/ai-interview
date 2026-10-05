'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { api, ApiClientError } from '@/lib/http/api-client'

/**
 * 发起查看邀请（B 端场景 A 的邀请分支）。
 *
 * **这一支刻意不产生任何可读数据**：面试官只能提交「我想看谁的」，
 * 候选人接受并选定分享哪一场之后才有内容。
 * 界面上必须把这件事说清楚 —— 否则面试官会以为发出去就等于能看了。
 */
export function InviteForm() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setDone(null)
    setPending(true)
    try {
      await api.post('/api/interviewer/invites', {
        candidateIdentifier: identifier.trim(),
        note: note.trim() || undefined,
      })
      setDone('邀请已发出，等待候选人确认。')
      setIdentifier('')
      setNote('')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '邀请发送失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="invite-form">
      <div className="space-y-2">
        <Label htmlFor="candidate">候选人的邮箱 / 手机号 / 用户名</Label>
        <Input
          id="candidate"
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="如 alice@example.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="note">附言（可选）</Label>
        <Input
          id="note"
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="说明你希望了解什么"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" data-testid="invite-done" className="text-sm text-success">
          {done}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? '发送中…' : '发起邀请'}
      </Button>
    </form>
  )
}
