'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'
import { homePathForRole, ROLE_OPTIONS, type Role } from './role-options'

/** 与 lib/validators/auth.ts 的 phoneSchema 保持一致（仅用于前端即时提示） */
const PHONE_RE = /^1[3-9]\d{9}$/

type Mode = 'password' | 'code'

/**
 * 登录表单：先选**登录方式**，再选**身份**，最后填凭证。
 *
 * 顺序是刻意的产品决策：
 * - 登录方式决定「要填什么」（密码 vs 验证码 + 手机号）
 * - 身份决定「登录后去哪」（`/` 工作台 vs `/interviewer` 面试官工作台）
 *
 * 身份只是**当前身份**（V1 单值列），切换不丢任何数据 —— 同一个人可以上午练、下午看别人的。
 * 失败提示由服务端统一给出（不区分账号不存在与凭证错误，防账号枚举）。
 */
export function LoginForm({ initialRole = 'candidate' }: { initialRole?: Role }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('password')
  const [role, setRole] = useState<Role>(initialRole)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const [countdown, setCountdown] = useState(0)
  const [codeHint, setCodeHint] = useState<string | null>(null)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => setCountdown((value) => (value <= 1 ? 0 : value - 1)), 1000)
    return () => clearInterval(timer)
  }, [countdown])

  const identifierIsPhone = PHONE_RE.test(identifier.trim())

  function switchMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    setError(null)
    if (next === 'code') {
      // 切到验证码模式时清掉非手机号内容，避免「标签写着手机号、框里却是邮箱」
      if (!identifierIsPhone) setIdentifier('')
    } else {
      setCodeHint(null)
    }
  }

  async function handleSendCode() {
    setError(null)
    if (!identifierIsPhone) {
      setError('验证码登录请先填写手机号')
      return
    }
    try {
      const result = await api.post<{ hint?: string }>('/api/auth/sms-code', {
        phone: identifier.trim(),
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
      await api.post(
        '/api/auth/login',
        mode === 'password'
          ? { mode: 'password', identifier: identifier.trim(), password, role }
          : { mode: 'code', identifier: identifier.trim(), code: code.trim(), role },
      )
      router.push(homePathForRole(role))
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '登录失败，请稍后重试')
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

      {/* 凭证方式切换 */}
      <div className="flex gap-1 rounded-lg border p-1" role="tablist" aria-label="登录方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          className={tabClass(mode === 'password')}
          onClick={() => switchMode('password')}
        >
          密码登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'code'}
          className={tabClass(mode === 'code')}
          onClick={() => switchMode('code')}
        >
          验证码登录
        </button>
      </div>

      {/*
        身份选择 —— 放在登录方式之后、凭证之前，与用户的心智顺序一致：
        「我要怎么登录」→「我是谁」→「填账号密码」。
      */}
      <div className="space-y-2">
        <span className="block text-sm font-medium">我是</span>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="身份">
          {ROLE_OPTIONS.map((option) => {
            const active = role === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`login-role-${option.value}`}
                onClick={() => setRole(option.value)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary-muted'
                    : 'hover:border-foreground/30 hover:bg-muted/40'
                }`}
              >
                <span className={`block text-sm ${active ? 'font-medium' : ''}`}>
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          身份只是「当前以哪个身份使用」，两侧的练习与分享数据都会保留。
        </p>
      </div>

      <div className="space-y-2">
        {/*
          密码模式：三种标识都能填，标签显式列出，避免用户不知道能填什么。
          验证码模式：服务端只接受手机号（非手机号一律 401「验证码登录请使用手机号」），
          因此这里同步收敛为手机号表单，别让用户填了邮箱才被打回来。
        */}
        {mode === 'code' ? (
          <Label htmlFor="identifier">手机号</Label>
        ) : (
          <Label htmlFor="identifier">账号（邮箱 / 手机号 / 用户名）</Label>
        )}
        <Input
          id="identifier"
          autoComplete={mode === 'code' ? 'tel' : 'username'}
          inputMode={mode === 'code' ? 'tel' : undefined}
          maxLength={mode === 'code' ? 11 : undefined}
          required
          value={identifier}
          onChange={(event) =>
            setIdentifier(mode === 'code' ? event.target.value.replace(/\D/g, '') : event.target.value)
          }
          placeholder={mode === 'code' ? '请输入 11 位手机号' : '邮箱、手机号或用户名'}
        />
        {mode === 'code' ? (
          <p className="text-xs text-muted-foreground">验证码登录仅支持手机号。</p>
        ) : null}
      </div>

      {mode === 'password' ? (
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
          <p className="text-xs text-muted-foreground">
            用手机号 + 验证码注册且未设密码的账号，请改用「验证码登录」。
          </p>
        </div>
      ) : (
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
              disabled={countdown > 0 || !identifierIsPhone}
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
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '登录中…' : '登录'}
      </Button>
    </form>
  )
}
