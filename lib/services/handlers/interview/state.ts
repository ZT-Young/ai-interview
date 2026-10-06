/**
 * 面试状态机与持久化层（抽离自 orchestration-service.ts）。
 *
 * 职责：服务端状态流转的**唯一权威**——读取会话/题目、推进阶段（phase）、
 * 落库消息与进度、计算进度、记录完面埋点。所有对外暴露的推进入口
 * （startInterview / getNextQuestion / submitAnswer / finishInterview）都通过本层
 * 的 `nextStep` 与 `persistPhase` 进行，保证状态迁移集中、可审计。
 *
 * 不在此层做 AI 决策（见 followup.ts）与提示生成（留在 orchestration-service）。
 */

import { and, asc, eq, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  answers,
  interviewMessages,
  interviewSessions,
  questions,
  type InterviewMessage,
  type Question,
} from '@/db/schema'
import { internalError, notFound } from '@/lib/api/errors'
import { ownedByActive } from '@/lib/api/ownership'
import { assertPhaseTransition, type OrchestrationPhase } from '../../state/orchestration'
import { trackEvent } from '@/lib/observability/analytics'
import { messageView, questionView, type StepView } from './shared'

/* ------------------------------------------------------------------ *
 * 读取辅助
 * ------------------------------------------------------------------ */

export async function requireSession(userId: string, sessionId: string) {
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
export async function listMainQuestions(sessionId: string): Promise<Question[]> {
  const db = getDb()
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.sessionId, sessionId), eq(questions.depth, 0)))
    .orderBy(asc(questions.orderIndex))
}

export async function persistPhase(
  sessionId: string,
  userId: string,
  phase: OrchestrationPhase,
  extra: {
    currentQuestionId?: string | null
    status?: 'in_progress' | 'completed'
    finishedAt?: Date
  } = {},
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

export async function logMessage(input: {
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

/* ------------------------------------------------------------------ *
 * 推进到下一题（状态机核心）
 * ------------------------------------------------------------------ */

/**
 * 推进到下一道**未处理**的主问题。
 *
 * 「已处理」= 已有回答（answers）**或**已跳过（interview_messages 中有 skip 记录）。
 * 跳过必须计入，否则被跳过的题会被反复重问。
 *
 * 全部处理完则进入 FINISHED。
 */
export async function nextStep(userId: string, sessionId: string): Promise<StepView> {
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
      // 自然结束：题目处理完（或跳过完）而结束，非用户主动点击
      void trackInterviewCompleted(userId, sessionId, 'natural', {
        total: mains.length,
        answered: progress.answered,
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
 * 进度与埋点
 * ------------------------------------------------------------------ */

export async function progressOf(userId: string, sessionId: string) {
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

/**
 * 埋点：面试完成（完面率的分子，docs/product/METRICS.md §3.1）。
 *
 * 跳过数与追问数**在这里自查**而不是由调用方传入：
 * 两处调用点（自然结束 / 用户主动结束）拿到的上下文不同，
 * 让调用方各自拼属性迟早会漏字段或口径不一致。
 *
 * 只记计数与时长，不记任何作答内容 —— 埋点的 PII 最小化硬要求。
 */
export async function trackInterviewCompleted(
  userId: string,
  sessionId: string,
  endedBy: 'natural' | 'user',
  counts: { total: number; answered: number },
): Promise<void> {
  try {
    const db = getDb()

    const [skipRow] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(interviewMessages)
      .where(and(eq(interviewMessages.sessionId, sessionId), eq(interviewMessages.type, 'skip')))

    const [followUpRow] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(questions)
      .where(and(eq(questions.sessionId, sessionId), sql`${questions.depth} > 0`))

    const [session] = await db
      .select({ startedAt: interviewSessions.startedAt, finishedAt: interviewSessions.finishedAt })
      .from(interviewSessions)
      .where(eq(interviewSessions.id, sessionId))
      .limit(1)

    const startedAt = session?.startedAt ?? null
    const finishedAt = session?.finishedAt ?? null
    const durationSec =
      startedAt && finishedAt
        ? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
        : null

    await trackEvent('interview_completed', {
      userId,
      sessionId,
      properties: {
        total_main_questions: counts.total,
        answered: counts.answered,
        skipped: skipRow?.value ?? 0,
        follow_up_count: followUpRow?.value ?? 0,
        duration_sec: durationSec,
        ended_by: endedBy,
      },
    })
  } catch (error) {
    // 埋点失败绝不影响面试流程
    console.error('[analytics] 记录 interview_completed 失败', error)
  }
}
