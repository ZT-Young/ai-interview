import { cn } from '@/lib/utils'

/**
 * 骨架屏占位。
 *
 * 用 `.shimmer`（globals.css 定义的微光动画）而不是单纯的 `animate-pulse`：
 * 后者在浅色背景上几乎看不出变化，用户难以区分「正在加载」与「加载失败留白」。
 *
 * 同时尊重 `prefers-reduced-motion`（见 globals.css），
 * 因此动画敏感用户看到的是静态灰块，不会不适。
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('shimmer rounded-md', className)}
      {...props}
    />
  )
}

/** 一段文字的骨架（宽度可按需给出，模拟真实文本行长） */
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  )
}

/** 卡片骨架：标题 + 若干正文行，用于列表页首屏 */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-card', className)} aria-hidden="true">
      <Skeleton className="h-5 w-40" />
      <SkeletonText lines={2} className="mt-3" />
    </div>
  )
}

export { Skeleton, SkeletonCard, SkeletonText }
