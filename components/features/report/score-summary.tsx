import { Badge } from '@/components/ui/badge'

/**
 * 总分与岗位匹配度（docs/UI.md §5.2）。
 *
 * 两者语义不同，**不得合并成一个数字**：
 * - 总分：基于实际回答表现
 * - 岗位匹配度：简历与 JD 的静态比对结果（面试前产出）
 */
export function ScoreSummary({
  totalScore,
  matchScore,
}: {
  totalScore: number
  matchScore: number | null
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">面试总分</p>
        <p className="mt-1 flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums" data-testid="total-score">
            {totalScore}
          </span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">基于你的实际回答表现，可逐题回溯</p>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">岗位匹配度</p>
          <Badge variant="outline">仅供参考</Badge>
        </div>
        <p className="mt-1 flex items-baseline gap-1">
          {matchScore === null ? (
            <span className="text-sm text-muted-foreground">暂无</span>
          ) : (
            <>
              <span className="text-3xl font-bold tabular-nums" data-testid="match-score">
                {matchScore}
              </span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          简历与岗位要求的静态匹配程度，不代表任何录用判断
        </p>
      </div>
    </div>
  )
}
