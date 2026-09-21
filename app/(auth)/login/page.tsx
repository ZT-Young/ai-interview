import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { LoginForm } from '@/components/features/auth/login-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { optionalUser } from '@/lib/api/guard'

export const metadata: Metadata = { title: '登录' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  // 已登录用户直接回工作台，避免重复登录
  if (await optionalUser()) redirect('/')

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild className="text-xl">
          <h1>登录</h1>
        </CardTitle>
        <CardDescription>使用邮箱与密码登录</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
