import * as React from 'react'

import { cn } from '@/lib/utils/index'

/**
 * 多行文本输入。
 *
 * 为什么需要它：此前各处直接写原生 `<textarea>` 并手工复制 Input 的样式类
 * （面试回答、JD/简历粘贴都如此），任何一处漏改就会出现视觉不一致；
 * 且原生元素缺少与 Input 一致的 disabled / aria-invalid 态。
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
      'placeholder:text-muted-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30',
      'resize-y',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
