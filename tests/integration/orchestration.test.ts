import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { answers, interviewMessages, interviewSessions, jobJds, questions, resumes } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { MAX_QUESTION_DEPTH } from '@/db/schema/enums'
import type { PlanQuestion } from '@/lib/ai/schemas/plan'
import { createJobJd, updateParseState as updateJdParseState } from '@/lib/services/job-jd-service'
import { createResume, updateParseState as updateResumeParseState } from '@/lib/services/resume-service'
import { createSession } from '@/lib/services/session-service'
import { generatePlan } from '@/lib/services/plan-service'
import {
  finishInterview,
  getNextQuestion,
  listMessages,
  MIN_ANSWER_LENGTH,
  startInterview,
  submitAnswer,
} from '@/lib/services/orchestration-service'

import { FakeLlm, llmUnavailableError } from '../helpers/fakes'
import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
} from '../helpers/db'

/**
 * 面试编排集成测试。
 *
 * 覆盖：状态流转、**追问层数上限**、跳过、结束、消息持久化、权限隔离。
 * 需 DATABASE_URL + AUTH_SECRET；缺失时显式跳过。LLM 用 fake。
 */

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

/** 8 题计划：1 自我介绍 + 3 项目深挖 + 2 专业题 + 1 行为题 + 1 反问 */
function planQuestions(): PlanQuestion[] {
  const pool: PlanQuestion[] = [
    { content: '请先做一个自我介绍。', type: 'self_intro', source: 'generic', dimension: 'communication', expected_points: ['教育背景', '核心技能'], follow_up_allowed: false },
    { content: '请介绍 AI 面试平台这个项目你负责的部分。', type: 'project_dig', source: 'resume', dimension: 'project_depth', expected_points: ['项目背景', '个人职责'], follow_up_allowed: true },
    { content: '这个项目的技术难点是什么，你怎么权衡的？', type: 'project_dig', source: 'both', dimension: 'project_depth', expected_points: ['难点描述', '权衡依据'], follow_up_allowed: true },
    { content: '项目里数据一致性是如何保证的？', type: 'project_dig', source: 'resume', dimension: 'professional', expected_points: ['一致性方案', '故障处理'], follow_up_allowed: true },
    { content: '请说明 PostgreSQL 索引在什么场景下会失效。', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['失效场景', '验证方法'], follow_up_allowed: true },
    { content: '高并发下你会怎么设计限流方案？', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['限流算法', '降级策略'], follow_up_allowed: true },
    { content: '请讲一次你在有限时间内交付目标的经历。', type: 'behavioral', source: 'resume', dimension: 'motivation', expected_points: ['目标', '取舍', '结果'], follow_up_allowed: true },
    { content: '关于这个岗位，你想了解什么？', type: 'reverse', source: 'generic', dimension: 'motivation', expected_points: ['关注点', '提问质量'], follow_up_allowed: false },
  ]
  return pool
}

/**
 * ⚠️ 必须返回**对象**，不要用 `envelope()` helper —— 它返回的是 JSON 字符串
 * （见 tests/helpers/fakes.ts），而 `FakeLlm.always(json)` 自己会 `JSON.stringify`，
 * 传字符串会得到「被二次编码的字符串」，解析时命中最外层
 * `Invalid input: expected object, received string`，
 * 表现为整个计划生成失败，20 个用例连带报「夹具失败」。
 */
const planEnvelope = () => ({ schema_version: '1.0', data: { questions: planQuestions() } })

/** 让模型总是要求追问 */
const followUpLlm = (question = '你提到做过优化，具体怎么做的？') =>
  FakeLlm.always({
    schema_version: '1.0',
    data: {
      action: 'follow_up',
      follow_up: question,
      reason: 'vague',
      focus: '做过优化',
    },
  })

/** 让模型总是推进到下一题 */
const nextQuestionLlm = () =>
  FakeLlm.always({
    schema_version: '1.0',
    data: { action: 'next_question', follow_up: null, reason: 'good_enough', focus: '' },
  })

/** 建一个「计划已生成」的会话 */
async function seedPlannedSession(prefix: string) {
  const user = await createTestUser(prefix)
  createdUserIds.push(user.id)

  const resume = await createResume(user.id, {
    fileName: 'resume.pdf',
    fileType: 'pdf',
    fileSize: 1024,
    storageKey: `resumes/${user.id}/resume.pdf`,
  })
  await updateResumeParseState(user.id, resume.id, {
    parseStatus: 'success',
    parsedData: {
      name: 'Zhang Wei',
      years: 3,
      skills: ['TypeScript', 'PostgreSQL'],
      projects: [{ name: 'AI Interview Platform', role: 'Backend Engineer', actions: [], results: [], evidence: [] }],
      education: [],
      risks: [],
    },
  })

  const jobJd = await createJobJd(user.id, {
    rawText: 'Responsibilities: build backend services using TypeScript. Requirements: 3+ years Node.js.',
  })
  await updateJdParseState(user.id, jobJd.id, {
    parseStatus: 'success',
    parsedData: {
      title: 'AI Backend Engineer',
      company: 'Example Tech',
      must_have: ['熟悉 PostgreSQL'],
      nice_to_have: [],
      responsibilities: ['build backend services'],
      keywords: ['TypeScript'],
    },
  })

  const session = await createSession(user.id, { resumeId: resume.id, jobJdId: jobJd.id })

  const db = getDb()
  await db
    .update(interviewSessions)
    .set({
      matchAnalysis: {
        match_score: 72,
        advantages: [{ point: '技术栈匹配', evidence: 'TypeScript' }],
        gaps: ['简历中未提及分布式系统经验'],
        suggested_questions: [],
      },
    })
    .where(eq(interviewSessions.id, session.id))

  // 生成计划（用 fake LLM，不调真实模型）
  const planned = await generatePlan(user.id, session.id, { llm: FakeLlm.always(planEnvelope()) })
  // 夹具失败时必须打印真实原因：只说「计划未生成」会让 20 个用例一起报同一个无用信息
  if (!planned.ok) {
    throw new Error(
      `夹具失败：计划未生成 code=${planned.code} violations=${JSON.stringify(
        'violations' in planned ? planned.violations : [],
      )}`,
    )
  }

  return { user, session }
}

async function phaseOf(sessionId: string): Promise<string> {
  const db = getDb()
  const rows = await db
    .select({ phase: interviewSessions.phase, status: interviewSessions.status })
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sessionId))
    .limit(1)
  return `${rows[0]!.status}/${rows[0]!.phase}`
}

const LONG_ANSWER = '我在这个项目里负责评分服务的重构，用了两阶段提交保证一致性，P95 从 800ms 降到 220ms。'

describe.skipIf(!hasTestDatabase())(
  `面试编排集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    describe('开始面试与状态流转', () => {
      it('开始后置为 in_progress 并抛出第一题，且只返回一条消息', async () => {
        const { user, session } = await seedPlannedSession('orch-start')

        expect(await phaseOf(session.id)).toBe('planned/IDLE')

        const step = await startInterview(user.id, session.id)

        expect(step.finished).toBe(false)
        expect(step.message).not.toBeNull()
        // 一次只问一个问题：一次响应最多一条消息
        expect(step.question?.content).toBe('请先做一个自我介绍。')
        expect(step.progress).toEqual({ answered: 0, total: 8 })
        expect(await phaseOf(session.id)).toBe('in_progress/WAITING_ANSWER')
      })

      it('没有计划时拒绝开始', async () => {
        const user = await createTestUser('orch-noplan')
        createdUserIds.push(user.id)

        const db = getDb()
        const resume = await createResume(user.id, {
          fileName: 'r.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/r.pdf`,
        })
        const session = await createSession(user.id, { resumeId: resume.id })

        await expect(startInterview(user.id, session.id)).rejects.toMatchObject({ status: 422 })
      })

      it('getNextQuestion 在刷新后能恢复当前进度', async () => {
        const { user, session } = await seedPlannedSession('orch-resume')
        await startInterview(user.id, session.id)

        const step = await getNextQuestion(user.id, session.id)
        expect(step.question?.content).toBe('请先做一个自我介绍。')
        expect(step.finished).toBe(false)
      })

      it('回答后进度递增并推进到下一主问题', async () => {
        const { user, session } = await seedPlannedSession('orch-progress')
        await startInterview(user.id, session.id)

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: nextQuestionLlm() },
        )

        expect(result.progress).toEqual({ answered: 1, total: 8 })
        expect(result.question?.content).toContain('AI 面试平台')
        expect(await phaseOf(session.id)).toBe('in_progress/WAITING_ANSWER')
      })
    })

    describe('追问层数限制（核心规则）', () => {
      it('第一层追问：depth=1，phase 经 FOLLOW_UP 回到 WAITING_ANSWER', async () => {
        const { user, session } = await seedPlannedSession('orch-fu1')
        await startInterview(user.id, session.id)

        // 先答掉第 1 题（自我介绍，follow_up_allowed=false，按设计不会追问），
        // 使当前题目落到「允许追问」的第 2 题
        await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: nextQuestionLlm() },
        )

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: followUpLlm() },
        )

        expect(result.followUp?.depth).toBe(1)
        expect(result.message?.type).toBe('follow_up')
        expect(result.question?.depth).toBe(1)
        expect(await phaseOf(session.id)).toBe('in_progress/WAITING_ANSWER')
      })

      it('第二层追问：depth=2', async () => {
        const { user, session } = await seedPlannedSession('orch-fu2')
        await startInterview(user.id, session.id)

        // 先答掉第 1 题（自我介绍不允许追问）
        await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: nextQuestionLlm() },
        )

        // 第一层
        await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: followUpLlm('第一层追问？') },
        )

        // 第二层
        const second = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: followUpLlm('第二层追问？') },
        )

        expect(second.followUp?.depth).toBe(2)
        expect(second.question?.depth).toBe(2)
      })

      it('**达到 2 层后即使模型仍要求追问，也被强制推进到下一主问题**', async () => {
        const { user, session } = await seedPlannedSession('orch-fu-limit')
        await startInterview(user.id, session.id)

        // 先答掉第 1 题（自我介绍不允许追问）
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() })

        // ⚠️ 追问内容必须 ≥5 字符：normalizeFollowUp 会把 <5 字符的追问
        // 降级为 next_question（lib/ai/schemas/interview.ts），
        // 用占位短串（如 'L1'）根本触发不到追问分支
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: followUpLlm('第一层追问内容？') })
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: followUpLlm('第二层追问内容？') })

        // 第三层：模型依旧返回 follow_up，但服务端必须忽略
        const third = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: followUpLlm('不应出现的第三层') },
        )

        expect(third.followUp).toBeUndefined()
        expect(third.question?.depth).toBe(0)
        // 被强制推进到「下一道未处理的主问题」——不是原主问题本身
        expect(third.question?.content).toContain('这个项目的技术难点')

        // 数据库层面确认没有任何 depth > 2 的题目
        const db = getDb()
        const rows = await db
          .select({ depth: questions.depth })
          .from(questions)
          .where(eq(questions.sessionId, session.id))
        expect(Math.max(...rows.map((row) => row.depth))).toBeLessThanOrEqual(MAX_QUESTION_DEPTH)
      })

      it('follow_up_allowed = false 的题（自我介绍）不追问', async () => {
        const { user, session } = await seedPlannedSession('orch-nofu')
        await startInterview(user.id, session.id)

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: followUpLlm() },
        )

        expect(result.followUp).toBeUndefined()
        expect(result.question?.depth).toBe(0)
      })
    })

    describe('太短与跑题', () => {
      it('回答太短时不调用模型，直接生成 too_short 追问', async () => {
        const { user, session } = await seedPlannedSession('orch-short')
        await startInterview(user.id, session.id)

        // 先答一道允许追问的题
        const first = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: nextQuestionLlm() },
        )
        expect(first.question?.depth).toBe(0)

        // ⚠️ 必须换到一道 follow_up_allowed=true 的题才能触发追问分支：
        // 第 1 题是自我介绍（follow_up_allowed=false），在它上面答多短都不会追问，
        // 服务会直接推进下一题——那测的就不是 too_short 规则了
        expect(first.question?.followUpAllowed).toBe(true)

        const llm = followUpLlm('不应被调用')
        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: '嗯' },
          { llm },
        )

        expect('嗯'.length).toBeLessThan(MIN_ANSWER_LENGTH)
        expect(result.followUp?.reason).toBe('too_short')
        expect(result.message?.type).toBe('follow_up')
        // 太短是确定性结论，无需模型参与
        expect(llm.callCount).toBe(0)
      })

      it('跑题时保留模型给出的 off_topic 原因', async () => {
        const { user, session } = await seedPlannedSession('orch-offtopic')
        await startInterview(user.id, session.id)
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() })

        const llm = FakeLlm.always({
          schema_version: '1.0',
          data: {
            action: 'follow_up',
            follow_up: '我们回到岗位要求：你在 PostgreSQL 上的实践经验是怎样的？',
            reason: 'off_topic',
            focus: '聊到了无关的内容',
          },
        })

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: '我想聊聊我最近看的电影，非常有意思，讲的是一个关于时间旅行的故事。' },
          { llm },
        )

        expect(result.followUp?.reason).toBe('off_topic')
        expect(result.message?.content).toContain('岗位要求')
      })

      it('模型不可用时，太短仍能本地兜底生成追问', async () => {
        const { user, session } = await seedPlannedSession('orch-short-fallback')
        await startInterview(user.id, session.id)
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() })

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: '不知道' },
          { llm: new FakeLlm([{ type: 'error', error: llmUnavailableError() }]) },
        )

        expect(result.followUp?.reason).toBe('too_short')
      })

      it('模型不可用且回答不短时，退回下一题而不阻塞用户', async () => {
        const { user, session } = await seedPlannedSession('orch-llm-down')
        await startInterview(user.id, session.id)
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() })

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'answer', content: LONG_ANSWER },
          { llm: new FakeLlm([{ type: 'error', error: llmUnavailableError() }]) },
        )

        expect(result.followUp).toBeUndefined()
        expect(result.question).not.toBeNull()
      })
    })

    describe('跳过与提示', () => {
      it('跳过不写 answers，但推进到下一题且不会重问', async () => {
        const { user, session } = await seedPlannedSession('orch-skip')
        await startInterview(user.id, session.id)

        const skipped = await submitAnswer(
          user.id,
          session.id,
          { action: 'skip' },
          { llm: nextQuestionLlm() },
        )

        expect(skipped.recorded?.type).toBe('skip')
        expect(skipped.question?.content).toContain('AI 面试平台')

        const db = getDb()
        const answerRows = await db.select().from(answers).where(eq(answers.userId, user.id))
        expect(answerRows).toHaveLength(0)

        // 再取下一题不应回到被跳过的自我介绍
        const again = await getNextQuestion(user.id, session.id)
        expect(again.question?.content).not.toBe('请先做一个自我介绍。')
      })

      it('请求提示返回提示消息，且停留在当前题', async () => {
        const { user, session } = await seedPlannedSession('orch-hint')
        const step = await startInterview(user.id, session.id)
        const currentQuestionId = step.question!.id

        const llm = FakeLlm.always({
          schema_version: '1.0',
          data: { hint: '可以从教育背景、核心技能、岗位匹配度三块组织。' },
        })

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'hint' },
          { llm },
        )

        expect(result.message?.type).toBe('hint')
        expect(result.message?.content).toContain('教育背景')
        expect(result.question?.id).toBe(currentQuestionId)
        // 提示不产生回答
        const db = getDb()
        const answerRows = await db.select().from(answers).where(eq(answers.userId, user.id))
        expect(answerRows).toHaveLength(0)
      })

      it('提示生成失败时给出兜底文案而不是报错', async () => {
        const { user, session } = await seedPlannedSession('orch-hint-fallback')
        await startInterview(user.id, session.id)

        const result = await submitAnswer(
          user.id,
          session.id,
          { action: 'hint' },
          { llm: new FakeLlm([{ type: 'error', error: llmUnavailableError() }]) },
        )

        expect(result.message?.type).toBe('hint')
        expect(result.message!.content.length).toBeGreaterThan(0)
      })
    })

    describe('结束面试与消息持久化', () => {
      it('结束面试置为 FINISHED / completed', async () => {
        const { user, session } = await seedPlannedSession('orch-finish')
        await startInterview(user.id, session.id)

        const result = await finishInterview(user.id, session.id)

        expect(result.phase).toBe('FINISHED')
        expect(result.status).toBe('completed')
        expect(await phaseOf(session.id)).toBe('completed/FINISHED')

        const db = getDb()
        const rows = await db
          .select({ finishedAt: interviewSessions.finishedAt })
          .from(interviewSessions)
          .where(eq(interviewSessions.id, session.id))
        expect(rows[0]!.finishedAt).not.toBeNull()
      })

      it('结束是幂等的（重复调用不报错）', async () => {
        const { user, session } = await seedPlannedSession('orch-finish-idem')
        await startInterview(user.id, session.id)
        await finishInterview(user.id, session.id)

        await expect(finishInterview(user.id, session.id)).resolves.toMatchObject({
          phase: 'FINISHED',
        })
      })

      it('结束后的会话不能再开始', async () => {
        const { user, session } = await seedPlannedSession('orch-finished-restart')
        await startInterview(user.id, session.id)
        await finishInterview(user.id, session.id)

        await expect(startInterview(user.id, session.id)).rejects.toBeInstanceOf(ApiError)
      })

      it('所有消息持久化（AI 提问、用户回答、跳过、系统提示）', async () => {
        const { user, session } = await seedPlannedSession('orch-messages')
        await startInterview(user.id, session.id)
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() })
        await submitAnswer(user.id, session.id, { action: 'skip' }, { llm: nextQuestionLlm() })

        const messages = await listMessages(user.id, session.id)
        const types = messages.map((item) => item.type)

        expect(types).toContain('system') // 面试开始
        expect(types).toContain('question')
        expect(types).toContain('answer')
        expect(types).toContain('skip')

        // AI 与用户角色都要有
        expect(messages.some((item) => item.role === 'ai')).toBe(true)
        expect(messages.some((item) => item.role === 'user')).toBe(true)
      })

      it('追问消息记录了 reason 与 focus', async () => {
        const { user, session } = await seedPlannedSession('orch-fu-message')
        await startInterview(user.id, session.id)
        // 先答掉第 1 题（自我介绍不允许追问），再在允许追问的题上产生追问
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() })
        // ⚠️ 同样必须 ≥5 字符，否则追问会被降级为 next_question、不产生 follow_up 消息
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: followUpLlm('请再具体说明一下') })

        const messages = await listMessages(user.id, session.id)
        const followUp = messages.find((item) => item.type === 'follow_up')

        expect(followUp).toBeDefined()
        expect(followUp!.followUpReason).toBe('vague')
        expect(followUp!.focus).toBe('做过优化')
      })

      it('回答写入 answers 表并关联题目', async () => {
        const { user, session } = await seedPlannedSession('orch-answer-row')
        const step = await startInterview(user.id, session.id)
        await submitAnswer(user.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() })

        const db = getDb()
        const rows = await db.select().from(answers).where(eq(answers.userId, user.id))
        expect(rows).toHaveLength(1)
        expect(rows[0]!.questionId).toBe(step.question!.id)
        expect(rows[0]!.content).toBe(LONG_ANSWER)
      })

      it('全部答完后自动进入 FINISHED', async () => {
        const { user, session } = await seedPlannedSession('orch-autofinish')
        await startInterview(user.id, session.id)

        const db = getDb()
        // 只保留一道主问题，减少循环
        await db
          .delete(questions)
          .where(and(eq(questions.sessionId, session.id), eq(questions.orderIndex, 0)))
        await db
          .delete(interviewMessages)
          .where(eq(interviewMessages.sessionId, session.id))

        let step = await getNextQuestion(user.id, session.id)
        for (let index = 0; index < 12 && !step.finished; index += 1) {
          step = await submitAnswer(
            user.id,
            session.id,
            { action: 'answer', content: LONG_ANSWER },
            { llm: nextQuestionLlm() },
          )
        }

        expect(step.finished).toBe(true)
        expect(await phaseOf(session.id)).toBe('completed/FINISHED')
      })
    })

    describe('重复提交与幂等', () => {
      /**
       * 回归用例：重复提交同一题曾抛出 Postgres 23505
       * （answers_question_unique），被兜底成 **500 服务器内部错误**。
       * 重复提交是常见真实场景（双击提交、超时重试、刷新后重发），
       * 正确行为是幂等返回当前进度，而不是 500。
       */
      it('重复提交同一题不会 500，且只保留一条回答', async () => {
        const { user, session } = await seedPlannedSession('orch-duplicate')
        const started = await startInterview(user.id, session.id)
        const questionId = started.question!.id

        const first = await submitAnswer(
          user.id,
          session.id,
          { questionId, action: 'answer', content: LONG_ANSWER },
          { llm: nextQuestionLlm() },
        )

        // 模拟双击/超时重试：**同一题**再提交一次（questionId 不变）
        const second = await submitAnswer(
          user.id,
          session.id,
          { questionId, action: 'answer', content: LONG_ANSWER },
          { llm: nextQuestionLlm() },
        )

        expect(second.finished).toBe(first.finished)

        const db = getDb()
        const rows = await db.select().from(answers).where(eq(answers.userId, user.id))
        expect(rows).toHaveLength(1)
        expect(rows[0]!.content).toBe(LONG_ANSWER)
      })
    })

    describe('权限隔离', () => {
      it('他人无法开始、提交、获取下一题或结束', async () => {
        const { user, session } = await seedPlannedSession('orch-iso')
        const intruder = await createTestUser('orch-iso-intruder')
        createdUserIds.push(intruder.id)

        await expect(startInterview(intruder.id, session.id)).rejects.toMatchObject({ status: 404 })
        await expect(getNextQuestion(intruder.id, session.id)).rejects.toMatchObject({ status: 404 })
        await expect(finishInterview(intruder.id, session.id)).rejects.toMatchObject({ status: 404 })
        await expect(
          submitAnswer(intruder.id, session.id, { action: 'answer', content: LONG_ANSWER }, { llm: nextQuestionLlm() }),
        ).rejects.toMatchObject({ status: 404 })
        await expect(listMessages(intruder.id, session.id)).rejects.toMatchObject({ status: 404 })

        // 本人不受影响
        await expect(startInterview(user.id, session.id)).resolves.toMatchObject({ finished: false })
      })

      it('不存在的会话返回 404', async () => {
        const user = await createTestUser('orch-missing')
        createdUserIds.push(user.id)
        const missing = '00000000-0000-0000-0000-000000000000'

        await expect(startInterview(user.id, missing)).rejects.toMatchObject({ status: 404 })
      })
    })
  },
)
