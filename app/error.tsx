'use client'

import { RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * 根级错误边界。
 *
 * 比 `(app)/error.tsx` 更靠外：当**根布局自身**（如 providers、字体加载、
 * 全局状态）出错时，只有这里能兜住。此时不能依赖任何依赖根布局的样式组件，
 * 因此刻意使用最小、纯 Tailwind 的结构。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">应用暂时无法加载</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        页面初始化时出现异常。请重试一次；若仍失败，请稍后再访问。
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">问题编号：{error.digest}</p>
      ) : null}
      <Button onClick={reset} variant="outline">
        <RotateCcw className="size-4" aria-hidden="true" />
        重试
      </Button>
    </div>
  )
}
