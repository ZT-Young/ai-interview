'use client'

import { RotateCcw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

/**
 * 已登录区域的错误边界。
 *
 * 为什么必须有：此前**没有任何 error.tsx**，任何渲染期异常都会落到
 * Next.js 默认错误页——英文文案 + 堆栈摘要，用户既看不懂也不知道该做什么；
 * 而且没有重试入口，只能手动刷新。
 *
 * 这里展示**面向用户**的说明，技术细节只写 digest（便于对照服务端日志），
 * 不把堆栈暴露给用户。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 记录到控制台供排查；服务端已有结构化日志，这里不重复上报
    console.error('[ui] 页面渲染异常', error)
  }, [error])

  return (
    <main className="container flex max-w-lg flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">页面出错了</h1>
        <p className="text-sm text-muted-foreground">
          这一步没有正常完成。你可以重试一次；若持续失败，请稍后再来或联系支持。
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            问题编号：<code className="rounded bg-muted px-1.5 py-0.5">{error.digest}</code>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          重试
        </Button>
        <Button asChild variant="outline">
          <Link href="/">回到首页</Link>
        </Button>
      </div>
    </main>
  )
}
