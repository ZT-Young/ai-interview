/**
 * @vitest-environment jsdom
 *
 * 组件测试需要 DOM，而本项目的 vitest 全局环境是 `node`
 * （服务层与数据库测试不需要 DOM，且 jsdom 会拖慢它们）。
 * 因此在此**按文件**切换环境，而不是改全局配置。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DimensionRadar } from '@/components/features/report/dimension-radar'

/**
 * 雷达图组件测试（docs/UI.md §5.3）。
 *
 * 该组件是自绘 SVG，含极坐标计算、数值钳制与空态，属**纯逻辑**，
 * 因此可在此完整验证 —— E2E 需要数据库，覆盖不到未登录状态下的图表正确性。
 */

/** 从 svg 文本里取出数据多边形的坐标串 */
function dataPolygonPoints(container: HTMLElement): string {
  const polygons = container.querySelectorAll('polygon')
  // 依次为 3 个网格环 + 1 个数据多边形，取最后一个
  return polygons[polygons.length - 1]!.getAttribute('points') ?? ''
}

function parsePoints(points: string): Array<{ x: number; y: number }> {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',')
      return { x: Number(x), y: Number(y) }
    })
}

describe('六维雷达图', () => {
  const full = {
    job_match: 5,
    professional: 5,
    project_depth: 5,
    logic: 5,
    communication: 5,
    motivation: 5,
  }

  it('渲染六个顶点与数值列表', () => {
    const { container } = render(<DimensionRadar scores={full} />)

    expect(parsePoints(dataPolygonPoints(container))).toHaveLength(6)

    for (const label of ['岗位匹配', '专业能力', '项目深度', '逻辑表达', '沟通表达', '动机稳定性']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('无障碍：图形有 role=img 且 aria-label 含各维得分', () => {
    render(<DimensionRadar scores={full} />)

    const svg = screen.getByRole('img')
    const label = svg.getAttribute('aria-label') ?? ''

    expect(label).toContain('岗位匹配 5 分')
    expect(label).toContain('动机稳定性 5 分')
  })

  it('全 5 分时数据多边形与最外层网格环重合（满值半径）', () => {
    const { container } = render(<DimensionRadar scores={full} />)
    const polygons = container.querySelectorAll('polygon')

    const outerRing = polygons[polygons.length - 2]!.getAttribute('points')
    const data = dataPolygonPoints(container)

    expect(data).toBe(outerRing)
  })

  it('全 0 分时数据多边形收缩到中心，并展示空态提示', () => {
    const { container } = render(
      <DimensionRadar
        scores={{
          job_match: 0,
          professional: 0,
          project_depth: 0,
          logic: 0,
          communication: 0,
          motivation: 0,
        }}
      />,
    )

    const points = parsePoints(dataPolygonPoints(container))
    // 中心为 (120, 120) —— 全部顶点应重合于圆心
    for (const point of points) {
      expect(Math.abs(point.x - 120)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(point.y - 120)).toBeLessThanOrEqual(0.1)
    }

    expect(screen.getByText('尚无评分数据')).toBeTruthy()
  })

  it('超出范围的值被钳制到 0-5（不越界、不崩溃）', () => {
    const { container } = render(
      <DimensionRadar scores={{ ...full, job_match: 99, professional: -5 }} />,
    )

    // 钳制后不应出现 >5 或 <0 的数值
    expect(screen.queryByText('99')).toBeNull()
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)

    // 图形仍为六个顶点
    expect(parsePoints(dataPolygonPoints(container))).toHaveLength(6)
  })

  it('缺失维度按 0 处理，且不产生 NaN 坐标', () => {
    const { container } = render(<DimensionRadar scores={{ job_match: 3 }} />)

    const points = parsePoints(dataPolygonPoints(container))
    expect(points).toHaveLength(6)
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }

    // 未提供分值的维度显示 0
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(5)
  })

  it('小数分值不导致非有限坐标', () => {
    const { container } = render(
      <DimensionRadar scores={{ ...full, logic: 4.3, communication: 2.7 }} />,
    )

    for (const point of parsePoints(dataPolygonPoints(container))) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  it('非数值输入（NaN）按 0 处理', () => {
    const { container } = render(
      <DimensionRadar scores={{ ...full, motivation: Number.NaN }} />,
    )

    const points = parsePoints(dataPolygonPoints(container))
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true)
    }
  })

  it('SVG 使用 viewBox 以保证移动端自适应（不写死宽高）', () => {
    render(<DimensionRadar scores={full} />)

    const svg = screen.getByRole('img')
    expect(svg.getAttribute('viewBox')).toBe('0 0 240 240')
    expect(svg.getAttribute('class') ?? '').toContain('w-full')
  })

  it('顶点圆点数量与维度数一致', () => {
    const { container } = render(<DimensionRadar scores={full} />)
    expect(container.querySelectorAll('circle')).toHaveLength(6)
  })

  it('有评分时不展示空态提示', () => {
    render(<DimensionRadar scores={full} />)
    expect(screen.queryByText('尚无评分数据')).toBeNull()
  })
})
