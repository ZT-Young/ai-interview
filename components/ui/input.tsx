import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none', className)}
      {...props}
    />
  ),
)
Label.displayName = 'Label'

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: 'error' | 'warning' | 'success' | 'info' }
>(({ className, variant = 'error', ...props }, ref) => {
  /**
   * 语义变体。
   *
   * 此前 Alert 固定为红色（destructive），于是「解析服务暂不可用」
   * 这类**非用户错误**的提示也显示成报错红色，容易被误解为
   * 「我做错了什么」。现在按性质区分：warning 用于环境/服务问题，
   * success 用于完成反馈。
   */
  const variants = {
    error: 'border-destructive/50 bg-destructive/10 text-destructive',
    warning: 'border-warning/50 bg-warning/10 text-warning',
    success: 'border-success/50 bg-success/10 text-success',
    info: 'border-info/50 bg-info/10 text-info',
  } as const

  return (
    <div
      ref={ref}
      role="alert"
      className={cn('rounded-md border px-3 py-2 text-sm', variants[variant], className)}
      {...props}
    />
  )
})
Alert.displayName = 'Alert'

export { Input, Label, Alert }
