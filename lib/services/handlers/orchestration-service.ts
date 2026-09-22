import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  answers,
  interviewMessages,
  interviewSessions,
  jobJds,
  questions,
  resumes,
  type InterviewMessage,
  type Question,
} from '@/db/schema'
import { internalError, notFound, validationError } from '@/lib/api/errors'
import { ownedByActive } from '@/lib/api/ownership'
import { buildFollowUpPrompt, buildHintPrompt } from '@/lib/ai/prompts/interview'
import { hintParseSchema, followUpParseSchema, normalizeFollowUp } from '@/lib/ai/schemas/interview'
import { MAX_QUESTION_DEPTH } from '@/db/schema/enums'
import { parseError } from '@/lib/parsing/errors'
import type { LlmPort } from '@/lib/parsing/llm-port'
import { parseWithRetry } from '@/lib/parsing/run'

import {
  assertPhaseTransition,
  type OrchestrationPhase,
} from './orchestration-state'

/**
 * 面试编排服务 —— ③ 领域服务层。
 *
 * 服务端状态机控制全部流程（docs/ARCHITECTURE.md §3.6）：
 * - **一次只问一个问题**：任何响应最多返回一条 question / follow_up
 * - **每主问题最多 2 层追问**：由本服务按 root_id 统计 depth 强制，忽略模型越界请求
 * - **太短用确定性阈值**：去空白后 < 30 字符直接判 too_short，不调用模型
 * - **跑题/模糊由模型判定**，并要求给出 focus（依据的回答片段）
 */

/** 回答少于该长度视为「太短」，直接追问细节（不调用模型） */
export const MIN_ANSWER_LENGTH = 30

export interface OrchestrationPorts {
  llm: LlmPort
}

export interface StepView {
  phase: OrchestrationPhase
  /** 本轮要展示的消息（最多 1 条提问/追问） */
  message: { id: string; role: string; type: string; content: string } | null
  question: {
    id: string
    orderIndex: number
    depth: number
    type: string
    source: string
    dimension: string
    content: string
    expectedPoints: string[]
    followUpAllowed: boolean
  } | null
  /** 进度：已回答的主问题数 / 主问题总数 */
  progress: { answered: number; total: number }
  finished: boolean
  followUpReason?: string
  focus?: string
}

function toExpectedPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function questionView(row: Question) {
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

function messageView(row: InterviewMessage) {
  return { id: row.id, role: row.role, type: row.type, content: row.content }
}

/* ------------------------------------------------------------------ *
 * 读取辅助
 * ------------------------------------------------------------------ */

async function requireSession(userId: string, sessionId: string) {
  const db = getDb()
  const rows = await db
    .select()
    .from(interviewSessions)
    .where(ownedByActive(interviewSessions, sessionId, userId))
    .limit(1)

  const session = rows[0]
  if (!session) throw notFound('面试会话不存在')
  return session
}

/** 主问题（depth = 0），按顺序 */
async function listMainQuestions(sessionId: string): Promise<Question[]> {
  const db = getDb()
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.sessionId, sessionId), eq(questions.depth, 0)))
    .orderBy(asc(questions.orderIndex))
}

/** 某主问题下已有的最大追问层级 */
async function maxFollowUpDepth(sessionId: string, rootId: string): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ value: sql<number>`coalesce(max(${questions.depth}), 0)` })
    .from(questions)
    .where(and(eq(questions.sessionId, sessionId), eq(questions.rootId, rootId)))

  return Number(rows[0]?.value ?? 0)
}

async function persistPhase(
  sessionId: string,
  userId: string,
  phase: OrchestrationPhase,
  extra: { currentQuestionId?: string | null; status?: 'in_progress' | 'completed'; finishedAt?: Date } = {},
): Promise<void> {
  const db = getDb()
  const now = new Date()

  await db
    .update(interviewSessions)
    .set({
      phase,
      phaseUpdatedAt: now,
      updatedAt: now,
      ...(extra.currentQuestionId !== undefined
        ? { currentQuestionId: extra.currentQuestionId }
        : {}),
      ...(extra.status ? { status: extra.status } : {}),
      ...(extra.finishedAt ? { finishedAt: extra.finishedAt } : {}),
      ...(extra.status === 'in_progress' ? { startedAt: now } : {}),
    })
    .where(ownedByActive(interviewSessions, sessionId, userId))
}

async function logMessage(input: {
  sessionId: string
  questionId?: string | null
  role: 'ai' | 'user' | 'system'
  type: 'question' | 'follow_up' | 'hint' | 'answer' | 'skip' | 'system'
  content: string
  followUpReason?: string | null
  focus?: string | null
  metadata?: Record<string, unknown>
}): Promise<InterviewMessage> {
  const db = getDb()
  const rows = await db
    .insert(interviewMessages)
    .values({
      sessionId: input.sessionId,
      questionId: input.questionId ?? null,
      role: input.role,
      type: input.type,
      content: input.content,
      followUpReason: input.followUpReason ?? null,
      focus: input.focus ?? null,
      metadata: input.metadata ?? {},
    })
    .returning()

  const row = rows[0]
  if (!row) throw internalError('消息写入失败')
  return row
}

/** 组装追问所需的上下文（JD 要求 + 简历要点） */
async function buildContext(session: typeof interviewSessions.$inferSelect): Promise<string> {
  const db = getDb()
  const parts: string[] = []

  if (session.jobJdId) {
    const rows = await db.select().from(jobJds).where(eq(jobJds.id, session.jobJdId)).limit(1)
    const parsed = rows[0]?.parsedData as { must_have?: string[]; responsibilities?: string[] } | null
    if (parsed) {
      if (parsed.must_have?.length) parts.push(`岗位硬性要求：${parsed.must_have.join('；')}`)
      if (parsed.responsibilities?.length) parts.push(`岗位职责：${parsed.responsibilities.join('；')}`)
    }
  }

  if (session.resumeId) {
    const rows = await db.select().from(resumes).where(eq(resumes.id, session.resumeId)).limit(1)
    const parsed = rows[0]?.parsedData as {
      skills?: string[]
      projects?: Array<{ name?: string }>
    } | null
    if (parsed) {
      if (parsed.skills?.length) parts.push(`候选人技能：${parsed.skills.join('、')}`)
      const projects = (parsed.projects ?? [])
        .map((item) => item.name)
        .filter((name): name is string => Boolean(name))
      if (projects.length) parts.push(`候选人项目：${projects.join('、')}`)
    }
  }

  return parts.length > 0 ? parts.join('\n') : '（无可用的岗位与简历要点）'
}

/* ------------------------------------------------------------------ *
 * 1. 开始面试：IDLE/READY → ASKING
 * ------------------------------------------------------------------ */

export async function startInterview(
  userId: string,
  sessionId: string,
): Promise<StepView> {
  const session = await requireSession(userId, sessionId)
  const mains = await listMainQuestions(sessionId)

  if (mains.length === 0) {
    throw validationError('该会话还没有面试计划，请先生成计划')
  }

  assertPhaseTransition(session.phase as OrchestrationPhase, 'READY')

  await persistPhase(sessionId, userId, 'READY', {
    status: 'in_progress',
    currentQuestionId: null,
  })

  await logMessage({
    sessionId,
    role: 'system',
    type: 'system',
    content: `面试开始，共 ${mains.length} 道主问题。`,
  })

  return nextStep(userId, sessionId)
}

/* ------------------------------------------------------------------ *
 * 2. 取下一题：READY/NEXT_QUESTION/FOLLOW_UP → ASKING
 * ------------------------------------------------------------------ */

export async function getNextQuestion(userId: string, sessionId: string): Promise<StepView> {
  await requireSession(userId, sessionId)
  return nextStep(userId, sessionId)
}

/**
 * 推进到下一道**未处理**的主问题。
 *
 * 「已处理」= 已有回答（answers）**或**已跳过（interview_messages 中有 skip 记录）。
 * 跳过必须计入，否则被跳过的题会被反复重问。
 *
 * 全部处理完则进入 FINISHED。
 */
async function nextStep(userId: string, sessionId: string): Promise<StepView> {
  const session = await requireSession(userId, sessionId)
  const mains = await listMainQuestions(sessionId)

  const db = getDb()
  const answeredRows = await db
    .select({ questionId: answers.questionId })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(and(eq(answers.userId, userId), eq(questions.sessionId, sessionId)))

  const skippedRows = await db
    .select({ questionId: interviewMessages.questionId })
    .from(interviewMessages)
    .where(
      and(
        eq(interviewMessages.sessionId, sessionId),
        eq(interviewMessages.type, 'skip'),
        eq(interviewMessages.role, 'user'),
      ),
    )

  const handledIds = new Set<string>()
  for (const row of answeredRows) handledIds.add(row.questionId)
  for (const row of skippedRows) if (row.questionId) handledIds.add(row.questionId)

  const nextMain = mains.find((item) => !handledIds.has(item.id))

  // 进度只统计主问题的回答数（跳过不计入已答，但计入已处理）
  const answeredMainCount = mains.filter((item) =>
    answeredRows.some((row) => row.questionId === item.id),
  ).length
  const progress = { answered: answeredMainCount, total: mains.length }

  if (!nextMain) {
    const phase = session.phase as OrchestrationPhase
    if (phase !== 'FINISHED') {
      assertPhaseTransition(phase, 'FINISHED')
      await persistPhase(sessionId, userId, 'FINISHED', {
        status: 'completed',
        currentQuestionId: null,
        finishedAt: new Date(),
      })
      await logMessage({
        sessionId,
        role: 'system',
        type: 'system',
        content: '所有问题已处理，面试结束。',
      })
    }

    return {
      phase: 'FINISHED',
      message: null,
      question: null,
      progress,
      finished: true,
    }
  }

  // 迁移到 ASKING（不同来源阶段走不同的合法路径）
  const phase = session.phase as OrchestrationPhase
  if (phase === 'READY') assertPhaseTransition('READY', 'ASKING')
  else if (phase === 'FOLLOW_UP') assertPhaseTransition('FOLLOW_UP', 'ASKING')
  else if (phase === 'NEXT_QUESTION') assertPhaseTransition('NEXT_QUESTION', 'ASKING')

  const message = await logMessage({
    sessionId,
    questionId: nextMain.id,
    role: 'ai',
    type: 'question',
    content: nextMain.content,
  })

  await persistPhase(sessionId, userId, 'WAITING_ANSWER', { currentQuestionId: nextMain.id })

  return {
    phase: 'WAITING_ANSWER',
    message: messageView(message),
    question: questionView(nextMain),
    progress,
    finished: false,
  }
}

/* ------------------------------------------------------------------ *
 * 3. 提交回答 / 跳过 / 请求提示
 * ------------------------------------------------------------------ */

export type SubmitAction = 'answer' | 'skip' | 'hint'

export interface SubmitResult extends StepView {
  /** 上一次提交产生的消息（回答/跳过/提示） */
  recorded: { id: string; type: string; content: string } | null
  /** 追问决策（仅 answer 动作且有追问时） */
  followUp?: { reason: string; focus: string; depth: number }
}

export async function submitAnswer(
  userId: string,
  sessionId: string,
  input: {
    /** 不传则使用会话当前的 currentQuestionId */
    questionId?: string
    action?: SubmitAction
    content?: string
    durationMs?: number
  },
  ports: OrchestrationPorts,
): Promise<SubmitResult> {
  const session = await requireSession(userId, sessionId)
  const action: SubmitAction = input.action ?? 'answer'

  const questionId = input.questionId ?? session.currentQuestionId
  if (!questionId) throw validationError('当前没有待回答的问题，请先获取下一题')

  const db = getDb()
  const questionRows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.sessionId, sessionId)))
    .limit(1)

  const question = questionRows[0]
  if (!question) throw notFound('题目不存在')

  // 跳过：不写 answers，仅记录消息并推进
  if (action === 'skip') {
    const message = await logMessage({
      sessionId,
      questionId,
      role: 'user',
      type: 'skip',
      content: '（已跳过该题）',
    })
    await persistPhase(sessionId, userId, 'NEXT_QUESTION', { currentQuestionId: null })

    const step = await nextStep(userId, sessionId)
    return { ...step, recorded: messageView(message) }
  }

  // 请求提示：记录消息，停留在 WAITING_ANSWER
  if (action === 'hint') {
    const hint = await generateHint(question, ports)
    const message = await logMessage({
      sessionId,
      questionId,
      role: 'ai',
      type: 'hint',
      content: hint,
    })
    return {
      phase: session.phase as OrchestrationPhase,
      message: messageView(message),
      question: questionView(question),
      progress: await progressOf(userId, sessionId),
      finished: false,
      recorded: null,
    }
  }

  const content = (input.content ?? '').trim()
  if (content.length === 0) throw validationError('回答内容不能为空')

  /**
   * 幂等保护：同一题已有回答时**不再重复插入**。
   *
   * 表上有唯一约束 `answers_question_unique(question_id)`，重复插入会抛
   * Postgres 23505，被兜底成 **500 服务器内部错误**。而重复提交是常见真实场景：
   * 用户双击提交、网络超时后重试、返回上一页再提交、页面刷新后重发。
   * 这些都不该是 500 —— 之前的回答已经生效，直接返回当前进度即可（幂等）。
   *
   * 这里只对「已有回答」做幂等；`skip` 不写 answers，不受影响。
   */
  const existingAnswer = await db
    .select({ id: answers.id })
    .from(answers)
    .where(eq(answers.questionId, questionId))
    .limit(1)

  if (existingAnswer[0]) {
    const step = await nextStep(userId, sessionId)
    return { ...step, recorded: null }
  }

  // ① 先持久化回答：即使后续 AI 调用失败，用户的输入也不会丢
  const inserted = await db
    .insert(answers)
    .values({ questionId, userId, content, source: 'text', durationMs: input.durationMs ?? null })
    .returning()

  if (!inserted[0]) throw internalError('回答写入失败')

  await logMessage({
    sessionId,
    questionId,
    role: 'user',
    type: 'answer',
    content,
    metadata: { duration_ms: input.durationMs ?? null },
  })

  await persistPhase(sessionId, userId, 'WAITING_ANSWER', { currentQuestionId: questionId })

  // ② 决定是否追问（服务端强制层数上限）
  const decision = await decideFollowUp({
    userId,
    sessionId,
    session,
    question,
    answer: content,
    ports,
  })

  return decision
}

/* ------------------------------------------------------------------ *
 * 追问决策
 * ------------------------------------------------------------------ */

/**
 * 层数判定：
 * - 当前题目是主问题（depth 0）→ rootId 取自身
 * - 当前题目是追问 → rootId 取 root_id
 * - 主问题已有最大 depth 即当前追问层数
 */
async function decideFollowUp(input: {
  userId: string
  sessionId: string
  session: typeof interviewSessions.$inferSelect
  question: Question
  answer: string
  ports: OrchestrationPorts
}): Promise<SubmitResult> {
  const { userId, sessionId, question, answer, ports } = input
  const rootId = question.rootId ?? question.id
  const currentDepth = await maxFollowUpDepth(sessionId, rootId)

  /** 是否还能再追问一层：题目允许 + 未达层数上限 */
  const canFollowUp = question.followUpAllowed && currentDepth < MAX_QUESTION_DEPTH

  // 不能追问 → 直接推进到下一题
  if (!canFollowUp) {
    await persistPhase(sessionId, userId, 'NEXT_QUESTION', { currentQuestionId: null })
    const step = await nextStep(userId, sessionId)
    return {
      ...step,
      recorded: { id: question.id, type: 'answer', content: answer },
      followUp: undefined,
    }
  }

  await persistPhase(sessionId, userId, 'FOLLOW_UP', { currentQuestionId: question.id })

  /**
   * 确定性规则：回答过短 → 就地生成 too_short 追问，**不调用模型**。
   *
   * 必须在调用模型**之前**短路。早期实现只用 `forcedReason` 在 prompt 里
   * 「请求」模型返回 `too_short`，真正的兜底却放在模型失败分支里 ——
   * 于是模型可用时它回 `vague` 就是 `vague`，模型还被白调用一次。
   * 回答过短是本地可判定的事实，不该由模型决定。
   */
  if (answer.length < MIN_ANSWER_LENGTH) {
    return emitFollowUp({
      userId,
      sessionId,
      parentQuestion: question,
      rootId,
      content: '请就你刚提到的内容再多说一些细节：具体做了什么、结果如何？',
      reason: 'too_short',
      focus: answer.slice(0, 300),
      depth: currentDepth + 1,
    })
  }

  const context = await buildContext(input.session)
  const prompt = buildFollowUpPrompt({
    question: question.content,
    answer,
    context,
    depth: currentDepth,
  })

  const outcome = await parseWithRetry({
    llm: ports.llm,
    operation: 'follow_up',
    system: prompt.system,
    user: prompt.user,
    schema: followUpParseSchema,
  })

  // 模型不可用 / 输出不合规 → 退回下一题，不阻塞用户
  if (!outcome.ok) {
    await persistPhase(sessionId, userId, 'NEXT_QUESTION', { currentQuestionId: null })
    const step = await nextStep(userId, sessionId)
    return { ...step, recorded: null }
  }

  const normalized = normalizeFollowUp(outcome.data.data)

  if (normalized.action !== 'follow_up' || normalized.followUp.length === 0) {
    await persistPhase(sessionId, userId, 'NEXT_QUESTION', { currentQuestionId: null })
    const step = await nextStep(userId, sessionId)
    return { ...step, recorded: null }
  }

  return emitFollowUp({
    userId,
    sessionId,
    parentQuestion: question,
    rootId,
    content: normalized.followUp,
    reason: normalized.reason,
    focus: normalized.focus,
    depth: currentDepth + 1,
  })
}

/** 创建追问（作为新的 questions 行）并返回 ASKING 状态的一步 */
async function emitFollowUp(input: {
  userId: string
  sessionId: string
  parentQuestion: Question
  rootId: string
  content: string
  reason: string
  focus: string
  depth: number
}): Promise<SubmitResult> {
  const db = getDb()

  const maxOrder = await db
    .select({ value: sql<number>`coalesce(max(${questions.orderIndex}), 0)` })
    .from(questions)
    .where(eq(questions.sessionId, input.sessionId))

  const created = await db
    .insert(questions)
    .values({
      sessionId: input.sessionId,
      parentId: input.parentQuestion.id,
      rootId: input.rootId,
      depth: input.depth,
      orderIndex: Number(maxOrder[0]?.value ?? 0) + 1,
      type: input.parentQuestion.type,
      source: input.parentQuestion.source,
      content: input.content,
      dimension: input.parentQuestion.dimension,
      expectedPoints: [],
      followUpAllowed: true,
    })
    .returning()

  const followUp = created[0]
  if (!followUp) throw internalError('追问创建失败')

  await logMessage({
    sessionId: input.sessionId,
    questionId: followUp.id,
    role: 'ai',
    type: 'follow_up',
    content: input.content,
    followUpReason: input.reason,
    focus: input.focus,
    metadata: { depth: input.depth },
  })

  await persistPhase(input.sessionId, input.userId, 'WAITING_ANSWER', {
    currentQuestionId: followUp.id,
  })

  return {
    phase: 'WAITING_ANSWER',
    message: {
      id: followUp.id,
      role: 'ai',
      type: 'follow_up',
      content: followUp.content,
    },
    question: questionView(followUp),
    progress: await progressOf(input.userId, input.sessionId),
    finished: false,
    recorded: null,
    followUp: { reason: input.reason, focus: input.focus, depth: input.depth },
  }
}

/* ------------------------------------------------------------------ *
 * 4. 结束面试
 * ------------------------------------------------------------------ */

export async function finishInterview(
  userId: string,
  sessionId: string,
): Promise<{ phase: OrchestrationPhase; status: string; answered: number; total: number }> {
  const session = await requireSession(userId, sessionId)
  const mains = await listMainQuestions(sessionId)
  const progress = await progressOf(userId, sessionId)

  const phase = session.phase as OrchestrationPhase
  if (phase !== 'FINISHED') {
    // WAITING_ANSWER / NEXT_QUESTION / READY → FINISHED；其余非法
    assertPhaseTransition(phase, 'FINISHED')
    await persistPhase(sessionId, userId, 'FINISHED', {
      status: 'completed',
      currentQuestionId: null,
      finishedAt: new Date(),
    })
    await logMessage({
      sessionId,
      role: 'system',
      type: 'system',
      content: '用户结束了本次面试。',
    })
  }

  return {
    phase: 'FINISHED',
    status: 'completed',
    answered: progress.answered,
    total: mains.length,
  }
}

/* ------------------------------------------------------------------ *
 * 辅助
 * ------------------------------------------------------------------ */

async function progressOf(userId: string, sessionId: string) {
  const db = getDb()
  const mains = await listMainQuestions(sessionId)

  const rows = await db
    .select({ questionId: answers.questionId })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(and(eq(answers.userId, userId), eq(questions.sessionId, sessionId)))

  const answeredMainCount = mains.filter((item) =>
    rows.some((row) => row.questionId === item.id),
  ).length

  return { answered: answeredMainCount, total: mains.length }
}

/** 生成提示（不给答案，只给思路） */
async function generateHint(question: Question, ports: OrchestrationPorts): Promise<string> {
  const prompt = buildHintPrompt({
    question: question.content,
    expectedPoints: toExpectedPoints(question.expectedPoints),
  })

  const outcome = await parseWithRetry({
    llm: ports.llm,
    operation: 'hint',
    system: prompt.system,
    user: prompt.user,
    schema: hintParseSchema,
  })

  if (!outcome.ok) {
    // 提示是辅助功能，失败时给固定文案而不是报错
    const expected = toExpectedPoints(question.expectedPoints)
    if (expected.length > 0) {
      return `可以从这几块组织回答：${expected.join('、')}。`
    }
    return '建议按「背景 → 你负责的部分 → 具体做法 → 量化结果」的顺序组织回答。'
  }

  return outcome.data.data.hint || '建议按「背景 → 你负责的部分 → 具体做法 → 量化结果」组织回答。'
}

/** 读取整场对话消息（供调试与测试） */
export async function listMessages(userId: string, sessionId: string): Promise<InterviewMessage[]> {
  await requireSession(userId, sessionId)
  const db = getDb()
  return db
    .select()
    .from(interviewMessages)
    .where(eq(interviewMessages.sessionId, sessionId))
    .orderBy(asc(interviewMessages.createdAt))
}

export { MAX_QUESTION_DEPTH }
