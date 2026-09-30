import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { LoginForm } from '@/components/features/auth/login-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { optionalUser } from '@/lib/api/guard'

export const metadata: Metadata = { title: '登录' }
export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  /** 注册成功后带着 `?registered=1` 回到这里，用于给出确认提示 */
  searchParams?: { registered?: string }
}) {
  // 已登录用户直接回工作台，避免重复登录
  if (await optionalUser()) redirect('/')

  const justRegistered = searchParams?.registered === '1'

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild className="text-xl">
          <h1>登录</h1>
        </CardTitle>
        <CardDescription>使用邮箱与密码登录</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {justRegistered ? (
          <div
            role="status"
            data-testid="register-success-hint"
            className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
          >
            注册成功，请用刚才的邮箱与密码登录。
          </div>
        ) : null}

        <LoginForm />
        <p className="text-center text-sm text-muted-foreground">
          还没有账号？
          <Link href="/register" className="ml-1 underline underline-offset-4">
            注册
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
