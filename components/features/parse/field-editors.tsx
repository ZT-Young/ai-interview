'use client'

import { Alert } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * 解析确认页的通用编辑控件。
 *
 * AGENTS.md §2 第 4 步要求「展示解析结果，允许用户修改」，
 * 因此这些控件是**必需**的产品能力，不是可选优化。
 */

interface ListEditorProps {
  /** 字段标识，用于无障碍与测试定位 */
  name: string
  items: string[]
  onChange: (next: string[]) => void
  /** 该项被后置过滤命中时高亮提示 */
  flagged?: boolean
  placeholder?: string
}

/** 字符串数组编辑器：每行一项，可增删 */
export function ListEditor({ name, items, onChange, flagged, placeholder }: ListEditorProps) {
  return (
    <div className="space-y-2">
      {flagged ? (
        <p className="text-xs text-amber-600">
          部分内容因不合规或原文无法对应已被过滤，请核对后自行补充。
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">（未提取到内容，可手动添加）</p>
      ) : null}

      {items.map((item, index) => (
        <div key={`${name}-${index}`} className="flex gap-2">
          <input
            aria-label={`${name}-${index}`}
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...items]
              next[index] = event.target.value
              onChange(next)
            }}
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            删除
          </Button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ''])}>
        添加一项
      </Button>
    </div>
  )
}

interface ParseErrorNoticeProps {
  /** 服务端给出的面向用户提示 */
  message: string | null
  onRetry: () => void
  retrying: boolean
}

/**
 * 解析失败提示。
 * 关键要求：失败时**必须**仍然允许用户手动填写（AGENTS.md §2 第 4 步）。
 */
export function ParseErrorNotice({ message, onRetry, retrying }: ParseErrorNoticeProps) {
  if (!message) return null

  return (
    <Alert className="space-y-2">
      <p className="font-medium">未能自动解析</p>
      <p>{message}</p>
      <p className="text-xs">你仍可手动填写下方内容并保存，不影响后续练习。</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? '重新解析中…' : '重新解析'}
      </Button>
    </Alert>
  )
}

/** 单字段文本输入 */
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
}: {
  label: string
  value: string | number
  onChange: (next: string) => void
  type?: 'text' | 'number'
  hint?: string
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <input
        aria-label={label}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** 保存按钮组 */
export function SaveBar({
  saving,
  savedAt,
  onSave,
}: {
  saving: boolean
  savedAt: string | null
  onSave: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={onSave} disabled={saving}>
        {saving ? '保存中…' : '保存修改'}
      </Button>
      {savedAt ? <span className="text-sm text-muted-foreground">{savedAt} 已保存</span> : null}
    </div>
  )
}
