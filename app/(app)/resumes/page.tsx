import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePageUser } from '@/lib/api/guard'
import { listResumes } from '@/lib/services/handlers/resume-service'

export const metadata = { title: '简历' }
export const dynamic = 'force-dynamic'

const PAGE = { limit: 50, offset: 0 }

const STATUS_LABEL: Record<string, string> = {
  pending: '等待解析',
  processing: '解析中',
  success: '已解析',
  failed: '需手动确认',
}

export default async function ResumesPage() {
  const user = await requirePageUser()
  const { items } = await listResumes(user.id, PAGE)

  return (
    <main className="container space-y-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">我的简历</h1>
          <p className="text-sm text-muted-foreground">
            上传后 AI 会自动解析；解析结果可随时修改。
          </p>
        </div>
        <Button asChild>
          <Link href="/resumes/new">上传简历</Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">还没有简历</CardTitle>
            <CardDescription>支持 PDF、Word（.docx）与图片，单个不超过 20MB。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/resumes/new">上传第一份简历</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((resume) => (
            <Card key={resume.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{resume.fileName}</span>
                    <Badge variant={resume.parseStatus === 'success' ? 'default' : 'secondary'}>
                      {STATUS_LABEL[resume.parseStatus] ?? resume.parseStatus}
                    </Badge>
                    {resume.isPrimary ? <Badge variant="outline">默认</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {Math.ceil(resume.fileSize / 1024)} KB ·{' '}
                    {new Date(resume.createdAt).toLocaleString('zh-CN')}
                  </p>
                  {resume.parseStatus === 'failed' && resume.parseError ? (
                    <p className="text-xs text-amber-600">{resume.parseError}</p>
                  ) : null}
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/resumes/${resume.id}/review`}>查看 / 修改</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  )
}
