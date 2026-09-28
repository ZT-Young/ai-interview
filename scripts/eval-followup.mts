/**
 * 追问决策评测 —— **旧链路（单次调用）vs Agent（检索后再决策）** 的同题对比。
 *
 * 用法：
 *   pnpm eval:agent                 # 两种策略都跑，输出对比
 *   pnpm eval:agent --runs 2        # 每组重复 2 次
 *   pnpm eval:agent --only agent    # 只跑 agent（省一半成本）
 *
 * 为什么必须有这个对比：
 * 「加了 agent」本身不是成绩 —— 谁都能把一次调用改成循环。
 * 面试官会问：它到底变好在哪？贵了多少？这份脚本给出可核对的答案。
 *
 * 判定方式：期望值是**决策方向**（追问 / 下一题 + 原因类别），不是措辞。
 * 措辞无法自动判定，方向可以；且方向才是影响面试体验的关键。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { chatCompletion } from '@/lib/ai/client'
import { runInterviewAgent, type AgentContext } from '@/lib/ai/agent/loop'
import { buildFollowUpPrompt } from '@/lib/ai/prompts/interview'
import { followUpParseSchema, normalizeFollowUp } from '@/lib/ai/schemas/interview'
import { parseWithRetry } from '@/lib/parsing/run'
import type { LlmPort, LlmRequest, LlmResponse } from '@/lib/parsing/llm-port'

interface FollowUpCase {
  id: string
  question: string
  answer: string
  expectedAction: 'follow_up' | 'next_question'
  expectedReasons: string[]
  /** 好的追问应当能锚定的简历实体（项目名 / 量化数字 / 工具名） */
  groundingKeywords?: string[]
  why: string
}

interface EvalSet {
  version: string
  jdJson: unknown
  resumeJson: unknown
  cases: FollowUpCase[]
}

interface CaseResult {
  caseId: string
  expectedAction: string
  action: string | null
  reason: string | null
  correct: boolean
  focusInAnswer: boolean
  singleQuestion: boolean
  /** 追问是否锚定到简历里真实存在的细节（null = 该用例不考察） */
  grounded: boolean | null
  /** 追问原文（落盘以便人工核查；关键词匹配会漏同义表达，不能只看布尔值） */
  followUpText: string
  toolCalls: number
  rounds: number
  durationMs: number
  failure?: string
}

class TimingLlm implements LlmPort {
  lastDurationMs = 0

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
    return { content: result.content, model: result.model, finishReason: result.finishReason }
  }
}

/** 追问是否只问了一个问题（N2：一次只问一个） */
function isSingleQuestion(text: string): boolean {
  const marks = (text.match(/[?？]/g) ?? []).length
  return marks <= 1
}

/**
 * 追问是否锚定到简历中的真实细节。
 *
 * 这是**工具检索有没有价值**的判据：泛泛的「再多说一点」谁都会说，
 * 能指出「你简历里那个 45% 是怎么算的」才需要先去查简历。
 *
 * ⚠️ 局限：关键词硬匹配会漏掉同义表达（如「四十五个百分点」），
 * 所以它只是**参考指标**，不能单独下结论 —— 追问原文会一并落盘供人工核查。
 */
function isGrounded(followUp: string, keywords: string[] | undefined): boolean | null {
  if (!keywords || keywords.length === 0) return null
  if (followUp.length === 0) return false
  return keywords.some((keyword) => followUp.includes(keyword))
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

async function runLegacy(
  llm: LlmPort,
  item: FollowUpCase,
  context: AgentContext,
): Promise<CaseResult> {
  const prompt = buildFollowUpPrompt({
    question: item.question,
    answer: item.answer,
    context: `岗位要求：${JSON.stringify(context.jd)}\n候选人要点：${JSON.stringify(context.resume)}`,
    depth: 0,
  })

  const outcome = await parseWithRetry({
    llm,
    operation: 'follow_up',
    system: prompt.system,
    user: prompt.user,
    schema: followUpParseSchema,
  })

  if (!outcome.ok) {
    return {
      caseId: item.id,
      expectedAction: item.expectedAction,
      action: null,
      reason: null,
      correct: false,
      focusInAnswer: false,
      singleQuestion: false,
      grounded: null,
      followUpText: '',
      toolCalls: 0,
      rounds: 1,
      durationMs: llm instanceof TimingLlm ? llm.lastDurationMs : 0,
      failure: outcome.violation ?? outcome.code,
    }
  }

  const normalized = normalizeFollowUp(outcome.data.data)
  return {
    caseId: item.id,
    expectedAction: item.expectedAction,
    action: normalized.action,
    reason: normalized.reason,
    correct:
      normalized.action === item.expectedAction && item.expectedReasons.includes(normalized.reason),
    focusInAnswer: normalized.focus.length === 0 || item.answer.includes(normalized.focus),
    singleQuestion: normalized.action !== 'follow_up' || isSingleQuestion(normalized.followUp),
    grounded: isGrounded(normalized.followUp, item.groundingKeywords),
    followUpText: normalized.followUp,
    toolCalls: 0,
    rounds: 1,
    durationMs: llm instanceof TimingLlm ? llm.lastDurationMs : 0,
  }
}

async function runAgent(
  llm: LlmPort,
  item: FollowUpCase,
  context: AgentContext,
): Promise<CaseResult> {
  const startedAt = Date.now()
  const result = await runInterviewAgent({ llm, context, depth: 0 })

  if (!result.ok) {
    return {
      caseId: item.id,
      expectedAction: item.expectedAction,
      action: null,
      reason: null,
      correct: false,
      focusInAnswer: false,
      singleQuestion: false,
      grounded: null,
      followUpText: '',
      toolCalls: result.toolTrace.length,
      rounds: result.rounds,
      durationMs: Date.now() - startedAt,
      failure: result.reason,
    }
  }

  const normalized = normalizeFollowUp({
    action: result.decision.action,
    follow_up: result.decision.followUp,
    reason: result.decision.reason,
    focus: result.decision.focus,
  })

  return {
    caseId: item.id,
    expectedAction: item.expectedAction,
    action: normalized.action,
    reason: normalized.reason,
    correct:
      normalized.action === item.expectedAction && item.expectedReasons.includes(normalized.reason),
    focusInAnswer: normalized.focus.length === 0 || item.answer.includes(normalized.focus),
    singleQuestion: normalized.action !== 'follow_up' || isSingleQuestion(normalized.followUp),
    grounded: isGrounded(normalized.followUp, item.groundingKeywords),
    followUpText: normalized.followUp,
    toolCalls: result.toolTrace.length,
    rounds: result.rounds,
    durationMs: Date.now() - startedAt,
  }
}

function summarize(results: CaseResult[]) {
  const ok = results.filter((item) => !item.failure)
  return {
    accuracy: results.length > 0 ? Math.round((results.filter((r) => r.correct).length / results.length) * 1000) / 10 : 0,
    failureRate: results.length > 0 ? Math.round((results.filter((r) => r.failure).length / results.length) * 1000) / 10 : 0,
    focusPassRate: ok.length > 0 ? Math.round((ok.filter((r) => r.focusInAnswer).length / ok.length) * 1000) / 10 : null,
    singleQuestionRate: ok.length > 0 ? Math.round((ok.filter((r) => r.singleQuestion).length / ok.length) * 1000) / 10 : null,
    avgToolCalls: ok.length > 0 ? Math.round((ok.reduce((acc, r) => acc + r.toolCalls, 0) / ok.length) * 10) / 10 : 0,
    avgRounds: ok.length > 0 ? Math.round((ok.reduce((acc, r) => acc + r.rounds, 0) / ok.length) * 10) / 10 : 0,
    groundedRate: (() => {
      const scored = ok.filter((r) => r.grounded !== null)
      if (scored.length === 0) return null
      return Math.round((scored.filter((r) => r.grounded === true).length / scored.length) * 1000) / 10
    })(),
    avgDurationMs: Math.round(results.reduce((acc, r) => acc + r.durationMs, 0) / Math.max(1, results.length)),
  }
}

async function main(): Promise<void> {
  const runs = Number(argValue('--runs') ?? 1) || 1
  const only = argValue('--only')
  const modes = only ? [only] : ['legacy', 'agent']

  const evalSet = JSON.parse(
    readFileSync(resolve(process.cwd(), 'evals/cases/followup-v1.json'), 'utf8'),
  ) as EvalSet

  const llm = new TimingLlm()
  const output: Record<string, CaseResult[]> = {}
  const summaries: Record<string, ReturnType<typeof summarize>> = {}

  console.log(`\n追问决策评测 · 用例集 v${evalSet.version} · 每组 ${runs} 次 · 策略 ${modes.join(' / ')}\n`)

  for (const mode of modes) {
    const results: CaseResult[] = []

    for (const item of evalSet.cases) {
      const context: AgentContext = {
        resume: evalSet.resumeJson,
        jd: evalSet.jdJson,
        mainQuestion: item.question,
        currentAnswer: item.answer,
        history: [{ question: item.question, answer: '', depth: 0 }],
        askedQuestions: ['请做个自我介绍', item.question],
      }

      for (let run = 1; run <= runs; run += 1) {
        const result = mode === 'agent' ? await runAgent(llm, item, context) : await runLegacy(llm, item, context)
        results.push(result)
      }
    }

    output[mode] = results
    summaries[mode] = summarize(results)

    console.log(`[${mode}]`)
    for (const result of results) {
      console.log(
        `  ${pad(result.caseId, 30)} 期望 ${pad(result.expectedAction, 14)} 实际 ${pad(
          result.action ?? `失败:${result.failure}`,
          22,
        )} ${result.correct ? '正确' : '不符'} · 工具 ${result.toolCalls} · ${result.durationMs}ms`,
      )
    }
    console.log('')
  }

  console.log('='.repeat(88))
  console.log(
    `${pad('策略', 10)}${padLeft('决策准确率', 12)}${padLeft('失败率', 10)}${padLeft('证据合规', 12)}${padLeft('单问合规', 12)}${padLeft('锚定率', 10)}${padLeft('平均工具', 12)}${padLeft('平均时延', 12)}`,
  )
  console.log('-'.repeat(88))
  for (const mode of modes) {
    const s = summaries[mode]
    console.log(
      `${pad(mode, 10)}${padLeft(`${s.accuracy}%`, 12)}${padLeft(`${s.failureRate}%`, 10)}${padLeft(
        `${s.focusPassRate ?? '-'}%`,
        12,
      )}${padLeft(`${s.singleQuestionRate ?? '-'}%`, 12)}${padLeft(`${s.groundedRate ?? '-'}%`, 10)}${padLeft(String(s.avgToolCalls), 12)}${padLeft(
        `${s.avgDurationMs}ms`,
        12,
      )}`,
    )
  }
  console.log('')

  const reportDir = resolve(process.cwd(), 'evals/reports')
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const jsonPath = resolve(reportDir, `followup-${stamp}.json`)
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), runs, modes, summaries, results: output }, null, 2), 'utf8')

  const mdPath = resolve(reportDir, 'followup-latest.md')
  writeFileSync(
    mdPath,
    [
      `# 追问决策评测（${new Date().toISOString()}）`,
      '',
      `用例集 v${evalSet.version} · 每组 ${runs} 次`,
      '',
      '| 策略 | 决策准确率 | 失败率 | 证据合规 | 单问合规 | 追问锚定率 | 平均工具调用 | 平均时延 |',
      '|---|---|---|---|---|---|---|---|',
      ...modes.map((mode) => {
        const s = summaries[mode]
        return `| ${mode} | ${s.accuracy}% | ${s.failureRate}% | ${s.focusPassRate ?? '-'}% | ${
          s.singleQuestionRate ?? '-'
        }% | ${s.groundedRate ?? '-'}% | ${s.avgToolCalls} | ${s.avgDurationMs}ms |`
      }),
      '',
      `原始记录：\`evals/reports/followup-${stamp}.json\``,
      '',
    ].join('\n'),
    'utf8',
  )

  console.log(`已写出：${jsonPath}`)
  console.log(`已写出：${mdPath}\n`)
  process.exit(0)
}

main().catch((error) => {
  console.error('[eval:agent] 执行失败', error)
  process.exit(1)
})
