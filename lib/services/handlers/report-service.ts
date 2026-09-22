import { eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  evaluations,
  interviewSessions,
  jobJds,
  questions,
  reports,
  resumes,
} from '@/db/schema'
import { internalError, notFound, validationError } from '@/lib/api/errors'
import { ownedByActive } from '@/lib/api/ownership'
import { buildReportPrompt } from '@/lib/ai/prompts/evaluation'
import { reportParseSchema, type ReportData } from '@/lib/ai/schemas/evaluation'
import { SCHEMA_VERSION } from '@/lib/ai/schemas/parse'
import type { DimensionScores } from '@/lib/ai/schemas/evaluation'
import { computeSessionScores } from '@/lib/ai/scoring'
import { containsProhibited, containsSensitive } from '@/lib/parsing/verify'
import { isEnvironmentLevelParseFailure, parseError } from '@/lib/parsing/errors'
import type { LlmPort } from '@/lib/parsing/llm-port'
import { MAX_ATTEMPTS, parseWithRetry } from '@/lib/parsing/run'
import { SCORE_DIMENSION_VALUES, type ScoreDimension } from '@/lib/constants/questions'
import {
  getEntitlements,
  hasReportUnlock,
  type Entitlements,
} from './entitlement-service'
import { consumeFreeTrial } from './payment-service'

/**
 * 报告生成服务 —— docs/engineering/AI_PROMPTS.md §7。
 *
 * 分工（关键）：
 * - **分数由服务端计算**（lib/ai/scoring.ts），模型不算分
 * - 模型只负责文字：总评、优势、问题、参考回答、下一步建议、简历疑点归纳
 * - 落库：`reports`（一场面试一份，session_id 唯一）
 */

export interface ReportPorts {
  llm: LlmPort
}

export interface ReportView {
  id: string
  sessionId: string
  totalScore: number
  dimensionScores: Record<ScoreDimension, number>
  highlights: string[]
  issues: string[]
  referenceAnswers: ReportData['reference_answers']
  nextSteps: string[]
  resumeRisks: string[]
  summary: string | null
  isUnlocked: boolean
  createdAt: string
}

/** 自动生成的基础训练建议（免费可见，见 docs/design/UI.md §5.4） */
export interface BaseSuggestion {
  text: string
  dimension: ScoreDimension
}

/** 低分阈值：低于该值的维度会生成针对性建议 */
const LOW_DIMENSION_THRESHOLD = 3

/** 各维度的可执行改进方向 */
const DIMENSION_ADVICE: Record<ScoreDimension, string> = {
  job_match: '对照 JD 的硬性要求逐条准备：每条要求配一个你做过的具体例子。',
  professional: '针对 JD 关键词补齐基础知识：能把原理、适用场景与边界条件讲清楚。',
  project_depth: '按「背景 → 你负责的部分 → 技术取舍 → 量化结果」重写项目描述。',
  logic: '练习结构化表达：先给结论，再给 2–3 条依据，最后给结果。',
  communication: '控制单次回答在 90 秒内：去掉铺垫，直接讲做法与结果。',
  motivation: '准备一段「为什么选这个方向」的说明，包含过往投入与下一步计划。',
}

/**
 * 按低分维度生成基础训练建议。
 *
 * 输入为**整场面试的六维汇总分**；低于阈值的维度各生成一条建议，
 * 按分数升序（最弱的维度排最前）。
 */
export function buildBaseSuggestions(
  dimensions: Record<ScoreDimension, number>,
): BaseSuggestion[] {
  return SCORE_DIMENSION_VALUES.map((dimension) => ({
    dimension,
    score: Number(dimensions[dimension] ?? 0),
  }))
    .filter((item) => item.score < LOW_DIMENSION_THRESHOLD)
    .sort((a, b) => a.score - b.score)
    .map((item) => ({ dimension: item.dimension, text: DIMENSION_ADVICE[item.dimension] }))
}

export type GenerateReportResult =
  | {
      ok: true
      report: ReportView
      attempts: number
      dropped: string[]
      /** 免费额度消耗结果（会员不消耗） */
      credit: { consumed: boolean; remaining: number; reason?: string }
    }
  | { ok: false; code: 'ai_unavailable'; message: string; attempts: number }
  | { ok: false; code: 'report_failed'; message: string; attempts: number; violations: string[] }

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toView(row: typeof reports.$inferSelect): ReportView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    totalScore: Number(row.totalScore),
    dimensionScores: row.dimensionScores as Record<ScoreDimension, number>,
    highlights: toStringArray(row.highlights),
    issues: toStringArray(row.issues),
    referenceAnswers: (row.referenceAnswers ?? []) as ReportData['reference_answers'],
    nextSteps: toStringArray(row.nextSteps),
    resumeRisks: toStringArray(row.resumeRisks),
    summary: row.summary,
    isUnlocked: row.isUnlocked,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 后置校验（docs/engineering/AI_PROMPTS.md §7.5）：
 * - 剔除命中敏感词/录用建议的条目
 * - 剔除「不在本次面试题目中」的参考回答（防虚构题目）
 * - 剔除「不在简历解析结果中」的简历疑点（防新增疑点）
 */
export function verifyReportData(
  data: ReportData,
  context: { questionTexts: string[]; resumeRisks: string[] },
): { data: ReportData; dropped: string[] } {
  const dropped: string[] = []
  const normalize = (text: string) => text.trim()

  const cleanList = (items: string[], label: string): string[] =>
    items.filter((item) => {
      if (containsSensitive(item) || containsProhibited(item)) {
        dropped.push(`${label}：命中敏感或禁止项`)
        return false
      }
      return true
    })

  const questionSet = new Set(context.questionTexts.map(normalize))
  const riskSet = new Set(context.resumeRisks.map(normalize))

  const referenceAnswers = data.reference_answers.filter((item) => {
    if (!questionSet.has(normalize(item.question))) {
      dropped.push(`参考回答：题目不在本次面试中（${item.question.slice(0, 30)}）`)
      return false
    }
    if (containsSensitive(item.improvement) || containsProhibited(item.improvement)) {
      dropped.push('参考回答：改进要点命中敏感或禁止项')
      return false
    }
    return true
  })

  const resumeRisks = data.resume_risks.filter((risk) => {
    if (!riskSet.has(normalize(risk))) {
      dropped.push(`简历疑点：不在简历解析结果中（${risk.slice(0, 30)}）`)
      return false
    }
    return true
  })

  return {
    data: {
      summary: containsSensitive(data.summary) || containsProhibited(data.summary) ? '' : data.summary,
      highlights: cleanList(data.highlights, '优势'),
      issues: cleanList(data.issues, '问题'),
      reference_answers: referenceAnswers,
      next_actions: cleanList(data.next_actions, '下一步建议'),
      resume_risks: resumeRisks,
    },
    dropped,
  }
}

/** 报告是否为空（全部字段无有效内容） */
function isReportEmpty(data: ReportData): boolean {
  return (
    data.summary.trim().length === 0 &&
    data.highlights.length === 0 &&
    data.issues.length === 0 &&
    data.reference_answers.length === 0 &&
    data.next_actions.length === 0 &&
    data.resume_risks.length === 0
  )
}

/**
 * 生成报告。
 *
 * 前置：会话已完成（有逐题评分）。分数由服务端从 `evaluations` 聚合，
 * 因此**没有评分时拒绝生成**（报告任一分数必须能回溯到具体回答）。
 */
export async function generateReport(
  userId: string,
  sessionId: string,
  ports: ReportPorts,
  options: { regenerate?: boolean } = {},
): Promise<GenerateReportResult> {
  const db = getDb()

  const sessionRows = await db
    .select()
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, userId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) throw notFound('面试会话不存在')

  const evaluationRows = await db
    .select({ evaluation: evaluations, question: questions })
    .from(evaluations)
    .innerJoin(questions, eq(questions.id, evaluations.questionId))
    .where(eq(evaluations.sessionId, sessionId))

  if (evaluationRows.length === 0) {
    throw validationError('该面试尚无逐题评分，请先完成评分再生成报告')
  }

  const existing = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.sessionId, sessionId))
    .limit(1)

  if (existing[0] && !options.regenerate) {
    throw validationError('该会话已生成报告，如需重新生成请显式指定 regenerate')
  }

  // ① 分数：服务端计算，不交给模型
  const perQuestion = evaluationRows.map(
    (row) => row.evaluation.dimensionScores as DimensionScores,
  )
  const scores = computeSessionScores(perQuestion)

  // ② 简历疑点（仅可归纳，不得新增）
  let resumeRisks: string[] = []
  if (session.resumeId) {
    const resumeRows = await db
      .select()
      .from(resumes)
      .where(eq(resumes.id, session.resumeId))
      .limit(1)
    const parsed = resumeRows[0]?.parsedData as { risks?: unknown } | null
    resumeRisks = toStringArray(parsed?.risks)
  }

  // ③ JD 要求（便于生成更贴合的改进建议）
  let jdJson = '（未关联岗位 JD）'
  if (session.jobJdId) {
    const jdRows = await db.select().from(jobJds).where(eq(jobJds.id, session.jobJdId)).limit(1)
    if (jdRows[0]?.parsedData) jdJson = JSON.stringify(jdRows[0].parsedData)
  }

  const evaluationsJson = JSON.stringify(
    evaluationRows.map((row) => ({
      question: row.question.content,
      type: row.question.type,
      dimension_scores: row.evaluation.dimensionScores,
      question_score: Number(row.evaluation.questionScore),
      feedback: row.evaluation.feedback,
    })),
  )

  const prompt = buildReportPrompt({ evaluationsJson, resumeRisks, jdJson })
  /**
   * 参考回答的校验白名单 = **本次面试的全部题目**，不是「已评分的题目」。
   *
   * 一次面试通常只评了部分题（或只评了 1 题），若白名单只取已评分的题，
   * 模型针对其它**真实存在**的题目写出的参考回答会被全部判为
   * 「题目不在本次面试中」而丢弃 —— 结果 N7 要求的「参考回答」四要素
   * 几乎永远为空，而校验日志还会显示成模型在编题目（其实是误判）。
   */
  const sessionQuestionRows = await db
    .select({ content: questions.content })
    .from(questions)
    .where(eq(questions.sessionId, sessionId))
  const questionTexts = sessionQuestionRows.map((row) => row.content)

  let lastViolations: string[] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const outcome = await parseWithRetry({
      llm: ports.llm,
    operation: 'report',
      system: prompt.system,
      user: prompt.user,
      schema: reportParseSchema,
    })

    if (!outcome.ok) {
      // 环境级失败（未配置 / 余额不足 / 服务不可用）→ 立即返回，不做无意义重试
      if (isEnvironmentLevelParseFailure(outcome.code)) {
        return {
          ok: false,
          code: 'ai_unavailable',
          message: outcome.error.userMessage,
          attempts: attempt,
        }
      }
      continue
    }

    const verified = verifyReportData(outcome.data.data, { questionTexts, resumeRisks })
    lastViolations = verified.dropped

    if (isReportEmpty(verified.data)) continue

    const saved = await db.transaction(async (tx) => {
      if (existing[0]) {
        await tx.delete(reports).where(eq(reports.id, existing[0].id))
      }

      const inserted = await tx
        .insert(reports)
        .values({
          sessionId,
          userId,
          totalScore: String(scores.totalScore),
          dimensionScores: scores.dimensionScores,
          highlights: verified.data.highlights,
          issues: verified.data.issues,
          referenceAnswers: verified.data.reference_answers,
          nextSteps: verified.data.next_actions,
          resumeRisks: verified.data.resume_risks,
          summary: verified.data.summary,
        })
        .returning()

      // 编排阶段推进到 REPORTING（FINISHED 的唯一后继）
      await tx
        .update(interviewSessions)
        .set({
          phase: 'REPORTING',
          phaseUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(ownedByActive(interviewSessions, sessionId, userId))

      return inserted[0]
    })

    if (!saved) throw internalError('报告写入失败')

    // 免费额度消耗：**在生成报告成功之后**执行（见 docs/design/UI.md §5.6）
    //
    // - 会员：不消耗（consumeFreeTrial 内部直接返回）
    // - 免费用户：消耗 1 次；同一报告重复生成不会重复消耗（幂等）
    //
    // 失败不阻断报告返回：报告已经产出，余额问题不应让用户拿不到结果。
    let credit: { consumed: boolean; remaining: number; reason?: string } = {
      consumed: false,
      remaining: 0,
    }
    try {
      credit = await consumeFreeTrial(userId, saved.id)
    } catch (error) {
      console.error('[report] 免费额度消耗失败（报告已生成）', error)
    }

    return {
      ok: true,
      report: toView(saved),
      attempts: attempt,
      dropped: lastViolations,
      credit,
    }
  }

  return {
    ok: false,
    code: 'report_failed',
    message: parseError('ai_invalid_output').userMessage,
    attempts: MAX_ATTEMPTS,
    violations: lastViolations,
  }
}

/**
 * 读取报告（含免费/付费字段裁剪）。
 *
 * **安全要点**：未解锁时，付费字段的内容**不会出现在返回值中**，
 * 只返回被锁字段的**名字**（`lockedSections`）供 UI 渲染遮罩。
 * 否则序列化响应会把付费内容一并发给前端，解锁形同虚设。
 */
export async function getReportBySession(
  userId: string,
  sessionId: string,
): Promise<{
  report: ReportView
  isUnlocked: boolean
  lockedSections: string[]
  /** 岗位匹配度（来自会话的匹配分析，面试前产出），无匹配分析时为 null */
  matchScore: number | null
  /** 按低分维度自动生成的基础建议 —— **免费可见** */
  baseSuggestions: BaseSuggestion[]
  /** 当前用户权益（服务端权威） */
  entitlements: Entitlements
}> {
  const db = getDb()

  const sessionRows = await db
    .select({ id: interviewSessions.id, matchAnalysis: interviewSessions.matchAnalysis })
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, userId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) throw notFound('面试会话不存在')

  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.sessionId, sessionId))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('报告尚未生成')

  const report = toView(row)

  // 详细报告权益：会员，或该报告被单独解锁（以订单为权威凭证，不看 is_unlocked 字段）
  const entitlements = await getEntitlements(userId)
  const unlockedByOrder = await hasReportUnlock(userId, report.id)
  const unlocked = entitlements.reportDetail || unlockedByOrder

  const analysis = session.matchAnalysis as { match_score?: unknown } | null
  const matchScore =
    analysis && typeof analysis.match_score === 'number' ? analysis.match_score : null

  // 免费可见：总分、六维分、优势、总评、基础训练建议
  // 付费解锁：问题、参考回答、完整建议、简历疑点、逐题反馈
  return {
    report: unlocked
      ? report
      : { ...report, issues: [], referenceAnswers: [], nextSteps: [], resumeRisks: [] },
    isUnlocked: unlocked,
    lockedSections: unlocked
      ? []
      : ['issues', 'referenceAnswers', 'nextSteps', 'resumeRisks', 'evaluations'],
    matchScore,
    baseSuggestions: buildBaseSuggestions(report.dimensionScores),
    entitlements,
  }
}

export { SCHEMA_VERSION }
