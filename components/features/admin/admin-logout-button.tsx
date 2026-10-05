'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/http/api-client'

/**
 * 退出**管理端**会话。
 *
 * 刻意不复用用户端的 LogoutButton：那一端退出后跳 `/login`，
 * 后台退出后应该回 `/admin/login`，且只吊销管理端那一条会话 ——
 * 管理员退出后台时，前台的用户端登录态不应受影响。
 */
export function AdminLogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleLogout() {
    setPending(true)
    try {
      await api.post('/api/auth/admin/logout')
    } finally {
      router.push('/admin/login')
      router.refresh()
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={pending}
      className="ml-auto"
      data-testid="admin-logout"
    >
      {pending ? '退出中…' : '退出后台'}
    </Button>
  )
}
