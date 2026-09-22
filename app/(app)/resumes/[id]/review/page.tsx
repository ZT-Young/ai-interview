import Link from 'next/link'

import { ResumeReviewForm, type ResumeParsedData } from '@/components/features/parse/resume-review-form'
import { requirePageUser } from '@/lib/api/guard'
import { getResume } from '@/lib/services/handlers/resume-service'

export const metadata = { title: '确认简历解析结果' }
export const dynamic = 'force-dynamic'

const EMPTY: ResumeParsedData = {
  name: '',
  years: 0,
  skills: [],
  projects: [],
  education: [],
  risks: [],
}

/** 从 extraction_meta 中读取低置信度字段（docs/engineering/AI_PROMPTS.md §4.2） */
function lowConfidenceOf(meta: unknown): string[] {
  if (meta && typeof meta === 'object' && 'low_confidence_fields' in meta) {
    const value = (meta as { low_confidence_fields?: unknown }).low_confidence_fields
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  }
  return []
}

export default async function ResumeReviewPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser()
  // getResume 内含越权校验：他人简历返回 404
  const resume = await getResume(user.id, params.id)

  const parsed = (resume.parsedData as ResumeParsedData | null) ?? EMPTY

  return (
    <main className="container max-w-3xl space-y-6 py-10">
      <div className="space-y-1">
        <Link href="/resumes" className="text-sm underline underline-offset-4">
          返回简历列表
        </Link>
        <h1 className="text-2xl font-bold">确认解析结果</h1>
        <p className="text-sm text-muted-foreground">
          请核对简历信息是否准确；AI 未提取到的信息不会替你编造，缺少的部分请自行补全
        </p>
      </div>

      <ResumeReviewForm
        resumeId={resume.id}
        fileName={resume.fileName}
        parseStatus={resume.parseStatus}
        parseError={resume.parseError}
        rawText={resume.rawText}
        initialData={parsed}
        lowConfidenceFields={lowConfidenceOf(resume.extractionMeta)}
      />
    </main>
  )
}
