/**
 * 追问决策层（抽离自 orchestration-service.ts）。
 *
 * 职责单一：在用户回答后**决定是否追问、追问什么**。所有护栏都在本层且
 * 与 Agent 解耦，模型无法绕过：层数上限、确定性 too_short 短路、归一化降级、
 * Agent 失败/超时退回下一题。状态落库与阶段推进一律委托 state.ts，避免重复。
 *
 * 状态机守卫严格保留：进入追问前先落 FOLLOW_UP；凡是要回到下一题的分支
 * 都先落 NEXT_QUESTION 再交给 nextStep（nextStep 据此断言 NEXT_QUESTION→ASKING）。
 */

import { and, asc, eq, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  answers,
  interviewMessages,
  interviewSessions,
  jobJds,
  questions,
  resumes,
  type Question,
} from '@/db/schema'
import { internalError } from '@/lib/api/errors'
import { runInterviewAgent, type AgentContext } from '@/lib/ai/agent/loop'
import type { ToolResult } from '@/lib/ai/agent/tools'
import { normalizeFollowUp } from '@/lib/ai/schemas/interview'
import { MAX_QUESTION_DEPTH } from '@/db/schema/enums'
import { logMessage, nextStep, persistPhase, progressOf } from './state'
import { MIN_ANSWER_LENGTH, questionView, type OrchestrationPorts, type SubmitResult } from './shared'

/** 某主问题下已有的最大追问层级 */
async function maxFollowUpDepth(sessionId: string, rootId: string): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ value: sql<number>`coalesce(max(${questions.depth}), 0)` })
    .from(questions)
    .where(and(eq(questions.sessionId, sessionId), eq(questions.rootId, rootId)))

  return Number(rows[0]?.value ?? 0)
}

/**
 * 组装 Agent 可用的检索上下文。
 *
 * 与旧 `buildContext()`（拼一份固定摘要）的区别：**这里给的是原材料**，
 * 由 Agent 自己决定检索什么（简历 / JD / 历史问答 / 已问题目），
 * 服务端只负责把数据取出来并保证不越界（只取本会话、按 rootId 限定范围）。
 */
async function buildAgentContext(input: {
  session: typeof interviewSessions.$inferSelect
  rootId: string
  question: Question
  answer: string
}): Promise<AgentContext> {
  const db = getDb()
  const { session, rootId, question, answer } = input

  let resume: unknown = null
  if (session.resumeId) {
    const rows = await db.select().from(resumes).where(eq(resumes.id, session.resumeId)).limit(1)
    resume = rows[0]?.parsedData ?? null
  }

  let jd: unknown = null
  if (session.jobJdId) {
    const rows = await db.select().from(jobJds).where(eq(jobJds.id, session.jobJdId)).limit(1)
    jd = rows[0]?.parsedData ?? null
  }

  // 当前主问题链上的问答（含本次），供 recent_answers 检索
  const chainRows = await db
    .select({ question: questions, answer: answers })
    .from(questions)
    .leftJoin(answers, eq(answers.questionId, questions.id))
    .where(and(eq(questions.sessionId, session.id), eq(questions.rootId, rootId)))
    .orderBy(asc(questions.depth))

  const history = chainRows.map((row) => ({
    question: row.question.content,
    answer: row.answer?.content ?? '',
    depth: row.question.depth,
  }))

  // 本次回答尚未落库时补上（链里只有已落库的行）
  if (history.length === 0 || history[history.length - 1].question !== question.content) {
    history.push({ question: question.content, answer, depth: question.depth })
  }

  const askedRows = await db
    .select({ content: questions.content })
    .from(questions)
    .where(eq(questions.sessionId, session.id))
    .orderBy(asc(questions.orderIndex))

  const mainQuestion =
    question.depth === 0
      ? question.content
      : (chainRows.find((row) => row.question.depth === 0)?.question.content ?? question.content)

  return {
    resume,
    jd,
    mainQuestion,
    currentAnswer: answer,
    history,
    askedQuestions: askedRows.map((row) => row.content),
  }
}

/**
 * 层数判定：
 * - 当前题目是主问题（depth 0）→ rootId 取自身
 * - 当前题目是追问 → rootId 取 root_id
 * - 主问题已有最大 depth 即当前追问层数
 */
export async function decideFollowUp(input: {
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

  // 不能追问 → 落 NEXT_QUESTION 后推进到下一题
  if (!canFollowUp) {
    await persistPhase(sessionId, userId, 'NEXT_QUESTION', { currentQuestionId: null })
    const step = await nextStep(userId, sessionId)
    return {
      ...step,
      recorded: { id: question.id, type: 'answer', content: answer },
      followUp: undefined,
    }
  }

  // 进入追问判定：先落 FOLLOW_UP（护栏之一，保证状态机可审计）
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

  /**
   * Agent 决策：模型可先检索（简历 / JD / 历史问答 / 已问题目）再决定追问与否。
   *
   * 护栏全部保留且与 Agent 解耦，模型**无法绕过**：
   * - 层数上限 `MAX_QUESTION_DEPTH`（上面 canFollowUp 已判定）
   * - 最终决策仍过 `normalizeFollowUp()`：空内容降级、敏感词/禁止项降级
   * - Agent 失败或超出轮数 → 退回下一题，不阻塞用户
   */
  const agentContext = await buildAgentContext({
    session: input.session,
    rootId,
    question,
    answer,
  })

  const agent = await runInterviewAgent({
    llm: ports.llm,
    context: agentContext,
    depth: currentDepth,
  })

  // Agent 不可用 / 未在轮数内收敛 → 落 NEXT_QUESTION 后退回下一题，不阻塞用户
  if (!agent.ok) {
    await persistPhase(sessionId, userId, 'NEXT_QUESTION', { currentQuestionId: null })
    const step = await nextStep(userId, sessionId)
    return { ...step, recorded: null }
  }

  const normalized = normalizeFollowUp({
    action: agent.decision.action,
    follow_up: agent.decision.followUp,
    reason: agent.decision.reason,
    focus: agent.decision.focus,
  })

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
    toolTrace: agent.toolTrace,
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
  /** Agent 的工具调用轨迹（可审计：这次追问依据了哪些检索） */
  toolTrace?: ToolResult[]
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
    metadata: {
      depth: input.depth,
      ...(input.toolTrace && input.toolTrace.length > 0
        ? {
            toolTrace: input.toolTrace.map((item) => ({
              name: item.name,
              argument: item.argument,
              ok: item.ok,
            })),
          }
        : {}),
    },
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
