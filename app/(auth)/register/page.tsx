import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { RegisterForm } from '@/components/features/auth/register-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { optionalUser } from '@/lib/api/guard'

export const metadata: Metadata = { title: '注册' }
export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  if (await optionalUser()) redirect('/')

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild className="text-xl">
          <h1>注册</h1>
        </CardTitle>
        <CardDescription>注册后可获得免费模拟面试次数</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RegisterForm />
        <p className="text-center text-sm text-muted-foreground">
          已有账号？
          <Link href="/login" className="ml-1 underline underline-offset-4">
            登录
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
