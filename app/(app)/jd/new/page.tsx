import Link from 'next/link'

import { JdTextForm } from '@/components/features/parse/jd-text-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: '添加岗位 JD' }
export const dynamic = 'force-dynamic'

export default function NewJobJdPage() {
  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <div>
        <h1 className="text-2xl font-bold">添加岗位 JD</h1>
        <p className="text-sm text-muted-foreground">
          粘贴 JD 原文，AI 会拆分出硬性要求、加分项、职责与关键词。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">粘贴 JD 文本</CardTitle>
          <CardDescription>复制招聘页面上的岗位描述整段粘贴即可</CardDescription>
        </CardHeader>
        <CardContent>
          <JdTextForm />
        </CardContent>
      </Card>

      <Link href="/jd" className="text-sm underline underline-offset-4">
        返回 JD 列表
      </Link>
    </main>
  )
}
