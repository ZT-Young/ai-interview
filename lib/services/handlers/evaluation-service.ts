import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { answers, evaluations, interviewSessions, jobJds, questions, resumes } from '@/db/schema'
import { internalError, notFound, validationError } from '@/lib/api/errors'
import { ownedByActive } from '@/lib/api/ownership'
import { buildEvaluationPrompt } from '@/lib/ai/prompts/evaluation'
import {
  evaluationParseSchema,
  GENERIC_IMPROVEMENT_HINT,
  hasLowDimension,
  verifyEvidenceQuotes,
  type DimensionScores,
  type EvidenceVerification,
} from '@/lib/ai/schemas/evaluation'
import { SCHEMA_VERSION } from '@/lib/ai/schemas/parse'
import { questionScoreOf } from '@/lib/ai/scoring'
import { isEnvironmentLevelParseFailure, parseError } from '@/lib/parsing/errors'
import type { LlmPort } from '@/lib/parsing/llm-port'
import { parseWithRetry, MAX_ATTEMPTS } from '@/lib/parsing/run'

/**
 * 逐题评分服务 —— docs/engineering/AI_PROMPTS.md §6。
 *
 * 关键约束：
 * - **每条评分必须引用回答原文证据**，且证据必须是回答的子串（校验层强制）
 * - 单题折算分由服务端按公式计算（lib/ai/scoring.ts），**不采用模型给的分数**
 * - 幂等：同一题重复评分需显式 `regenerate`
 */

export interface EvaluationPorts {
  llm: LlmPort
}

export interface EvaluationView {
  id: string
  questionId: string
  dimensionScores: DimensionScores
  questionScore: number
  feedback: string
  evidenceQuotes: Array<{ quote: string; reason: string }>
  /**
   * 该题的参考答案（示范怎么答），基于候选人真实简历经历。
   * 历史数据可能为 null。
   */
  referenceAnswer: string | null
  aiModel: string | null
}

export type EvaluateResult =
  | {
      ok: true
      evaluation: EvaluationView
      attempts: number
      /** 被剔除的引用（原文不匹配或命中禁止项） */
      droppedQuotes: EvidenceVerification['dropped']
    }
  | { ok: false; code: 'ai_unavailable'; message: string; attempts: number }
  | { ok: false; code: 'evaluation_failed'; message: string; attempts: number }

function toEvidence(value: unknown): Array<{ quote: string; reason: string }> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { quote: string; reason: string } => {
      if (typeof item !== 'object' || item === null) return false
      const candidate = item as { quote?: unknown; reason?: unknown }
      return typeof candidate.quote === 'string' && typeof candidate.reason === 'string'
    })
    .map((item) => ({ quote: item.quote, reason: item.reason }))
}

function toView(row: typeof evaluations.$inferSelect): EvaluationView {
  return {
    id: row.id,
    questionId: row.questionId,
    dimensionScores: row.dimensionScores as DimensionScores,
    questionScore: Number(row.questionScore),
    feedback: row.feedback,
    evidenceQuotes: toEvidence(row.evidenceQuotes),
    referenceAnswer: row.referenceAnswer,
    aiModel: row.aiModel,
  }
}

/** 组装落库用的 feedback：优势 / 问题 / 改进要点 + 证据摘要 */
export function composeFeedback(input: {
  feedback: string
  betterAnswer: string
  quotes: Array<{ quote: string; reason: string }>
}): string {
  const sections: string[] = []

  if (input.feedback.trim().length > 0) sections.push(input.feedback.trim())
  if (input.betterAnswer.trim().length > 0) sections.push(`改进要点：${input.betterAnswer.trim()}`)

  if (input.quotes.length > 0) {
    sections.push(
      `依据：${input.quotes.map((item) => `“${item.quote}”`).join('；')}`,
    )
  }

  return sections.join('\n')
}

/**
 * 对一道题的回答打分。
 *
 * 校验失败会重试（见 lib/parsing/run.ts 的 MAX_ATTEMPTS）；
 * 每次尝试后额外做证据子串校验，**全部引用都不匹配原文时视为失败并重试**。
 */
export async function evaluateAnswer(
  userId: string,
  sessionId: string,
  questionId: string,
  ports: EvaluationPorts,
  options: { regenerate?: boolean } = {},
): Promise<EvaluateResult> {
  const db = getDb()

  const sessionRows = await db
    .select()
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, userId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) throw notFound('面试会话不存在')

  const questionRows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.sessionId, sessionId)))
    .limit(1)

  const question = questionRows[0]
  if (!question) throw notFound('题目不存在')

  const answerRows = await db
    .select()
    .from(answers)
    .where(eq(answers.questionId, questionId))
    .limit(1)

  const answer = answerRows[0]
  if (!answer) throw validationError('该题尚未作答，无法评分')

  // 幂等：已有评分时默认拒绝，避免覆盖（与计划生成保持一致）
  const existing = await db
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(eq(evaluations.questionId, questionId))
    .limit(1)

  if (existing[0] && !options.regenerate) {
    throw validationError('该题已评分，如需重新评分请显式指定 regenerate')
  }

  // JD 结构化要求（可选）
  let jdJson = '（未关联岗位 JD）'
  if (session.jobJdId) {
    const jdRows = await db.select().from(jobJds).where(eq(jobJds.id, session.jobJdId)).limit(1)
    if (jdRows[0]?.parsedData) jdJson = JSON.stringify(jdRows[0].parsedData)
  }

  /**
   * 简历结构化数据。
   *
   * **必须传入**：参考答案要「基于候选人真实经历」，没有简历上下文时模型只能
   * 泛泛而谈或编造经历（违反 N4）。这里与 JD 一样做可选兜底，
   * 未关联简历时明确告知模型，让它改为给通用答题思路而不是编造。
   */
  let resumeJson = '（未关联简历：请只给答题思路，不要编造任何具体经历）'
  if (session.resumeId) {
    const resumeRows = await db.select().from(resumes).where(eq(resumes.id, session.resumeId)).limit(1)
    if (resumeRows[0]?.parsedData) resumeJson = JSON.stringify(resumeRows[0].parsedData)
  }

  const prompt = buildEvaluationPrompt({
    jdJson,
    resumeJson,
    question: question.content,
    questionType: question.type,
    expectedPoints: Array.isArray(question.expectedPoints)
      ? (question.expectedPoints as string[])
      : [],
    answer: answer.content,
  })

  let lastDropped: EvidenceVerification['dropped'] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const outcome = await parseWithRetry({
      llm: ports.llm,
    operation: 'evaluate',
      system: prompt.system,
      user: prompt.user,
      schema: evaluationParseSchema,
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

    const data = outcome.data.data
    const verified = verifyEvidenceQuotes(data.evidence_quotes, answer.content)
    // 累积被剔除的引用，供返回与审计
    lastDropped = [...lastDropped, ...verified.dropped]

    // 证据全部不匹配原文 → 视为无效评分，重试（防止编造引用）
    if (verified.quotes.length === 0) continue

    let feedback = data.feedback
    // 低分必须给出可执行建议
    if (hasLowDimension(data.dimension_scores) && feedback.trim().length < 10) {
      feedback = `${feedback}\n${GENERIC_IMPROVEMENT_HINT}`
    }

    const composed = composeFeedback({
      feedback,
      betterAnswer: data.better_answer,
      quotes: verified.quotes,
    })

    // 单题折算分由服务端计算，不采用模型输出的分数
    const questionScore = questionScoreOf(data.dimension_scores)

    const saved = await db.transaction(async (tx) => {
      if (existing[0]) {
        await tx.delete(evaluations).where(eq(evaluations.id, existing[0].id))
      }

      const inserted = await tx
        .insert(evaluations)
        .values({
          questionId,
          sessionId,
          dimensionScores: data.dimension_scores,
          questionScore: String(questionScore),
          feedback: composed,
          evidenceQuotes: verified.quotes,
          // 参考答案单独落库：它是「示范怎么答」，与 feedback 里的「改进要点」语义不同
          referenceAnswer: data.reference_answer.trim() || null,
          aiModel: outcome.model,
          promptVersion: SCHEMA_VERSION,
        })
        .returning()

      return inserted[0]
    })

    if (!saved) throw internalError('评分写入失败')

    return {
      ok: true,
      evaluation: toView(saved),
      attempts: attempt,
      droppedQuotes: lastDropped,
    }
  }

  return {
    ok: false,
    code: 'evaluation_failed',
    message: parseError('ai_invalid_output').userMessage,
    attempts: MAX_ATTEMPTS,
  }
}

/** 读取某会话的全部逐题评分（按题目顺序） */
export async function listEvaluations(
  userId: string,
  sessionId: string,
): Promise<Array<EvaluationView & { questionContent: string; questionOrder: number; answerContent: string }>> {
  const db = getDb()

  const sessionRows = await db
    .select({ id: interviewSessions.id })
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, userId))
    .limit(1)

  if (!sessionRows[0]) throw notFound('面试会话不存在')

  const rows = await db
    .select({
      evaluation: evaluations,
      question: questions,
      answer: answers,
    })
    .from(evaluations)
    .innerJoin(questions, eq(questions.id, evaluations.questionId))
    .leftJoin(answers, eq(answers.questionId, evaluations.questionId))
    .where(eq(evaluations.sessionId, sessionId))

  return rows
    .map((row) => ({
      ...toView(row.evaluation),
      questionContent: row.question.content,
      questionOrder: row.question.orderIndex,
      answerContent: row.answer?.content ?? '',
    }))
    .sort((a, b) => a.questionOrder - b.questionOrder)
}
