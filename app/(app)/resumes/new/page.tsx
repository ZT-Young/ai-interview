import Link from 'next/link'

import { ResumeUploadForm } from '@/components/features/parse/resume-upload-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: '上传简历' }
export const dynamic = 'force-dynamic'

export default function NewResumePage() {
  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <div>
        <h1 className="text-2xl font-bold">上传简历</h1>
        <p className="text-sm text-muted-foreground">
          上传后会立即解析，解析失败也可以手动填写。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">选择文件</CardTitle>
          <CardDescription>
            支持 PDF、Word（.docx）与图片（PNG / JPG）。旧版 .doc 请先另存为 .docx。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResumeUploadForm />
        </CardContent>
      </Card>

      <Link href="/resumes" className="text-sm underline underline-offset-4">
        返回简历列表
      </Link>
    </main>
  )
}
