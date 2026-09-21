import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePageUser } from '@/lib/api/guard'
import { listJobJds } from '@/lib/services/job-jd-service'

export const metadata = { title: '岗位 JD' }
export const dynamic = 'force-dynamic'

const PAGE = { limit: 50, offset: 0 }

export default async function JobJdsPage() {
  const user = await requirePageUser()
  const { items } = await listJobJds(user.id, PAGE)

  return (
    <main className="container space-y-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">我的岗位 JD</h1>
          <p className="text-sm text-muted-foreground">粘贴 JD 文本或上传 JD 图片，AI 会解析出要求。</p>
        </div>
        <Button asChild>
          <Link href="/jd/new">添加 JD</Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">还没有岗位 JD</CardTitle>
            <CardDescription>粘贴一段 JD 文本即可开始。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/jd/new">添加第一个 JD</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((jobJd) => (
            <Card key={jobJd.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{jobJd.title || '（未识别岗位名称）'}</span>
                    <Badge variant={jobJd.parseStatus === 'success' ? 'default' : 'secondary'}>
                      {jobJd.parseStatus === 'success' ? '已解析' : '需手动确认'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {jobJd.company || '未识别公司'} ·{' '}
                    {new Date(jobJd.createdAt).toLocaleString('zh-CN')}
                  </p>
                  {jobJd.parseError ? (
                    <p className="text-xs text-amber-600">{jobJd.parseError}</p>
                  ) : null}
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/jd/${jobJd.id}/review`}>查看 / 修改</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  )
}
