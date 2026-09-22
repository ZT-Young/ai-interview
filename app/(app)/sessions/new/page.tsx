import Link from 'next/link'

import { CreateSessionForm } from '@/components/features/plan/create-session-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePageUser } from '@/lib/api/guard'
import { listResumes } from '@/lib/services/handlers/resume-service'
import { listJobJds } from '@/lib/services/handlers/job-jd-service'

export const metadata = { title: '新建面试' }
export const dynamic = 'force-dynamic'

const PAGE = { limit: 50, offset: 0 }

export default async function NewSessionPage() {
  const user = await requirePageUser()
  const [{ items: resumeItems }, { items: jdItems }] = await Promise.all([
    listResumes(user.id, PAGE),
    listJobJds(user.id, PAGE),
  ])

  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <div>
        <h1 className="text-2xl font-bold">新建面试</h1>
        <p className="text-sm text-muted-foreground">
          选择一份简历与一个岗位 JD，AI 会据此生成针对性的面试计划。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">选择面试依据</CardTitle>
          <CardDescription>只有解析成功的简历与 JD 才能用于生成计划</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateSessionForm
            resumes={resumeItems.map((item) => ({
              id: item.id,
              label: `${item.fileName}${item.parseStatus === 'success' ? '' : '（未解析成功，不可用）'}`,
              disabled: item.parseStatus !== 'success',
            }))}
            jobJds={jdItems.map((item) => ({
              id: item.id,
              label: `${item.title || '未命名岗位'}${item.parseStatus === 'success' ? '' : '（未解析成功，不可用）'}`,
              disabled: item.parseStatus !== 'success',
            }))}
          />
        </CardContent>
      </Card>

      <Link href="/sessions" className="text-sm underline underline-offset-4">
        返回面试列表
      </Link>
    </main>
  )
}
