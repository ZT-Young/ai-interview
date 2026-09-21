'use client'

import { useEffect, useState } from 'react'

/**
 * 断线 / 重连提示横幅（docs/UI.md §4.5）。
 *
 * - 离线：常驻提示，提交按钮由父组件禁用
 * - 恢复在线：短暂显示「已恢复连接」后自动隐藏，并触发一次进度同步
 */
export function ConnectionBanner({ onReconnect }: { onReconnect?: () => void }) {
  const [online, setOnline] = useState(true)
  const [justRestored, setJustRestored] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return

    setOnline(navigator.onLine)

    function handleOnline() {
      setOnline(true)
      setJustRestored(true)
      onReconnect?.()
    }
    function handleOffline() {
      setOnline(false)
      setJustRestored(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [onReconnect])

  // 「已恢复连接」2 秒后自动隐藏
  useEffect(() => {
    if (!justRestored) return
    const timer = setTimeout(() => setJustRestored(false), 2000)
    return () => clearTimeout(timer)
  }, [justRestored])

  if (online && !justRestored) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        online
          ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700'
          : 'rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700'
      }
    >
      {online ? '已恢复连接，正在同步进度…' : '网络已断开，恢复后将自动同步；此期间的提交不会生效。'}
    </div>
  )
}

/** 供父组件订阅在线状态，用于禁用提交 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setOnline(navigator.onLine)

    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
