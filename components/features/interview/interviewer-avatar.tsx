import { cn } from '@/lib/utils/index'

/**
 * AI 面试官头像。
 *
 * 纯 CSS/文字实现，不依赖图片资源（避免额外静态资源与网络请求）。
 * 装饰性元素，对屏幕阅读器隐藏 —— 角色信息由气泡内文本前缀表达。
 */
export function InterviewerAvatar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary',
        className,
      )}
    >
      AI
    </div>
  )
}
