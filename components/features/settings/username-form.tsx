'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'

/**
 * 修改用户名。
 *
 * 用户名既是展示名称，也是登录标识之一（与邮箱、手机号并列），
 * 因此**必须唯一** —— 唯一性由服务端查库保证，冲突返回 409。
 *
 * 规则提示照抄 lib/validators/auth.ts 的 usernameSchema：
 * 2–30 个字符，中文 / 字母 / 数字 / 下划线 / 连字符，且不能全为数字
 * （全为数字会与手机号登录标识冲突）。
 */
export function UsernameForm({ initialUsername }: { initialUsername: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initialUsername ?? '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setPending(true)

    try {
      await api.patch('/api/auth/me', { username: value.trim() })
      setNotice('用户名已更新，下次可用它登录')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '保存失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  const unchanged = value.trim() === (initialUsername ?? '')

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error ? <Alert>{error}</Alert> : null}
      {notice ? (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="username">用户名</Label>
        <Input
          id="username"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="例如：用户1234"
          maxLength={30}
          data-testid="username-input"
        />
        <p className="text-xs text-muted-foreground">
          2–30 个字符，可用中文、字母、数字、下划线或连字符；不能全为数字。
        </p>
      </div>

      <Button type="submit" size="sm" disabled={pending || unchanged || value.trim().length === 0}>
        {pending ? '保存中…' : '保存用户名'}
      </Button>
    </form>
  )
}
