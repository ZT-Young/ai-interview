import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils/index'

/**
 * 空状态。
 *
 * 为什么统一成组件：此前 `/orders`、`/sessions` 各写一遍卡片空态，
 * 而 `/resumes`、`/jd` 完全没有空态——空列表就是一片白，用户不知道
 * 「是没有数据」还是「加载失败」。统一组件后每个列表页都有
 * 图标 + 说明 + 下一步动作。
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/50 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary-muted text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
