'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Alert } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/http/api-client'

/**
 * 简历上传（PDF / Word / 图片）。
 *
 * 上传后服务端立即解析；成功或失败都会跳转到确认页 ——
 * 失败时确认页会展示解析错误并允许用户手动填写（AGENTS.md §2 第 4 步）。
 */
export function ResumeUploadForm() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) {
      setError('请先选择文件')
      return
    }

    setError(null)
    setPending(true)

    const form = new FormData()
    form.append('file', file)

    try {
      const result = await api.upload<{ resume: { id: string } }>('/api/resumes/upload', form)
      router.push(`/resumes/${result.resume.id}/review`)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '上传失败，请稍后重试')
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      <div className="space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError(null)
          }}
        />
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          选择文件
        </Button>
        <p className="text-sm text-muted-foreground">
          {file ? `${file.name}（${Math.ceil(file.size / 1024)} KB）` : '支持 PDF、Word（.docx）、图片，单个不超过 20MB'}
        </p>
      </div>

      <Button type="submit" disabled={pending || !file}>
        {pending ? '上传并解析中…' : '上传并解析'}
      </Button>
    </form>
  )
}
