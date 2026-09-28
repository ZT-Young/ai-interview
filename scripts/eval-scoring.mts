/**
 * 评分器评测（eval）—— 回答一个此前没人能回答的问题：**它评得到底准不准**。
 *
 * 用法：
 *   pnpm eval:scoring                    # 默认每组跑 2 次（约 14 次模型调用）
 *   pnpm eval:scoring --runs 3           # 提高重复次数，一致性结论更稳
 *   pnpm eval:scoring --only q1-project-depth
 *
 * 测什么（全部可自动判定，不需要人工打分）：
 * 1. **一致性** —— 同一份答案重复评分，分数抖动有多大（标准差 / 极差）
 * 2. **区分度** —— 好答案 / 中等 / 敷衍 三档是否被拉开且顺序正确。
 *    这是评分器**是否有效**的核心判据：分不开三档，分数就是噪声。
 * 3. **证据合规** —— evidence_quotes 通过原文子串校验的比例（N6）
 * 4. **硬约束** —— 未作答是否六维全 0；低分是否给了可执行建议（N6/N7）
 * 5. **代价** —— 重试率、时延、输出 token
 *
 * 刻意**不做**的事：
 * - 不断言「这道题必须给 4 分」。绝对分数随模型与 prompt 漂移，
 *   断言绝对值只会得到一堆反复失效的测试；相对顺序才是稳定判据。
 * - 不写数据库、不写 `ai_call_logs`，避免评测流量污染线上质量看板的口径。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { chatCompletion } from '@/lib/ai/client'
import { buildEvaluationPrompt } from '@/lib/ai/prompts/evaluation'
import {
  evaluationParseSchema,
  hasLowDimension,
  verifyEvidenceQuotes,
  type DimensionScores,
} from '@/lib/ai/schemas/evaluation'
import { questionScoreOf } from '@/lib/ai/scoring'
import { parseWithRetry } from '@/lib/parsing/run'
import type { LlmPort, LlmRequest, LlmResponse } from '@/lib/parsing/llm-port'

/* ------------------------------ 类型 ------------------------------ */

interface EvalAnswer {
  tier: 'good' | 'median' | 'poor' | 'empty'
  text: string
}

interface EvalCase {
  id: string
  questionType: string
  question: string
  expectedPoints: string[]
  answers: EvalAnswer[]
}

interface EvalSet {
  version: string
  jdJson: unknown
  resumeJson: unknown
  cases: EvalCase[]
}

interface RunRecord {
  caseId: string
  tier: string
  run: number
  ok: boolean
  score: number | null
  dimensionScores: DimensionScores | null
  attempts: number
  quotesTotal: number
  quotesKept: number
  durationMs: number
  completionTokens: number | null
  model: string | null
  /** 违反的硬约束（N6 证据、未作答、低分无建议） */
  violations: string[]
  error?: string
}

/* --------------------------- 评测专用 LLM 端口 --------------------------- */

/**
 * 与生产链路的唯一差别是**不写 ai_call_logs**，其余（真实模型、真实 schema、
 * 真实重试逻辑）完全一致 —— 走 `parseWithRetry` 而不是另写一套调用，
 * 保证测的就是线上那条链路。
 */
class EvalLlm implements LlmPort {
  lastDurationMs = 0
  lastCompletionTokens: number | null = null

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const startedAt = Date.now()
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      json: true,
    })

    this.lastDurationMs = Date.now() - startedAt
    this.lastCompletionTokens = result.usage?.completionTokens ?? null

    return { content: result.content, model: result.model, finishReason: result.finishReason }
  }
}

/* ------------------------------ 统计工具 ------------------------------ */

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  return Math.round(Math.sqrt(variance) * 10) / 10
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

/* ------------------------------ 主流程 ------------------------------ */

async function main(): Promise<void> {
  const runs = Number(argValue('--runs') ?? 2) || 2
  const only = argValue('--only')
  const casePath = resolve(process.cwd(), 'evals/cases/scoring-v1.json')

  const evalSet = JSON.parse(readFileSync(casePath, 'utf8')) as EvalSet
  const jdJson = JSON.stringify(evalSet.jdJson)
  const resumeJson = JSON.stringify(evalSet.resumeJson)

  const cases = only ? evalSet.cases.filter((item) => item.id === only) : evalSet.cases
  if (cases.length === 0) {
    console.error(`[eval] 没有匹配的用例：${only}`)
    process.exitCode = 1
    return
  }

  const llm = new EvalLlm()
  const records: RunRecord[] = []
  const startedAt = Date.now()

  console.log(
    `\n评分器评测 · 用例集 v${evalSet.version} · 每档重复 ${runs} 次 · 共 ${
      cases.reduce((acc, item) => acc + item.answers.length, 0) * runs
    } 次模型调用\n`,
  )

  for (const item of cases) {
    for (const answer of item.answers) {
      const scores: number[] = []

      for (let run = 1; run <= runs; run += 1) {
        const prompt = buildEvaluationPrompt({
          jdJson,
          resumeJson,
          question: item.question,
          questionType: item.questionType,
          expectedPoints: item.expectedPoints,
          answer: answer.text,
        })

        const outcome = await parseWithRetry({
          llm,
          system: prompt.system,
          user: prompt.user,
          schema: evaluationParseSchema,
          operation: 'evaluate',
        })

        const record: RunRecord = {
          caseId: item.id,
          tier: answer.tier,
          run,
          ok: outcome.ok,
          score: null,
          dimensionScores: null,
          attempts: outcome.attempts,
          quotesTotal: 0,
          quotesKept: 0,
          durationMs: llm.lastDurationMs,
          completionTokens: llm.lastCompletionTokens,
          model: null,
          violations: [],
        }

        if (!outcome.ok) {
          record.error = outcome.violation ?? outcome.code
          records.push(record)
          continue
        }

        const data = outcome.data.data
        const verified = verifyEvidenceQuotes(data.evidence_quotes, answer.text)
        const score = questionScoreOf(data.dimension_scores)

        record.ok = true
        record.score = score
        record.dimensionScores = data.dimension_scores
        record.quotesTotal = data.evidence_quotes.length
        record.quotesKept = verified.quotes.length
        record.model = outcome.model

        // N6：一条证据都没通过原文校验 → 评分缺乏依据
        if (record.quotesTotal > 0 && verified.quotes.length === 0) {
          record.violations.push('evidence_all_dropped')
        }
        // 未作答必须六维全 0
        if (answer.tier === 'empty') {
          const allZero = Object.values(data.dimension_scores).every((value) => value === 0)
          if (!allZero) record.violations.push('empty_answer_not_zero')
        }
        // 低分必须给出可执行建议
        if (hasLowDimension(data.dimension_scores) && data.feedback.trim().length < 10) {
          record.violations.push('low_score_without_advice')
        }

        scores.push(score)
        records.push(record)
      }

      const okScores = scores
      if (okScores.length > 0) {
        console.log(
          `  ${item.id} [${answer.tier}] 分数 ${okScores.join(' / ')} · 标准差 ${stddev(okScores)} · 极差 ${
            Math.max(...okScores) - Math.min(...okScores)
          }`,
        )
      } else {
        console.log(`  ${item.id} [${answer.tier}] 全部失败`)
      }
    }
  }

  /* ------------------------------ 汇总 ------------------------------ */

  const successful = records.filter((record) => record.ok && record.score !== null)
  const totalQuotes = records.reduce((acc, record) => acc + record.quotesTotal, 0)
  const keptQuotes = records.reduce((acc, record) => acc + record.quotesKept, 0)
  const retried = records.filter((record) => record.attempts > 1).length
  const violations = records.flatMap((record) => record.violations)

  const byCaseTier = new Map<string, number[]>()
  for (const record of successful) {
    const key = `${record.caseId}::${record.tier}`
    const list = byCaseTier.get(key) ?? []
    list.push(record.score as number)
    byCaseTier.set(key, list)
  }

  const tierOrder = ['good', 'median', 'poor']
  const discrimination: Array<{
    caseId: string
    good: number | null
    median: number | null
    poor: number | null
    monotonic: boolean
    gap: number | null
  }> = []

  for (const item of cases) {
    const values = tierOrder.map((tier) => {
      const list = byCaseTier.get(`${item.id}::${tier}`)
      return list && list.length > 0 ? mean(list) : null
    })
    const [good, medianValue, poor] = values
    const ordered =
      good !== null && medianValue !== null && poor !== null
        ? good > medianValue && medianValue > poor
        : good !== null && medianValue !== null
          ? good > medianValue
          : false
    discrimination.push({
      caseId: item.id,
      good,
      median: medianValue,
      poor,
      monotonic: ordered,
      gap: good !== null && poor !== null ? Math.round((good - poor) * 10) / 10 : null,
    })
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    evalSetVersion: evalSet.version,
    runs,
    model: process.env.LLM_MODEL ?? null,
    totalCalls: records.length,
    successRate:
      records.length > 0 ? Math.round((successful.length / records.length) * 1000) / 10 : 0,
    consistency: {
      maxStddev: Math.max(
        ...Array.from(byCaseTier.values()).map((list) => (list.length > 1 ? stddev(list) : 0)),
      ),
      meanStddev:
        Math.round(
          (Array.from(byCaseTier.values())
            .filter((list) => list.length > 1)
            .reduce((acc, list) => acc + stddev(list), 0) /
            Math.max(1, Array.from(byCaseTier.values()).filter((list) => list.length > 1).length)) *
            10,
        ) / 10,
    },
    discrimination,
    evidence: {
      totalQuotes,
      keptQuotes,
      passRate: totalQuotes > 0 ? Math.round((keptQuotes / totalQuotes) * 1000) / 10 : null,
    },
    cost: {
      retryRate: records.length > 0 ? Math.round((retried / records.length) * 1000) / 10 : 0,
      meanDurationMs: Math.round(mean(records.map((record) => record.durationMs))),
      p95DurationMs: (() => {
        const sorted = records.map((record) => record.durationMs).sort((a, b) => a - b)
        if (sorted.length === 0) return 0
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      })(),
    },
    violations,
    elapsedMs: Date.now() - startedAt,
  }

  console.log('\n' + '='.repeat(72))
  console.log(`成功率        ${summary.successRate}%  (${successful.length}/${records.length})`)
  console.log(
    `一致性        平均标准差 ${summary.consistency.meanStddev} 分 · 最大 ${summary.consistency.maxStddev} 分`,
  )
  console.log(
    `证据合规      ${keptQuotes}/${totalQuotes} 条引用通过原文校验${
      summary.evidence.passRate !== null ? ` · ${summary.evidence.passRate}%` : ''
    }`,
  )
  console.log(
    `重试 / 时延   重试率 ${summary.cost.retryRate}% · 平均 ${summary.cost.meanDurationMs}ms · P95 ${summary.cost.p95DurationMs}ms`,
  )
  console.log(
    `硬约束违规    ${violations.length === 0 ? '无' : violations.join(', ') || '无'}`,
  )
  console.log('\n区分度（好 / 中 / 敷衍 的平均分）')
  for (const row of discrimination) {
    console.log(
      `  ${row.caseId.padEnd(20)} ${String(row.good ?? '-').padStart(5)} / ${String(
        row.median ?? '-',
      ).padStart(5)} / ${String(row.poor ?? '-').padStart(5)}   ${
        row.monotonic ? '顺序正确' : '顺序不成立'
      }${row.gap !== null ? ` · 极差 ${row.gap}` : ''}`,
    )
  }
  console.log('')

  const reportDir = resolve(process.cwd(), 'evals/reports')
  mkdirSync(dirname(reportDir), { recursive: true })
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const jsonPath = resolve(reportDir, `${stamp}.json`)
  writeFileSync(jsonPath, JSON.stringify({ summary, records }, null, 2), 'utf8')

  const mdPath = resolve(reportDir, 'latest.md')
  writeFileSync(
    mdPath,
    [
      `# 评分器评测报告（${summary.generatedAt}）`,
      '',
      `- 用例集 v${summary.evalSetVersion} · 模型 \`${summary.model}\` · 每档重复 ${runs} 次`,
      `- 成功率 **${summary.successRate}%**（${successful.length}/${records.length}）`,
      `- 一致性：平均标准差 **${summary.consistency.meanStddev}** 分，最大 **${summary.consistency.maxStddev}** 分`,
      `- 证据合规：**${keptQuotes}/${totalQuotes}**（${summary.evidence.passRate ?? '-'}%）通过原文子串校验`,
      `- 重试率 ${summary.cost.retryRate}% · 平均 ${summary.cost.meanDurationMs}ms · P95 ${summary.cost.p95DurationMs}ms`,
      `- 硬约束违规：${violations.length === 0 ? '无' : violations.join(', ')}`,
      '',
      '## 区分度',
      '',
      '| 用例 | 好答案 | 中等 | 敷衍 | 顺序 | 极差 |',
      '|---|---|---|---|---|---|',
      ...discrimination.map(
        (row) =>
          `| ${row.caseId} | ${row.good ?? '-'} | ${row.median ?? '-'} | ${row.poor ?? '-'} | ${
            row.monotonic ? '正确' : '不成立'
          } | ${row.gap ?? '-'} |`,
      ),
      '',
      `原始记录：\`evals/reports/${stamp}.json\``,
      '',
    ].join('\n'),
    'utf8',
  )

  console.log(`已写出：${jsonPath}`)
  console.log(`已写出：${mdPath}\n`)
  process.exit(0)
}

main().catch((error) => {
  console.error('[eval] 执行失败', error)
  process.exit(1)
})
