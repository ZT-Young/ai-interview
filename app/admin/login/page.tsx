import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AdminLoginForm } from '@/components/features/admin/admin-login-form'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { optionalAdminUser } from '@/lib/api/guard'

export const metadata: Metadata = { title: '管理后台登录' }
export const dynamic = 'force-dynamic'

/**
 * 管理端登录页 —— **用户端看不到的一条独立入口**。
 *
 * 与用户端 `/login` 的三点不同：
 * 1. 路径独立（`/admin/login`），用户端任何页面都没有指向它的链接
 * 2. 校验的是**管理端会话**，用户端 `/login` 登录产生的会话在这里无效
 * 3. 不提供注册入口：管理员只能手动改库设置 `is_admin`，系统无自我提权路径
 *
 * 页面本身刻意极简（无品牌故事、无特性介绍）：它是给内部人员用的工具入口，
 * 不是对外产品页面。
 */
export default async function AdminLoginPage() {
  // 已是管理端会话 → 直接进后台，不再要求登录一次
  if (await optionalAdminUser()) redirect('/admin')

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle asChild className="text-lg">
            <h1>管理后台</h1>
          </CardTitle>
          <CardDescription>请使用管理员账号登录</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminLoginForm />
        </CardContent>
      </Card>
    </main>
  )
}
