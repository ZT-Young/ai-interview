'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { api, ApiClientError } from '@/lib/http/api-client'
import type { Role } from '@/components/features/auth/role-options'

/**
 * 身份切换（面试者 ↔ 面试官）。
 *
 * 身份是单值列（V1 取舍见 INTERVIEWER_SIDE §3），切换只改 `users.role`，
 * **两侧的数据都保留** —— 切换不等于清空，这点必须在界面上讲清楚，
 * 否则没人敢点（以为切过去自己练的就没了）。
 */
export function RoleSwitchCard({ currentRole }: { currentRole: Role }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target: Role = currentRole === 'interviewer' ? 'candidate' : 'interviewer'

  async function handleSwitch() {
    setError(null)
    setPending(true)
    try {
      await api.patch('/api/auth/me', { role: target })
      // 服务端已改库；刷新让服务端组件重新取身份
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '切换失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-lg border p-4" data-testid="role-switch-card">
      <p className="text-sm">
        你当前的身份是
        <strong className="mx-1 font-medium">
          {currentRole === 'interviewer' ? '面试官' : '面试者'}
        </strong>
        ，没有进入面试官工作台。
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        切换身份不会丢失任何数据：练习记录与分享记录都保留，随时可以切回来。
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button className="mt-3" onClick={handleSwitch} disabled={pending}>
        {pending ? '切换中…' : `切换为${target === 'interviewer' ? '面试官' : '面试者'}`}
      </Button>
    </div>
  )
}
