import Link from 'next/link'

import { JdReviewForm, type JdParsedData } from '@/components/features/parse/jd-review-form'
import { requirePageUser } from '@/lib/api/guard'
import { getJobJd } from '@/lib/services/handlers/job-jd-service'

export const metadata = { title: '确认 JD 解析结果' }
export const dynamic = 'force-dynamic'

const EMPTY: JdParsedData = {
  title: '',
  company: '',
  must_have: [],
  nice_to_have: [],
  responsibilities: [],
  keywords: [],
}

function lowConfidenceOf(meta: unknown): string[] {
  if (meta && typeof meta === 'object' && 'low_confidence_fields' in meta) {
    const value = (meta as { low_confidence_fields?: unknown }).low_confidence_fields
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  }
  return []
}

export default async function JdReviewPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser()
  // 越权校验：他人 JD 返回 404
  const jobJd = await getJobJd(user.id, params.id)
  const parsed = (jobJd.parsedData as JdParsedData | null) ?? EMPTY

  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <div className="space-y-1">
        <Link href="/jd" className="text-sm underline underline-offset-4">
          返回 JD 列表
        </Link>
        <h1 className="text-2xl font-bold">确认 JD 解析结果</h1>
        <p className="text-sm text-muted-foreground">
          请核对岗位要求是否已正确解析——解析错误会影响出题方向，请先修正再进入面试计划。
        </p>
      </div>

      <JdReviewForm
        jobJdId={jobJd.id}
        parseStatus={jobJd.parseStatus}
        parseError={jobJd.parseError}
        initialData={parsed}
        lowConfidenceFields={lowConfidenceOf(jobJd.extractionMeta)}
      />
    </main>
  )
}
