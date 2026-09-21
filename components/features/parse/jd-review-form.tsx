'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ListEditor, ParseErrorNotice, SaveBar, TextField } from '@/components/features/parse/field-editors'
import { api, ApiClientError } from '@/lib/api-client'

/** 与 lib/ai/schemas/parse.ts 的 jdDataSchema 对齐 */
export interface JdParsedData {
  title: string
  company: string
  must_have: string[]
  nice_to_have: string[]
  responsibilities: string[]
  keywords: string[]
}

export interface JdReviewProps {
  jobJdId: string
  parseStatus: string
  parseError: string | null
  initialData: JdParsedData
  lowConfidenceFields: string[]
}

const emptyData: JdParsedData = {
  title: '',
  company: '',
  must_have: [],
  nice_to_have: [],
  responsibilities: [],
  keywords: [],
}

/** JD 解析确认页表单；解析失败时同样可手动填写并保存 */
export function JdReviewForm(props: JdReviewProps) {
  const router = useRouter()
  const [data, setData] = useState<JdParsedData>(props.initialData ?? emptyData)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(props.parseError)
  const [retrying, setRetrying] = useState(false)

  const flagged = (path: string) => props.lowConfidenceFields.includes(path)

  /**
   * 重新解析。
   *
   * ⚠️ 早期实现这里只 `router.refresh()` —— 那只是**重新读取已有数据**，
   * 根本不会重新调用模型，用户点「重新解析」看到结果毫无变化会以为功能坏了。
   * 现在真正调用 `POST /api/job-jds/:id/parse`。
   */
  async function handleRetry() {
    setRetrying(true)
    setError(null)
    try {
      const result = await api.post<{
        jobJd: { parsedData: JdParsedData | null; parseError: string | null }
        parse: { status: string; error?: string }
      }>(`/api/job-jds/${props.jobJdId}/parse`)

      if (result.jobJd.parsedData) setData(result.jobJd.parsedData)
      setParseError(
        result.parse.status === 'success' ? null : (result.parse.error ?? '解析失败'),
      )
      router.refresh()
    } catch (err) {
      // 503（模型未配置）也属于「解析没成功」，把原因展示出来而不是只报「失败」
      setError(err instanceof ApiClientError ? err.message : '重新解析失败')
    } finally {
      setRetrying(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/api/job-jds/${props.jobJdId}`, {
        parsedData: data,
        title: data.title || null,
        company: data.company || null,
      })
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={props.parseStatus === 'success' ? 'default' : 'secondary'}>
          {props.parseStatus === 'success' ? '解析成功' : '待确认'}
        </Badge>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      <ParseErrorNotice message={parseError} onRetry={handleRetry} retrying={retrying} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">岗位信息</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="岗位名称"
            value={data.title}
            onChange={(value) => setData({ ...data, title: value })}
          />
          <TextField
            label="公司"
            value={data.company}
            onChange={(value) => setData({ ...data, company: value })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">硬性要求（must have）</CardTitle>
          <CardDescription>决定面试会重点考察什么，请按原文校正</CardDescription>
        </CardHeader>
        <CardContent>
          <ListEditor
            name="must_have"
            items={data.must_have}
            flagged={flagged('must_have')}
            onChange={(must_have) => setData({ ...data, must_have })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">加分项（nice to have）</CardTitle>
        </CardHeader>
        <CardContent>
          <ListEditor
            name="nice_to_have"
            items={data.nice_to_have}
            flagged={flagged('nice_to_have')}
            onChange={(nice_to_have) => setData({ ...data, nice_to_have })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">岗位职责</CardTitle>
        </CardHeader>
        <CardContent>
          <ListEditor
            name="responsibilities"
            items={data.responsibilities}
            flagged={flagged('responsibilities')}
            onChange={(responsibilities) => setData({ ...data, responsibilities })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">关键词</CardTitle>
        </CardHeader>
        <CardContent>
          <ListEditor
            name="keywords"
            items={data.keywords}
            flagged={flagged('keywords')}
            onChange={(keywords) => setData({ ...data, keywords })}
          />
        </CardContent>
      </Card>

      <SaveBar saving={saving} savedAt={savedAt} onSave={handleSave} />
    </div>
  )
}
