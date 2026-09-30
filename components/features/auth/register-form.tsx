'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'

/** 与 lib/validators/auth.ts 的 phoneSchema 保持一致（仅用于前端即时提示） */
const PHONE_RE = /^1[3-9]\d{9}$/

type Channel = 'email' | 'phone'

/**
 * 注册表单（邮箱 / 手机号双通道）。
 *
 * 校验以服务端为准（lib/validators/auth.ts）；此处只做即时体验提示。
 *
 * **注册成功后跳登录页，不直接进入产品**：注册与登录被刻意拆成两个独立步骤
 * （产品约定：登录进去的界面才是 AI 面试工作台）。
 * 服务端注册时虽已写入会话 Cookie，这里仍引导用户自己登录一次，
 * 并用 `?registered=1` 让登录页给出「注册成功」确认。
 */
export function RegisterForm() {
  const router = useRouter()
  const [channel, setChannel] = useState<Channel>('email')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  /** 手机号通道的可选密码：设置后可用「手机号 + 密码」登录 */
  const [phonePassword, setPhonePassword] = useState('')

  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /** 验证码发送倒计时（秒）；0 表示可再次发送 */
  const [countdown, setCountdown] = useState(0)
  /** 短信验证码提示（演示环境由服务端下发，前端不硬编码固定码） */
  const [codeHint, setCodeHint] = useState<string | null>(null)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => setCountdown((value) => (value <= 1 ? 0 : value - 1)), 1000)
    return () => clearInterval(timer)
  }, [countdown])

  async function handleSendCode() {
    setError(null)
    if (!PHONE_RE.test(phone.trim())) {
      setError('请输入正确的手机号')
      return
    }
    try {
      const result = await api.post<{ hint?: string }>('/api/auth/sms-code', {
        phone: phone.trim(),
      })
      setCodeHint(result.hint ?? null)
      setCountdown(60)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '验证码发送失败，请稍后重试')
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    try {
      if (channel === 'email') {
        await api.post('/api/auth/register', {
          channel: 'email',
          email,
          password,
          acceptTerms,
        })
      } else {
        await api.post('/api/auth/register', {
          channel: 'phone',
          phone: phone.trim(),
          code: code.trim(),
          // 未填写则不传：服务端据此判定该账号只能用验证码登录
          ...(phonePassword ? { password: phonePassword } : {}),
          acceptTerms,
        })
      }
      // 注册 ≠ 进入产品：交给用户自己登录一次（见文件顶部说明）
      router.push('/login?registered=1')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '注册失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
      active
        ? 'bg-primary-muted font-medium text-accent-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      {/* 通道切换 */}
      <div
        className="flex gap-1 rounded-lg border p-1"
        role="tablist"
        aria-label="注册方式"
      >
        <button
          type="button"
          role="tab"
          aria-selected={channel === 'email'}
          className={tabClass(channel === 'email')}
          onClick={() => setChannel('email')}
        >
          邮箱注册
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={channel === 'phone'}
          className={tabClass(channel === 'phone')}
          onClick={() => setChannel('phone')}
        >
          手机号注册
        </button>
      </div>

      {channel === 'email' ? (
        <>
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
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="phone">手机号</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="11 位手机号"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">验证码</Label>
            <div className="flex gap-2">
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="请输入验证码"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSendCode}
                disabled={countdown > 0 || !PHONE_RE.test(phone.trim())}
                className="shrink-0"
              >
                {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
              </Button>
            </div>
            {codeHint ? (
              <p className="text-xs text-muted-foreground" data-testid="sms-code-hint">
                {codeHint}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone-password">
              密码（可选）
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                设置后可用手机号 + 密码登录
              </span>
            </Label>
            <Input
              id="phone-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={phonePassword}
              onChange={(event) => setPhonePassword(event.target.value)}
              placeholder="不设则仅用验证码登录"
            />
          </div>
        </>
      )}

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

      <p className="text-center text-xs text-muted-foreground">
        注册后会自动生成一个用户名（手机号用户为「用户+尾号四位」），登录后可自行修改。
      </p>
    </form>
  )
}
