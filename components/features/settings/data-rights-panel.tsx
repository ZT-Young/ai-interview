'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiClientError } from '@/lib/api-client'

/**
 * 账户设置中的数据权利操作（AGENTS.md §7 C3）。
 *
 * - **导出**：直接下载 JSON（服务端只导出当前登录用户的数据）
 * - **删除**：二次确认，需输入自己的邮箱才能提交（防误触）
 */
export function DataRightsPanel({ email }: { email: string }) {
  const router = useRouter()
  const [confirmText, setConfirmText] = useState('')
  const [pending, setPending] = useState<null | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)

  const canDelete = confirmText.trim().toLowerCase() === email.toLowerCase()

  async function downloadExport() {
    setError(null)
    try {
      // 用浏览器直接跳转触发下载（服务端已设 content-disposition）
      window.location.href = '/api/auth/me/data-export'
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '导出失败，请稍后重试')
    }
  }

  async function deleteAccount() {
    setPending('delete')
    setError(null)
    try {
      await api.delete('/api/auth/me')
      // 账号已删除，会话已失效 → 回登录页
      router.push('/login')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '删除失败，请稍后重试')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Alert data-testid="data-rights-error">{error}</Alert> : null}

      <Card data-testid="data-export">
        <CardHeader>
          <CardTitle className="text-base">导出我的数据</CardTitle>
          <CardDescription>
            下载包含账号资料、简历解析结果、面试记录、评分与报告的 JSON 文件
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={downloadExport} variant="outline" data-testid="export-button">
            下载数据副本（JSON）
          </Button>
          <p className="text-xs text-muted-foreground">
            导出内容不包含密码哈希与会话令牌；每次导出都会记入审计日志。
          </p>
        </CardContent>
      </Card>

      <Card data-testid="data-delete" className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">删除账号与数据</CardTitle>
          <CardDescription>
            删除后立即无法登录，简历原件会从对象存储中删除。此操作不可恢复。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="confirm-email">
              请输入你的邮箱以确认：<span className="font-mono">{email}</span>
            </Label>
            <Input
              id="confirm-email"
              data-testid="confirm-email-input"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={email}
              autoComplete="off"
            />
          </div>

          <Button
            variant="destructive"
            onClick={deleteAccount}
            disabled={!canDelete || pending === 'delete'}
            data-testid="delete-account-button"
          >
            {pending === 'delete' ? '删除中…' : '永久删除我的账号'}
          </Button>

          <p className="text-xs text-muted-foreground">
            如需保留练习记录，请先导出数据副本。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
