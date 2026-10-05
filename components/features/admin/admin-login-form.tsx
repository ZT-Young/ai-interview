'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'

/**
 * 管理端登录表单。
 *
 * **刻意不复用用户端 `LoginForm`**：那一侧有身份选择（面试者/面试官）、
 * 注册引导、验证码登录等面向求职者的东西，会出现在后台登录页上，
 * 既不对，也把两端的 UI 绑死了。管理端只保留「邮箱/手机号/用户名 + 密码」。
 *
 * 失败文案一律以服务端为准：账号不存在、密码错误、不是管理员
 * 三者在服务端返回同一句，避免把「该账号存在但无权」变成可枚举的信息。
 */
export function AdminLoginForm() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await api.post('/api/auth/admin/login', {
        mode: 'password',
        identifier: identifier.trim(),
        password,
      })
      router.push('/admin')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '登录失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="admin-login-form">
      {error ? <Alert>{error}</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="identifier">管理员账号</Label>
        <Input
          id="identifier"
          autoComplete="username"
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="邮箱 / 手机号 / 用户名"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">密码</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '登录中…' : '登录管理后台'}
      </Button>
    </form>
  )
}
