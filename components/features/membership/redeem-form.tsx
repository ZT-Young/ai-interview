'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert, Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiClientError } from '@/lib/api-client'

/**
 * 兑换码兑换表单（V1 的支付替代方案，docs/UI.md §6）。
 *
 * 安全：表单**只提交兑换码**；金额与权益由服务端按商品目录决定，
 * 前端不参与定价，也不传递任何权益字段。
 */
export function RedeemForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await api.post<{
        product: { id: string; name: string }
        remainingUsages: number
      }>('/api/payments/redeem', { code })

      setSuccess(`兑换成功：${result.product.name}`)
      setCode('')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '兑换失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">兑换码</CardTitle>
        <CardDescription>
          输入兑换码即可解锁对应权益（支付渠道开放前，兑换码是主要的开通方式）
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error ? <Alert data-testid="redeem-error">{error}</Alert> : null}
          {success ? <Alert data-testid="redeem-success" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700">{success}</Alert> : null}

          <div className="space-y-2">
            <Label htmlFor="code">兑换码</Label>
            <Input
              id="code"
              data-testid="redeem-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="例如 ABCD-EFGH-JKLM-NPQR"
              autoComplete="off"
              spellCheck={false}
              required
              minLength={6}
            />
          </div>

          <Button type="submit" disabled={pending || code.trim().length < 6} data-testid="redeem-submit">
            {pending ? '兑换中…' : '立即兑换'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
