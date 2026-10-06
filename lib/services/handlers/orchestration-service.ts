import { and, asc, eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  answers,
  interviewMessages,
  questions,
  type InterviewMessage,
  type Question,
} from '@/db/schema'
import { internalError, notFound, validationError } from '@/lib/api/errors'
import { assertPhaseTransition, type OrchestrationPhase } from '../state/orchestration'
import { buildHintPrompt, PROMPT_VERSION } from '@/lib/ai/prompts/interview'
import { hintParseSchema } from '@/lib/ai/schemas/interview'
import { trackEvent } from '@/lib/observability/analytics'
import { parseWithRetry } from '@/lib/parsing/run'
import {
  listMainQuestions,
  logMessage,
  nextStep,
  persistPhase,
  progressOf,
  requireSession,
  trackInterviewCompleted,
} from './interview/state'
import { decideFollowUp } from './interview/followup'
import {
  messageView,
  questionView,
  toExpectedPoints,
  type OrchestrationPorts,
  type StepView,
  type SubmitAction,
  type SubmitResult,
} from './interview/shared'

/**
 * 面试编排服务 —— ③ 领域服务层。
 *
 * 本文件是**编排入口**：协调状态机（interview/state.ts）、追问决策
 * （interview/followup.ts）与提示生成，自身只做参数校验、事务边界与
 * 对外契约。服务端状态机控制全部流程（docs/engineering/ARCHITECTURE.md §3.6）：
 * - **一次只问一个问题**：任何响应最多返回一条 question / follow_up
 * - **每主问题最多 2 层追问**：由 followup 层按 root_id 统计 depth 强制
 * - **太短用确定性阈值**：去空白后 < 30 字符直接判 too_short，不调用模型
 * - **跑题/模糊由模型判定**，并要求给出 focus（依据的回答片段）
 *
 * 子模块划分见 interview/{shared,state,followup}.ts。
 */

export { MIN_ANSWER_LENGTH } from './interview/shared'
export type { StepView, SubmitResult, SubmitAction, OrchestrationPorts }
export { MAX_QUESTION_DEPTH } from '@/db/schema/enums'

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

  // 埋点：完面率的分母（docs/product/METRICS.md §2.2）
  void trackEvent('interview_started', {
    userId,
    sessionId,
    properties: {
      question_count: mains.length,
      has_resume: Boolean(session.resumeId),
      has_job_jd: Boolean(session.jobJdId),
    },
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

/* ------------------------------------------------------------------ *
 * 3. 提交回答 / 跳过 / 请求提示
 * ------------------------------------------------------------------ */

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
  return decideFollowUp({
    userId,
    sessionId,
    session,
    question,
    answer: content,
    ports,
  })
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
    void trackInterviewCompleted(userId, sessionId, 'user', {
      total: mains.length,
      answered: progress.answered,
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
    promptVersion: PROMPT_VERSION.hint,
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
