'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api-client'

/** 退出登录：服务端置 revoked_at 使会话立即失效。 */
export function LogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleLogout() {
    setPending(true)
    try {
      await api.post('/api/auth/logout')
    } finally {
      router.push('/login')
      router.refresh()
      setPending(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleLogout} disabled={pending}>
      {pending ? '退出中…' : '退出登录'}
    </Button>
  )
}
