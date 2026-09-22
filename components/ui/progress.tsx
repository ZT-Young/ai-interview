'use client'

import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils/index'

/**
 * 进度条。
 *
 * 面试房间此前只有一行文字「进度 2 / 12」，用户在长对话里很难一眼看出还剩多少。
 * 进度条让「还剩几题」变成可视信息。
 */
const Progress = ({
  className,
  value,
  ...props
}: React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>) => (
  <ProgressPrimitive.Root
    className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
    value={value}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 rounded-full bg-primary transition-transform duration-300"
      style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
)

export { Progress }
