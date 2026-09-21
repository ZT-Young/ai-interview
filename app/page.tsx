import Link from 'next/link'

import { LogoutButton } from '@/components/features/auth/logout-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { optionalUser } from '@/lib/api/guard'

/** 强制动态渲染：需要读取会话 Cookie 判断登录态 */
export const dynamic = 'force-dynamic'

/**
 * 工作台首页。
 * Phase 1 提供登录态展示与登出入口；简历/JD/面试入口在 Phase 2/3 接入。
 */
export default async function HomePage() {
  const user = await optionalUser()

  return (
    <main className="container flex min-h-dvh flex-col gap-8 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Badge variant="secondary">AI 生成内容 · 仅供练习参考</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">AI 模拟面试</h1>
          <p className="max-w-2xl text-muted-foreground">
            粘贴目标岗位 JD、上传简历，AI 扮演面试官进行模拟面试，最后生成评分报告与提升建议。
          </p>
        </div>
        {user ? <LogoutButton /> : null}
      </div>

      {user ? (
        <Card>
          <CardHeader>
            <CardTitle>欢迎回来</CardTitle>
            <CardDescription>
              {user.email} · 会员等级 {user.membership} · 剩余免费次数 {user.freeCredits}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>先准备简历与岗位 JD，AI 会据此生成针对性的面试计划。</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="sm">
                <Link href="/sessions/new">新建面试</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/resumes">我的简历</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/jd">岗位 JD</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/api/health" prefetch={false}>
                  健康检查
                </Link>
              </Button>
              {user.isAdmin ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href="/admin">管理后台</Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>开始之前</CardTitle>
            <CardDescription>登录后即可创建简历与岗位 JD，开始一次模拟面试。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/register">注册</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">登录</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
