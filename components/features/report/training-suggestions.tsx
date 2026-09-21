import { Badge } from '@/components/ui/badge'
import { SCORE_DIMENSION_LABELS, type ScoreDimension } from '@/lib/constants/questions'

/**
 * 下一步训练建议（docs/UI.md §5.4）。
 *
 * 免费用户至少能看到**基于低分维度自动生成的基础建议**，
 * 避免未解锁时报告页出现「什么都没有」的体验。
 */

export interface SuggestionItem {
  text: string
  /** 建议依据的维度（自动生成的建议带此字段） */
  dimension?: ScoreDimension
}

export function TrainingSuggestions({
  base,
  generated,
  locked,
}: {
  /** 来自模型的 next_steps */
  base: SuggestionItem[]
  /** 服务端按低分维度自动生成 */
  generated: SuggestionItem[]
  /** 完整建议是否需付费解锁 */
  locked: boolean
}) {
  const items = [...generated, ...base]

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无建议，请先完成逐题评分并生成报告。</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item, index) => (
            <li key={index} className="flex flex-wrap items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span className="flex-1">{item.text}</span>
              {item.dimension ? (
                <Badge variant="secondary">{SCORE_DIMENSION_LABELS[item.dimension]}</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {locked ? (
        <p className="text-xs text-muted-foreground">
          以上为按低分维度自动生成的基础建议；完整建议需解锁后查看。
        </p>
      ) : null}
    </div>
  )
}
