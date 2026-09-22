'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'

export interface SelectOption {
  id: string
  label: string
  disabled?: boolean
}

interface TryParseResult {
  /** 解析是否成功 */
  ok: boolean
  /** 解析失败时的用户可读原因 */
  error?: string
  /** 后端已成功落库的记录 id（解析失败也会有） */
  id?: string
}

type SourceMode = 'existing' | 'upload' | 'text'

/**
 * 创建面试会话 —— 简历与 JD 都支持「选择已有 / 上传文件 / 粘贴文本」。
 *
 * 为什么要把三种输入放在同一个页面：
 * 早期版本只提供下拉选择，用户必须先跑到 `/resumes/new`、`/jd/new`
 * 各走一遍上传流程再回来，才能建会话。而「新建面试」正是用户
 * 心里想开始的地方，把准备资料的动作留在这里最省事。
 *
 * 关键设计：**上传/粘贴后立即在本页完成解析与落库**，成功后自动选中该条记录。
 * 因此本组件在提交前就可能已经创建了资源（这是有意的，不是副作用失控）：
 * 解析这一步本身就需要网络往返，放到提交时做会让「创建面试」变成
 * 一个长事务，失败后用户还要重新选文件。
 *
 * 解析失败**不阻断流程**：记录与原文都已保存，用户可以手动填写要点后继续
 * （AGENTS.md §2 第 4 步：解析结果可编辑）。仅当存储/解析服务真正不可用时
 * 才提示错误并保留输入。
 */
export function CreateSessionForm({
  resumes,
  jobJds,
}: {
  resumes: SelectOption[]
  jobJds: SelectOption[]
}) {
  const router = useRouter()

  const [resumeId, setResumeId] = useState(resumes.find((item) => !item.disabled)?.id ?? '')
  const [jobJdId, setJobJdId] = useState(jobJds.find((item) => !item.disabled)?.id ?? '')

  const [resumeMode, setResumeMode] = useState<SourceMode>(
    resumes.length > 0 ? 'existing' : 'upload',
  )
  const [jdMode, setJdMode] = useState<SourceMode>(jobJds.length > 0 ? 'existing' : 'text')

  const [resumeText, setResumeText] = useState('')
  const [jdText, setJdText] = useState('')

  const [busy, setBusy] = useState<'resume' | 'jd' | 'submit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const resumeFileRef = useRef<HTMLInputElement>(null)
  const jdFileRef = useRef<HTMLInputElement>(null)

  /** 上传得到的资源 id，仅用于提示「已保存但未解析成功」 */
  const [createdResumeId, setCreatedResumeId] = useState<string | null>(null)
  const [createdJdId, setCreatedJdId] = useState<string | null>(null)

  async function uploadFile(kind: 'resume' | 'jd', file: File): Promise<TryParseResult> {
    const endpoint = kind === 'resume' ? '/api/resumes/upload' : '/api/job-jds/upload'
    const form = new FormData()
    form.append('file', file)

    const payload = await api.upload<{
      resume?: { id: string; parseStatus: string }
      jobJd?: { id: string; parseStatus: string }
      parse?: { status: string; error?: string | null }
    }>(endpoint, form)

    const record = payload.resume ?? payload.jobJd
    return {
      ok: payload.parse?.status === 'success',
      error: payload.parse?.error ?? undefined,
      id: record?.id,
    }
  }

  async function handleResumeUpload() {
    const file = resumeFileRef.current?.files?.[0]
    if (!file) {
      setError('请先选择简历文件（PDF / Word / 图片）')
      return
    }

    setBusy('resume')
    setError(null)
    setNotice(null)
    try {
      const result = await uploadFile('resume', file)
      if (result.id) {
        setResumeId(result.id)
        setCreatedResumeId(result.id)
      }
      setNotice(
        result.ok
          ? '简历已解析成功，可直接用于生成面试计划。'
          : `简历已保存，但自动解析未成功（${result.error ?? '原因未知'}）。你仍可继续，之后可在简历页手动补充要点。`,
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '上传失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  async function handleResumeText() {
    if (resumeText.trim().length < 10) {
      setError('简历内容过短，请至少粘贴 10 个字符')
      return
    }

    setBusy('resume')
    setError(null)
    setNotice(null)
    try {
      const result = await api.post<{
        resume: { id: string }
        parse: { status: string; error?: string }
      }>('/api/resumes/from-text', { rawText: resumeText })

      setResumeId(result.resume.id)
      setCreatedResumeId(result.resume.id)
      setNotice(
        result.parse.status === 'success'
          ? '简历已解析成功，可直接用于生成面试计划。'
          : `简历文本已保存，但自动解析未成功（${result.parse.error ?? '原因未知'}）。你仍可继续，之后可在简历页手动补充要点。`,
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '保存简历文本失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  async function handleJdUpload() {
    const file = jdFileRef.current?.files?.[0]
    if (!file) {
      setError('请先选择 JD 文件（图片）')
      return
    }

    setBusy('jd')
    setError(null)
    setNotice(null)
    try {
      const result = await uploadFile('jd', file)
      if (result.id) {
        setJobJdId(result.id)
        setCreatedJdId(result.id)
      }
      setNotice(
        result.ok
          ? '岗位 JD 已解析成功，可直接用于生成面试计划。'
          : `岗位 JD 已保存，但自动解析未成功（${result.error ?? '原因未知'}）。你仍可继续，之后可在 JD 页手动补充要点。`,
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '上传失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  async function handleJdText() {
    if (jdText.trim().length < 10) {
      setError('JD 内容过短，请至少粘贴 10 个字符')
      return
    }

    setBusy('jd')
    setError(null)
    setNotice(null)
    try {
      const result = await api.post<{
        jobJd: { id: string }
        parse: { status: string; error?: string }
      }>('/api/job-jds/parse', { rawText: jdText })

      setJobJdId(result.jobJd.id)
      setCreatedJdId(result.jobJd.id)
      setNotice(
        result.parse.status === 'success'
          ? '岗位 JD 已解析成功，可直接用于生成面试计划。'
          : `岗位 JD 文本已保存，但自动解析未成功（${result.parse.error ?? '原因未知'}）。你仍可继续，之后可在 JD 页手动补充要点。`,
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '保存 JD 文本失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resumeId || !jobJdId) {
      setError('请准备一份简历与一个岗位 JD（可选择已有、上传文件或粘贴文本）')
      return
    }

    setError(null)
    setNotice(null)
    setBusy('submit')

    try {
      const result = await api.post<{ session: { id: string } }>('/api/sessions', {
        resumeId,
        jobJdId,
      })
      router.push(`/sessions/${result.session.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '创建失败，请稍后重试')
      setBusy(null)
    }
  }

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const tabClass = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
    }`

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert data-testid="create-session-notice">{notice}</Alert> : null}

      {/* ---------------- 简历 ---------------- */}
      <section className="space-y-3" data-testid="resume-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>简历</Label>
          <div className="flex gap-1" role="tablist" aria-label="简历来源">
            {(
              [
                ['existing', '选择已有'],
                ['upload', '上传文件'],
                ['text', '粘贴文本'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={resumeMode === mode}
                className={tabClass(resumeMode === mode)}
                onClick={() => setResumeMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {resumeMode === 'existing' ? (
          <>
            <select
              aria-label="选择简历"
              className={selectClass}
              value={resumeId}
              onChange={(event) => setResumeId(event.target.value)}
            >
              <option value="">请选择</option>
              {resumes.map((item) => (
                <option key={item.id} value={item.id} disabled={item.disabled}>
                  {item.label}
                </option>
              ))}
            </select>
            {resumes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                还没有简历，请切换到「上传文件」或「粘贴文本」。
              </p>
            ) : null}
          </>
        ) : null}

        {resumeMode === 'upload' ? (
          <div className="space-y-2">
            <input
              ref={resumeFileRef}
              type="file"
              aria-label="简历文件"
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
            <p className="text-xs text-muted-foreground">
              支持 PDF / Word / 图片，单文件不超过 20MB。上传后立即解析。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResumeUpload}
              disabled={busy !== null}
              data-testid="upload-resume"
            >
              {busy === 'resume' ? '上传解析中…' : '上传并解析'}
            </Button>
          </div>
        ) : null}

        {resumeMode === 'text' ? (
          <div className="space-y-2">
            <textarea
              aria-label="简历文本"
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="把简历内容粘贴到这里（技能、项目经历、学历等）"
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResumeText}
              disabled={busy !== null}
              data-testid="submit-resume-text"
            >
              {busy === 'resume' ? '保存解析中…' : '保存并解析'}
            </Button>
          </div>
        ) : null}

        {createdResumeId ? (
          <p className="text-xs text-emerald-600" data-testid="resume-ready">
            已就绪：该简历将用于生成面试计划
          </p>
        ) : null}
      </section>

      {/* ---------------- 岗位 JD ---------------- */}
      <section className="space-y-3" data-testid="jd-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>岗位 JD</Label>
          <div className="flex gap-1" role="tablist" aria-label="JD 来源">
            {(
              [
                ['existing', '选择已有'],
                ['text', '粘贴文本'],
                ['upload', '上传图片'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={jdMode === mode}
                className={tabClass(jdMode === mode)}
                onClick={() => setJdMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {jdMode === 'existing' ? (
          <>
            <select
              aria-label="选择岗位 JD"
              className={selectClass}
              value={jobJdId}
              onChange={(event) => setJobJdId(event.target.value)}
            >
              <option value="">请选择</option>
              {jobJds.map((item) => (
                <option key={item.id} value={item.id} disabled={item.disabled}>
                  {item.label}
                </option>
              ))}
            </select>
            {jobJds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                还没有岗位 JD，请切换到「粘贴文本」或「上传图片」。
              </p>
            ) : null}
          </>
        ) : null}

        {jdMode === 'text' ? (
          <div className="space-y-2">
            <textarea
              aria-label="JD 文本"
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="把岗位 JD 原文粘贴到这里（岗位职责、任职要求等）"
              value={jdText}
              onChange={(event) => setJdText(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleJdText}
              disabled={busy !== null}
              data-testid="submit-jd-text"
            >
              {busy === 'jd' ? '保存解析中…' : '保存并解析'}
            </Button>
          </div>
        ) : null}

        {jdMode === 'upload' ? (
          <div className="space-y-2">
            <input
              ref={jdFileRef}
              type="file"
              aria-label="JD 图片文件"
              accept=".png,.jpg,.jpeg,.webp"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
            <p className="text-xs text-muted-foreground">
              上传 JD 截图，由支持图片输入的模型识别（需已配置 LLM）。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleJdUpload}
              disabled={busy !== null}
              data-testid="upload-jd"
            >
              {busy === 'jd' ? '上传解析中…' : '上传并解析'}
            </Button>
          </div>
        ) : null}

        {createdJdId ? (
          <p className="text-xs text-emerald-600" data-testid="jd-ready">
            已就绪：该岗位 JD 将用于生成面试计划
          </p>
        ) : null}
      </section>

      <Button
        type="submit"
        disabled={busy !== null || !resumeId || !jobJdId}
        data-testid="create-session"
      >
        {busy === 'submit' ? '创建中…' : '创建并进入面试计划'}
      </Button>
    </form>
  )
}
