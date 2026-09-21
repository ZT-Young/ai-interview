import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { InterviewerAvatar } from './interviewer-avatar'

export type BubbleRole = 'ai' | 'user' | 'system'

export interface MessageBubbleProps {
  role: BubbleRole
  content: string
  /** follow_up / hint / skip 等类型，用于标签与样式 */
  type?: string
  /** 是否当前题目 —— 字号更大、行高更宽 */
  emphasize?: boolean
  followUpReason?: string | null
  children?: React.ReactNode
}

const ROLE_LABEL: Record<BubbleRole, string> = {
  ai: '面试官',
  user: '你',
  system: '系统',
}

const TYPE_LABEL: Record<string, string> = {
  follow_up: '追问',
  hint: '提示',
  skip: '跳过',
}

const REASON_LABEL: Record<string, string> = {
  vague: '回答较笼统，追问细节',
  too_short: '回答过短，追问细节',
  off_topic: '偏离岗位要求，已拉回',
  good_enough: '回答充分',
}

/**
 * 消息气泡。
 *
 * - AI 左对齐、用户右对齐、系统居中无气泡
 * - **角色以文本前缀表达**（面试官 / 你 / 系统），不仅靠左右对齐（无障碍要求，见 docs/UI.md §6）
 */
export function MessageBubble({
  role,
  content,
  type,
  emphasize,
  followUpReason,
  children,
}: MessageBubbleProps) {
  if (role === 'system') {
    return (
      <div className="flex justify-center">
        <p className="max-w-[90%] rounded-md bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
          {content}
        </p>
      </div>
    )
  }

  const isAi = role === 'ai'

  return (
    <div className={cn('flex gap-2', isAi ? 'justify-start' : 'justify-end')}>
      {isAi ? <InterviewerAvatar /> : null}

      <div className={cn('max-w-[85%] space-y-1', isAi ? 'items-start' : 'items-end')}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{ROLE_LABEL[role]}</span>
          {type && TYPE_LABEL[type] ? <Badge variant="outline">{TYPE_LABEL[type]}</Badge> : null}
        </div>

        <div
          className={cn(
            'whitespace-pre-wrap rounded-lg px-3 py-2',
            emphasize ? 'text-base leading-relaxed' : 'text-sm',
            isAi ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
          )}
        >
          {content}
        </div>

        {followUpReason && REASON_LABEL[followUpReason] ? (
          <p className="text-xs text-muted-foreground">{REASON_LABEL[followUpReason]}</p>
        ) : null}

        {children}
      </div>
    </div>
  )
}
