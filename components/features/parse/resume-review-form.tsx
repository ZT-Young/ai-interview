'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ListEditor,
  ParseErrorNotice,
  SaveBar,
  TextField,
} from '@/components/features/parse/field-editors'
import { Badge } from '@/components/ui/badge'
import { api, ApiClientError } from '@/lib/http/api-client'
import { Alert } from '@/components/ui/input'

/** 与 lib/ai/schemas/parse.ts 的 resumeDataSchema 对齐（前端编辑用宽松类型） */
export interface ResumeParsedData {
  name: string
  years: number
  skills: string[]
  projects: Array<{
    name: string
    role: string
    actions: string[]
    results: string[]
    evidence: string[]
  }>
  education: Array<{ school: string; degree: string; major: string; period: string }>
  risks: string[]
}

export interface ResumeReviewProps {
  resumeId: string
  fileName: string
  parseStatus: string
  parseError: string | null
  rawText: string | null
  initialData: ResumeParsedData
  /** 后置过滤命中的字段路径，用于高亮提示 */
  lowConfidenceFields: string[]
}

const emptyData: ResumeParsedData = {
  name: '',
  years: 0,
  skills: [],
  projects: [],
  education: [],
  risks: [],
}

/**
 * 简历解析确认页表单。
 *
 * 无论解析成功还是失败都展示编辑器 —— 失败时用户可手动补全（AGENTS.md §2 第 4 步）。
 */
export function ResumeReviewForm(props: ResumeReviewProps) {
  const router = useRouter()
  const [data, setData] = useState<ResumeParsedData>(props.initialData ?? emptyData)
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(props.parseError)

  const flagged = (path: string) => props.lowConfidenceFields.includes(path)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/api/resumes/${props.resumeId}`, { parsedData: data })
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    setError(null)
    try {
      const result = await api.post<{
        resume: { parsedData: ResumeParsedData | null; parseError: string | null }
        parse: { status: string; error?: string }
      }>(`/api/resumes/${props.resumeId}/parse`)

      if (result.resume.parsedData) setData(result.resume.parsedData)
      setParseError(result.parse.status === 'success' ? null : (result.parse.error ?? '解析失败'))
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '重新解析失败')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={props.parseStatus === 'success' ? 'default' : 'secondary'}>
          {props.parseStatus === 'success' ? '解析成功' : '待确认'}
        </Badge>
        <span className="text-sm text-muted-foreground">{props.fileName}</span>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      <ParseErrorNotice message={parseError} onRetry={handleRetry} retrying={retrying} />

      {props.rawText ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">原文（只读）</CardTitle>
            <CardDescription>解析失败时请参考原文手动填写下方内容</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {props.rawText}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
          <CardDescription>AI 未提取到的字段留空即可，不会影响保存</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="姓名"
            value={data.name}
            onChange={(value) => setData({ ...data, name: value })}
            hint="简历未提及则留空，不得推断"
          />
          <TextField
            label="工作年限"
            type="number"
            value={data.years}
            onChange={(value) => setData({ ...data, years: Number(value) || 0 })}
            hint="无法判断时填 0"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">技能</CardTitle>
          <CardDescription>只能来自简历原文，请勿添加简历中没有的技能</CardDescription>
        </CardHeader>
        <CardContent>
          <ListEditor
            name="skills"
            items={data.skills}
            flagged={flagged('skills')}
            onChange={(skills) => setData({ ...data, skills })}
            placeholder="如 TypeScript"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">项目经历</CardTitle>
          <CardDescription>角色未写则留空；结果无量化数据则留空</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">（未提取到项目经历，可手动添加）</p>
          ) : null}

          {data.projects.map((project, index) => (
            <div key={index} className="space-y-3 rounded-md border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={`项目 ${index + 1} 名称`}
                  value={project.name}
                  onChange={(value) => {
                    const projects = [...data.projects]
                    projects[index] = { ...project, name: value }
                    setData({ ...data, projects })
                  }}
                />
                <TextField
                  label={`项目 ${index + 1} 角色`}
                  value={project.role}
                  onChange={(value) => {
                    const projects = [...data.projects]
                    projects[index] = { ...project, role: value }
                    setData({ ...data, projects })
                  }}
                  hint="简历未写则留空"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">做了什么</p>
                <ListEditor
                  name={`projects-${index}-actions`}
                  items={project.actions}
                  flagged={flagged('projects[].actions')}
                  onChange={(actions) => {
                    const projects = [...data.projects]
                    projects[index] = { ...project, actions }
                    setData({ ...data, projects })
                  }}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">结果与数据</p>
                <ListEditor
                  name={`projects-${index}-results`}
                  items={project.results}
                  flagged={flagged('projects[].results')}
                  onChange={(results) => {
                    const projects = [...data.projects]
                    projects[index] = { ...project, results }
                    setData({ ...data, projects })
                  }}
                />
              </div>

              <button
                type="button"
                className="text-sm text-destructive underline underline-offset-4"
                onClick={() =>
                  setData({ ...data, projects: data.projects.filter((_, i) => i !== index) })
                }
              >
                删除该项目
              </button>
            </div>
          ))}

          <button
            type="button"
            className="text-sm underline underline-offset-4"
            onClick={() =>
              setData({
                ...data,
                projects: [
                  ...data.projects,
                  { name: '', role: '', actions: [], results: [], evidence: [] },
                ],
              })
            }
          >
            添加项目
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">教育经历</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.education.length === 0 ? (
            <p className="text-sm text-muted-foreground">（未提取到教育经历）</p>
          ) : null}

          {data.education.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
              <TextField
                label="学校"
                value={item.school}
                onChange={(value) => {
                  const education = [...data.education]
                  education[index] = { ...item, school: value }
                  setData({ ...data, education })
                }}
              />
              <TextField
                label="学历"
                value={item.degree}
                onChange={(value) => {
                  const education = [...data.education]
                  education[index] = { ...item, degree: value }
                  setData({ ...data, education })
                }}
              />
              <TextField
                label="专业"
                value={item.major}
                onChange={(value) => {
                  const education = [...data.education]
                  education[index] = { ...item, major: value }
                  setData({ ...data, education })
                }}
              />
              <TextField
                label="时间"
                value={item.period}
                onChange={(value) => {
                  const education = [...data.education]
                  education[index] = { ...item, period: value }
                  setData({ ...data, education })
                }}
              />
            </div>
          ))}

          <button
            type="button"
            className="text-sm underline underline-offset-4"
            onClick={() =>
              setData({
                ...data,
                education: [...data.education, { school: '', degree: '', major: '', period: '' }],
              })
            }
          >
            添加教育经历
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">简历疑点</CardTitle>
          <CardDescription>
            仅记录客观可验证的问题（如时间重叠、缺少量化结果），不含任何主观评价
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListEditor
            name="risks"
            items={data.risks}
            flagged={flagged('risks')}
            onChange={(risks) => setData({ ...data, risks })}
          />
        </CardContent>
      </Card>

      <SaveBar saving={saving} savedAt={savedAt} onSave={handleSave} />
    </div>
  )
}
