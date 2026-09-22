'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'

/**
 * 注册表单。
 *
 * 校验以服务端为准（lib/validators/auth.ts）；此处只做即时体验提示。
 * 注册成功后服务端已写入会话 Cookie，直接跳转工作台。
 */
export function RegisterForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    try {
      await api.post('/api/auth/register', { email, password, acceptTerms })
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '注册失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="email">邮箱</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">密码</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 8 位"
        />
      </div>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="mt-1"
          checked={acceptTerms}
          onChange={(event) => setAcceptTerms(event.target.checked)}
        />
        <span>
          我已阅读并同意
          <Link href="/legal/terms" target="_blank" className="mx-1 underline underline-offset-4">
            《用户协议》
          </Link>
          与
          <Link href="/legal/privacy" target="_blank" className="mx-1 underline underline-offset-4">
            《隐私政策》
          </Link>
          ，并已知悉
          <Link
            href="/legal/ai-disclosure"
            target="_blank"
            className="mx-1 underline underline-offset-4"
          >
            《AI 生成内容说明》
          </Link>
          —— 面试内容由 AI 生成，仅供练习参考，不构成任何录用判断。
        </span>
      </label>

      <Button type="submit" className="w-full" disabled={pending || !acceptTerms}>
        {pending ? '注册中…' : '注册并开始'}
      </Button>
    </form>
  )
}
