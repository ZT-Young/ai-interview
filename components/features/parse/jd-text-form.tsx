'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/api-client'

/** 粘贴 JD 文本并解析（最小可用输入路径） */
export function JdTextForm() {
  const router = useRouter()
  const [rawText, setRawText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    try {
      const result = await api.post<{ jobJd: { id: string } }>('/api/job-jds/parse', { rawText })
      router.push(`/jd/${result.jobJd.id}/review`)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '解析失败，请稍后重试')
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="rawText">JD 原文</Label>
        <textarea
          id="rawText"
          required
          minLength={10}
          rows={10}
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder="把招聘网站上的岗位描述整段粘贴到这里…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <Button type="submit" disabled={pending || rawText.trim().length < 10}>
        {pending ? '解析中…' : '解析 JD'}
      </Button>
    </form>
  )
}
