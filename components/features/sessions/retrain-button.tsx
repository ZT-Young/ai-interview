'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/api-client'

/**
 * 再次训练：用**同一简历与 JD**新建一个会话，并跳到它的面试计划页。
 *
 * 复用 `POST /api/sessions`（与新建面试同一接口），
 * 因此归属校验、至少关联一项资料等约束都由服务端保证。
 */
export function RetrainButton({
  resumeId,
  jobJdId,
  className,
}: {
  resumeId: string | null
  jobJdId: string | null
  className?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canRetrain = Boolean(resumeId || jobJdId)

  async function retrain() {
    setPending(true)
    setError(null)
    try {
      const result = await api.post<{ session: { id: string } }>('/api/sessions', {
        ...(resumeId ? { resumeId } : {}),
        ...(jobJdId ? { jobJdId } : {}),
      })
      router.push(`/sessions/${result.session.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '创建训练失败，请稍后重试')
      setPending(false)
    }
  }

  if (!canRetrain) {
    return (
      <Button variant="outline" size="sm" disabled className={className}>
        再次训练
      </Button>
    )
  }

  return (
    <span className={className}>
      <Button
        variant="outline"
        size="sm"
        onClick={retrain}
        disabled={pending}
        data-testid="retrain-button"
      >
        {pending ? '创建中…' : '再次训练'}
      </Button>
      {error ? <span className="ml-2 text-xs text-destructive">{error}</span> : null}
    </span>
  )
}
