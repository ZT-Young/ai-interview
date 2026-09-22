import { SCORE_DIMENSION_LABELS, SCORE_DIMENSION_VALUES, type ScoreDimension } from '@/lib/constants/questions'

/**
 * 六维雷达图（自绘 SVG，docs/design/UI.md §5.3）。
 *
 * 为什么不用图表库：六维固定 0–5、数据规整，自绘 SVG 约百行即可，
 * 无客户端 JS 成本、可服务端渲染、无新依赖。
 *
 * 无障碍：图形本身 `role="img"` + `aria-label`，并**始终渲染数值列表**，
 * 颜色不是唯一的信息载体。
 */

const SIZE = 240
const CENTER = SIZE / 2
const RADIUS = 92
const MAX_SCORE = 5

/** 六个顶点：从正上方开始，顺时针 60° 间隔 */
function pointAt(index: number, ratio: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / SCORE_DIMENSION_VALUES.length - Math.PI / 2
  return {
    x: CENTER + RADIUS * ratio * Math.cos(angle),
    y: CENTER + RADIUS * ratio * Math.sin(angle),
  }
}

function polygonPoints(ratio: number): string {
  return SCORE_DIMENSION_VALUES.map((_, index) => {
    const point = pointAt(index, ratio)
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
  }).join(' ')
}

export interface DimensionRadarProps {
  scores: Partial<Record<ScoreDimension, number>>
}

export function DimensionRadar({ scores }: DimensionRadarProps) {
  const normalized = SCORE_DIMENSION_VALUES.map((dimension) => {
    const raw = Number(scores[dimension] ?? 0)
    const clamped = Number.isFinite(raw) ? Math.min(MAX_SCORE, Math.max(0, raw)) : 0
    return { dimension, score: clamped, ratio: clamped / MAX_SCORE }
  })

  const dataPoints = normalized
    .map((item, index) => {
      const point = pointAt(index, item.ratio)
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
    })
    .join(' ')

  const allZero = normalized.every((item) => item.score === 0)
  const label = normalized
    .map((item) => `${SCORE_DIMENSION_LABELS[item.dimension]} ${item.score} 分`)
    .join('，')

  return (
    <div className="space-y-3">
      <div className="mx-auto w-full max-w-sm">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full"
          role="img"
          aria-label={`六维得分雷达图：${label}`}
        >
          {/* 网格环：1 / 3 / 5 分 */}
          {[0.2, 0.6, 1].map((ratio) => (
            <polygon
              key={ratio}
              points={polygonPoints(ratio)}
              fill="none"
              className="stroke-border"
              strokeWidth={1}
            />
          ))}

          {/* 轴线 */}
          {SCORE_DIMENSION_VALUES.map((_, index) => {
            const outer = pointAt(index, 1)
            return (
              <line
                key={index}
                x1={CENTER}
                y1={CENTER}
                x2={outer.x}
                y2={outer.y}
                className="stroke-border"
                strokeWidth={1}
              />
            )
          })}

          {/* 数据多边形 */}
          <polygon
            points={dataPoints}
            className="fill-primary/20 stroke-primary"
            strokeWidth={2}
          />

          {/* 顶点 */}
          {normalized.map((item, index) => {
            const point = pointAt(index, item.ratio)
            return <circle key={item.dimension} cx={point.x} cy={point.y} r={3} className="fill-primary" />
          })}
        </svg>
      </div>

      {allZero ? (
        <p className="text-center text-sm text-muted-foreground">尚无评分数据</p>
      ) : null}

      {/* 数值列表：无障碍与低分定位都依赖它 */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {normalized.map((item) => (
          <li key={item.dimension} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{SCORE_DIMENSION_LABELS[item.dimension]}</span>
            <span className="tabular-nums font-medium">{item.score}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
