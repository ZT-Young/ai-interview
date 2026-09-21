/**
 * @vitest-environment jsdom
 *
 * 报告页逐题反馈的「参考答案」渲染测试。
 *
 * 为什么值得单独测：参考答案由模型生成，其中**无法确定的具体信息会被写成
 * 【待补充：…】占位符**。前端必须把这些占位符**高亮**出来并给出提示，
 * 否则用户会连占位符一起背诵、或在面试中报出不属于自己的数字。
 * 这是「合规 + 可用性」的关键一环，且不依赖真实模型，适合用组件测试锁住。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReportView, type EvaluationItemView, type ReportDataView } from '@/components/features/report/report-view'

const report: ReportDataView = {
  id: 'r1',
  sessionId: 's1',
  totalScore: 72,
  dimensionScores: {
    job_match: 4,
    professional: 4,
    project_depth: 3,
    logic: 4,
    communication: 4,
    motivation: 3,
  },
  highlights: ['量化结果清晰'],
  issues: [],
  referenceAnswers: [],
  nextSteps: ['补充 1 个可量化结果'],
  resumeRisks: [],
  summary: '整体中等偏上。',
  isUnlocked: true,
}

function evaluation(overrides: Partial<EvaluationItemView> = {}): EvaluationItemView {
  return {
    id: 'e1',
    questionContent: '请说明评分服务里缓存 key 是怎么设计的？',
    answerContent: '我加了缓存把 P95 降到 220ms。',
    questionScore: 43.3,
    dimensionScores: { professional: 2, project_depth: 2 },
    feedback: '缺少 key 设计的说明。',
    evidenceQuotes: [{ quote: '我加了缓存', reason: '仅复述结论' }],
    referenceAnswer:
      '缓存 key 我用【待补充：例如 题目 ID + 模型版本】拼的，TTL 设为【待补充】。',
    ...overrides,
  }
}

function renderReport(evaluations: EvaluationItemView[]) {
  return render(
    <ReportView
      sessionId="s1"
      report={report}
      evaluations={evaluations}
      isUnlocked
      lockedSections={[]}
      matchScore={70}
      baseSuggestions={[]}
    />,
  )
}

describe('报告页：逐题参考答案', () => {
  it('展开逐题反馈后能看到参考答案区块', () => {
    const { container } = renderReport([evaluation()])

    const block = container.querySelector('[data-testid="reference-answer"]')
    expect(block).not.toBeNull()
    expect(block!.textContent).toContain('参考答案')
    expect(block!.textContent).toContain('题目 ID + 模型版本')
  })

  it('【待补充】占位符被高亮为 mark 元素，避免用户连占位符一起背', () => {
    const { container } = renderReport([evaluation()])

    const marks = container.querySelectorAll('[data-testid="reference-answer"] mark')
    expect(marks.length).toBe(2)
    expect(marks[0]!.textContent).toContain('【待补充')
    expect(marks[1]!.textContent).toContain('【待补充')
  })

  it('给出「必须替换为真实数据」的提示', () => {
    renderReport([evaluation()])
    expect(screen.getByText(/换成你的真实数据/)).toBeTruthy()
  })

  it('没有参考答案时不渲染该区块（历史数据兼容）', () => {
    const { container } = renderReport([evaluation({ referenceAnswer: null })])
    expect(container.querySelector('[data-testid="reference-answer"]')).toBeNull()
  })

  it('参考答案排在评分依据之后（先诊断再示范）', () => {
    const { container } = renderReport([evaluation()])
    const text = container.textContent ?? ''
    const evidenceIndex = text.indexOf('评分依据')
    const referenceIndex = text.indexOf('参考答案')

    expect(evidenceIndex).toBeGreaterThan(-1)
    expect(referenceIndex).toBeGreaterThan(evidenceIndex)
  })
})
