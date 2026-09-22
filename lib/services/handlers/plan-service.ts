import { and, asc, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { interviewSessions, questions, resumes, jobJds } from '@/db/schema'
import { internalError, notFound, validationError } from '@/lib/api/errors'
import { ownedByActive } from '@/lib/api/ownership'
import { buildPlanPrompt } from '@/lib/ai/prompts/plan'
import type { JdData, ResumeData } from '@/lib/ai/schemas/parse'
import {
  analyzePlan,
  planParseSchema,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  SCHEMA_VERSION,
  type PlanAnalysis,
  type PlanQuestion,
} from '@/lib/ai/schemas/plan'
import { parseError, type ParseError } from '@/lib/parsing/errors'
import { OpenAiCompatibleLlm, type LlmPort } from '@/lib/parsing/llm-port'
import { extractJsonObject } from '@/lib/parsing/run'

/**
 * 面试计划领域服务 —— ③ 领域服务层。
 *
 * 流程：读取会话与资料 → 组 prompt → LLM → schema 校验 → **配额与合规后置校验**
 * → 事务内写 questions 并迁移会话状态。
 *
 * 契约见 docs/engineering/AI_PROMPTS.md §4；配额规则见 §4.3。
 */

/** 生成失败时的重试次数（与解析保持一致：1 次原始 + 1 次降温重试） */
export const MAX_PLAN_ATTEMPTS = 2
const RETRY_TEMPERATURE = 0.2

export interface PlanPorts {
  llm: LlmPort
}

export function createDefaultPlanPorts(): PlanPorts {
  return { llm: new OpenAiCompatibleLlm() }
}

/** DB 枚举的派生子集，避免在服务层硬编码字符串 */
export const PLAN_QUESTION_TYPES = ['self_intro', 'project_dig', 'technical', 'behavioral', 'reverse'] as const

export interface PlanQuestionView {
  id: string
  orderIndex: number
  depth: number
  type: string
  source: string
  dimension: string
  content: string
  expectedPoints: string[]
  followUpAllowed: boolean
}

export interface SessionPlanView {
  sessionId: string
  status: string
  plan: unknown
  config: unknown
  /** 匹配分析结果；为空说明尚未生成，出题将不可用 */
  matchAnalysis: unknown
  questions: PlanQuestionView[]
  total: number
}

export interface GeneratePlanOptions {
  /** 已有题目时是否覆盖重生成（默认拒绝，避免清除用户已答题） */
  regenerate?: boolean
  config?: { maxQuestions?: number; difficulty?: 'easy' | 'medium' | 'hard' }
}

export type GeneratePlanResult =
  | {
      ok: true
      sessionId: string
      total: number
      quota: PlanAnalysis['quota']
      plan: unknown
      questions: PlanQuestionView[]
      model: string
      attempts: number
    }
  | { ok: false; code: 'ai_unavailable'; error: ParseError; attempts: number }
  | { ok: false; code: 'plan_generation_failed'; error: ParseError; attempts: number; violations: string[] }

/** 从 jsonb 字段安全读取期望要点 */
function toExpectedPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toQuestionView(row: typeof questions.$inferSelect): PlanQuestionView {
  return {
    id: row.id,
    orderIndex: row.orderIndex,
    depth: row.depth,
    type: row.type,
    source: row.source,
    dimension: row.dimension,
    content: row.content,
    expectedPoints: toExpectedPoints(row.expectedPoints),
    followUpAllowed: row.followUpAllowed,
  }
}

/* ------------------------------------------------------------------ *
 * 读取面试计划
 * ------------------------------------------------------------------ */

export async function getSessionPlan(userId: string, sessionId: string): Promise<SessionPlanView> {
  const db = getDb()

  // 归属校验：他人会话一律 404
  const sessionRows = await db
    .select()
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, userId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) throw notFound('面试会话不存在')

  const rows = await db
    .select()
    .from(questions)
    .where(eq(questions.sessionId, sessionId))
    .orderBy(asc(questions.orderIndex))

  return {
    sessionId: session.id,
    status: session.status,
    plan: session.plan,
    config: session.config,
    matchAnalysis: session.matchAnalysis,
    questions: rows.map(toQuestionView),
    total: rows.length,
  }
}

/* ------------------------------------------------------------------ *
 * 生成面试计划
 * ------------------------------------------------------------------ */

/**
 * 出题的输出 token 预算。
 *
 * ⚠️ 这里踩过一个真实的坑：原值写死 4000，而 8-12 道题的 JSON
 * （每题含 content / type / source / dimension / expected_points /
 * follow_up_allowed）轻松超过 4000 token，于是输出被供应商**截断**，
 * JSON 不完整，最终报「模型返回不是合法 JSON」——
 * 看起来像模型不会输出 JSON，实际是预算不够。
 *
 * 现在默认 8000，并可用 `LLM_MAX_TOKENS_PLAN` 覆盖
 * （不同供应商上限不同，DeepSeek 实测接受 8192）。
 */
function planMaxTokens(): number {
  const raw = process.env.LLM_MAX_TOKENS_PLAN
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8000
}

/**
 * 单次调用 LLM 并做 schema + 配额校验。
 *
 * 与解析模块不同：这里**不能**只用 zod —— 数量/题型配额/可溯源规则
 * 必须由 analyzePlan 判定（docs/engineering/AI_PROMPTS.md §4.3）。
 *
 * ⚠️ 这里刻意**不用** `parseWithRetry`：`generatePlan` 外层已有自己的重试循环
 * （带降温与「不合规则换一次」的语义），内层再重试会导致调用次数翻倍。
 * 但必须自己补上「输出被截断」的判定——这是原本缺失的判断，
 * 导致截断被误报成「模型返回不是合法 JSON」。
 */
async function attemptPlan(
  llm: LlmPort,
  input: { system: string; user: string; temperature?: number; maxTokens?: number },
): Promise<
  | { kind: 'ok'; questions: PlanQuestion[]; analysis: PlanAnalysis; model: string }
  | { kind: 'llm_error'; error: unknown }
  | { kind: 'invalid'; violations: string[]; model: string }
> {
  let response: { content: string; model: string; finishReason?: string }
  try {
    response = await llm.complete({
      operation: 'plan',
      system: input.system,
      user: input.user,
      temperature: input.temperature,
      maxTokens: input.maxTokens ?? planMaxTokens(),
    })
  } catch (error) {
    return { kind: 'llm_error', error }
  }

  // 被 max_tokens 截断：JSON 必然不完整，必须给出准确原因
  if (response.finishReason === 'length') {
    return {
      kind: 'invalid',
      violations: [
        `模型输出被 max_tokens 截断（当前预算 ${input.maxTokens ?? planMaxTokens()}），` +
          '请提高 LLM_MAX_TOKENS_PLAN 或减少题目数量',
      ],
      model: response.model,
    }
  }

  const raw = extractJsonObject(response.content)
  if (raw === undefined) {
    return { kind: 'invalid', violations: ['模型返回不是合法 JSON'], model: response.model }
  }

  const parsed = planParseSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      kind: 'invalid',
      violations: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`,
      ),
      model: response.model,
    }
  }

  const analysis = analyzePlan(parsed.data.data)
  if (!analysis.ok) {
    return { kind: 'invalid', violations: analysis.violations, model: response.model }
  }

  return {
    kind: 'ok',
    questions: parsed.data.data.questions,
    analysis,
    model: response.model,
  }
}

/**
 * 生成面试计划并落库。
 *
 * 前置条件：会话存在且归属当前用户；简历与 JD 均已解析成功；
 * 匹配分析已产出（出题需要 match_analysis 作为输入）。
 */
export async function generatePlan(
  userId: string,
  sessionId: string,
  ports: PlanPorts,
  options: GeneratePlanOptions = {},
): Promise<GeneratePlanResult> {
  const db = getDb()

  const sessionRows = await db
    .select()
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, userId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) throw notFound('面试会话不存在')

  // 已有题目：默认拒绝，避免误删用户已答题（需显式 regenerate）
  const existing = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.sessionId, sessionId))

  if (existing.length > 0 && !options.regenerate) {
    throw validationError('该会话已生成面试计划，如需重新生成请显式指定 regenerate')
  }

  // 读取资料：必须都已解析
  if (!session.resumeId || !session.jobJdId) {
    throw validationError('生成面试计划需要同时关联简历与岗位 JD')
  }

  const resumeRows = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, session.resumeId), isNull(resumes.deletedAt)))
    .limit(1)
  const jdRows = await db
    .select()
    .from(jobJds)
    .where(and(eq(jobJds.id, session.jobJdId), isNull(jobJds.deletedAt)))
    .limit(1)

  const resume = resumeRows[0]
  const jobJd = jdRows[0]

  if (!resume || resume.parseStatus !== 'success' || !resume.parsedData) {
    throw validationError('简历尚未解析成功，请先在简历页面确认解析结果')
  }
  if (!jobJd || jobJd.parseStatus !== 'success' || !jobJd.parsedData) {
    throw validationError('岗位 JD 尚未解析成功，请先在 JD 页面确认解析结果')
  }

  const matchAnalysis = session.matchAnalysis
  if (!matchAnalysis) {
    throw validationError('缺少匹配分析结果，请先生成匹配分析')
  }

  const prompt = buildPlanPrompt({
    jdJson: JSON.stringify(jobJd.parsedData as JdData),
    resumeJson: JSON.stringify(resume.parsedData as ResumeData),
    matchJson: JSON.stringify(matchAnalysis),
    maxQuestions: options.config?.maxQuestions ?? MAX_QUESTIONS,
    difficulty: options.config?.difficulty,
  })

  let lastViolations: string[] = []
  let attempts = 0

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt += 1) {
    attempts = attempt
    const outcome = await attemptPlan(ports.llm, {
      system: prompt.system,
      user: prompt.user,
      temperature: attempt === 1 ? undefined : RETRY_TEMPERATURE,
    })

    if (outcome.kind === 'llm_error') {
      // 环境/网络级失败：不重试，直接告知服务不可用
      const error = parseError('ai_unavailable', { cause: outcome.error })
      return { ok: false, code: 'ai_unavailable', error, attempts: attempt }
    }

    if (outcome.kind === 'invalid') {
      lastViolations = outcome.violations
      continue
    }

    // 落库：事务内替换旧题并更新会话
    const plan = {
      prompt_version: SCHEMA_VERSION,
      model: outcome.model,
      attempts: attempt,
      total: outcome.questions.length,
      quota: outcome.analysis.quota,
      generated_at: new Date().toISOString(),
    }

    const inserted = await db.transaction(async (tx) => {
      // 重新生成场景：先清空旧题（answers/evaluations 会随外键级联删除）
      if (existing.length > 0) {
        await tx.delete(questions).where(eq(questions.sessionId, sessionId))
      }

      const rows = await tx
        .insert(questions)
        .values(
          outcome.questions.map((question, index) => ({
            sessionId,
            // 主问题：无父级、无 root、depth 0
            parentId: null,
            rootId: null,
            depth: 0,
            orderIndex: index,
            type: question.type,
            source: question.source,
            content: question.content,
            dimension: question.dimension,
            expectedPoints: question.expected_points,
            followUpAllowed: question.follow_up_allowed,
          })),
        )
        .returning()

      await tx
        .update(interviewSessions)
        .set({
          plan,
          // draft → planned；已是 planned 时幂等
          ...(session.status === 'draft' ? { status: 'planned' as const } : {}),
          updatedAt: new Date(),
        })
        .where(ownedByActive(interviewSessions, sessionId, userId))

      return rows
    })

    if (inserted.length === 0) throw internalError('面试计划写入失败')

    return {
      ok: true,
      sessionId,
      total: inserted.length,
      quota: outcome.analysis.quota,
      plan,
      questions: inserted.map(toQuestionView),
      model: outcome.model,
      attempts,
    }
  }

  const error = parseError('plan_generation_failed')
  return {
    ok: false,
    code: 'plan_generation_failed',
    error,
    attempts,
    violations: lastViolations,
  }
}

export { MIN_QUESTIONS, MAX_QUESTIONS }
