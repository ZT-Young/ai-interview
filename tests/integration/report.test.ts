import { afterAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { answers, evaluations, interviewSessions, jobJds, questions, reports, resumes } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import type { PlanQuestion } from '@/lib/ai/schemas/plan'
import { createJobJd, updateParseState as updateJdParseState } from '@/lib/services/handlers/job-jd-service'
import { createResume, updateParseState as updateResumeParseState } from '@/lib/services/handlers/resume-service'
import { createSession } from '@/lib/services/handlers/session-service'
import { generatePlan } from '@/lib/services/handlers/plan-service'
import { startInterview, submitAnswer } from '@/lib/services/handlers/orchestration-service'
import { evaluateAnswer, listEvaluations } from '@/lib/services/handlers/evaluation-service'
import { generateReport, getReportBySession, verifyReportData } from '@/lib/services/handlers/report-service'
import { createOrder, grantEntitlement } from '@/lib/services/handlers/payment-service'
import type { ReportData } from '@/lib/ai/schemas/evaluation'
import { questionScoreOf } from '@/lib/ai/scoring'

import { FakeLlm, llmUnavailableError } from '../helpers/fakes'
import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
} from '../helpers/db'

/**
 * 评分与报告集成测试。
 *
 * 覆盖：评分范围落库、证据引用校验、低分建议、报告聚合与幂等、付费字段裁剪、权限隔离。
 * 需 DATABASE_URL + AUTH_SECRET；缺失时显式跳过。LLM 用 fake。
 */

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

const ANSWER_TEXT =
  '我在 AI 面试平台项目里负责评分服务重构，用两阶段提交保证数据一致性，接口 P95 从 800ms 降到 220ms，覆盖 300 个自动化用例。'

/**
 * 计划夹具。
 *
 * ⚠️ `expected_points` 每条必须 ≥2 项：`planQuestionSchema` 有 `.min(2, '期望要点至少 2 条')`
 * （lib/ai/schemas/plan.ts）。只给 1 项会让计划生成整体失败，
 * 于是所有依赖「已有计划」的用例都会连带失败——失败原因看起来像编排坏了，实际是夹具不合规。
 */
function planQuestions(): PlanQuestion[] {
  return [
    { content: '请先做一个自我介绍。', type: 'self_intro', source: 'generic', dimension: 'communication', expected_points: ['教育背景', '核心技能'], follow_up_allowed: false },
    { content: '请介绍 AI 面试平台这个项目你负责的部分。', type: 'project_dig', source: 'resume', dimension: 'project_depth', expected_points: ['项目背景', '个人职责'], follow_up_allowed: false },
    { content: '请说明 PostgreSQL 索引在什么场景下会失效。', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['失效场景', '验证方法'], follow_up_allowed: false },
    { content: '请讲一次你在有限时间内交付目标的经历。', type: 'behavioral', source: 'resume', dimension: 'motivation', expected_points: ['目标', '取舍'], follow_up_allowed: false },
  ]
}

/** 让计划有 8 题以满足配额校验 */
function planEnvelope(): { schema_version: string; data: { questions: PlanQuestion[] } } {
  const base = planQuestions()
  const questions: PlanQuestion[] = [
    base[0]!,
    base[1]!,
    { ...base[1]!, content: '这个项目的技术难点是什么？' },
    { ...base[1]!, content: '项目里数据一致性如何保证？' },
    base[2]!,
    { ...base[2]!, content: '高并发下你会怎么设计限流？' },
    base[3]!,
    { content: '关于这个岗位，你想了解什么？', type: 'reverse', source: 'generic', dimension: 'motivation', expected_points: ['关注点', '提问质量'], follow_up_allowed: false },
  ]
  // 返回对象而非字符串：FakeLlm.always 会自行 stringify，
  // 传字符串会被二次编码，schema 报「expected object, received string」
  return { schema_version: '1.0', data: { questions } }
}

/** 评分用 fake：证据取自回答原文 */
function evaluationLlm(score = 4, quotes?: Array<{ quote: string; reason: string }>) {
  return FakeLlm.always({
    schema_version: '1.0',
    data: {
      dimension_scores: {
        job_match: score,
        professional: score,
        project_depth: score,
        logic: score,
        communication: score,
        motivation: score,
      },
      evidence_quotes:
        quotes ??
        [
          { quote: '用两阶段提交保证数据一致性', reason: '体现数据一致性方案' },
          { quote: 'P95 从 800ms 降到 220ms', reason: '有量化结果' },
        ],
      feedback: '整体不错，项目深度可再补充技术选型的取舍依据。',
      better_answer: '建议补充为什么选择两阶段提交。',
      reference_answer:
        '我在【待补充：项目名】负责评分服务重构。当时的问题是接口 P95 达到 800ms，' +
        '影响了下游调用方的体验。我的任务是在不牺牲评分准确性的前提下把延迟降下来。' +
        '我做了两件事：一是把串行的模型调用改为并发，二是用两阶段提交保证数据一致性，' +
        '避免并发写入导致评分错乱。最终 P95 从 800ms 降到 220ms，并补了 300 个自动化用例防回归。' +
        '面试前请把上面【】里的内容换成你的真实数据。',
    },
  })
}

function reportLlm(overrides: Partial<ReportData> = {}) {
  return FakeLlm.always({
    schema_version: '1.0',
    data: {
      summary: '整体表现中等，项目描述可补充取舍说明。',
      highlights: ['量化结果清晰'],
      issues: ['下次可以补充技术选型的对比依据'],
      reference_answers: [
        { question: '请介绍 AI 面试平台这个项目你负责的部分。', improvement: '补充优化前后的指标对比' },
      ],
      next_actions: ['补充 1 个可量化的项目结果'],
      resume_risks: ['项目描述无任何量化结果'],
      ...overrides,
    },
  })
}

/** 建一个「已开始面试且有回答」的会话 */
async function seedAnsweredSession(prefix: string) {  const user = await createTestUser(prefix)
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
      skills: ['TypeScript'],
      projects: [{ name: 'AI Interview Platform', role: 'Backend Engineer', actions: [], results: [], evidence: [] }],
      education: [],
      risks: ['项目描述无任何量化结果'],
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

  const planned = await generatePlan(user.id, session.id, { llm: FakeLlm.always(planEnvelope()) })
  if (!planned.ok) throw new Error('夹具失败：计划未生成')

  await startInterview(user.id, session.id)

  // 答第一题
  const answered = await submitAnswer(
    user.id,
    session.id,
    { action: 'answer', content: ANSWER_TEXT },
    { llm: FakeLlm.always({ schema_version: '1.0', data: { action: 'next_question', follow_up: null, reason: 'good_enough', focus: '' } }) },
  )

  const questionId = answered.question?.id
  if (!questionId) throw new Error('夹具失败：没有下一题')

  // 该题是下一道主问题，answer 属于上一题；这里显式取上一题的 id
  const db2 = getDb()
  const answerRows = await db2.select().from(answers).where(eq(answers.userId, user.id)).limit(1)
  const answeredQuestionId = answerRows[0]!.questionId

  return { user, session, answeredQuestionId }
}

describe.skipIf(!hasTestDatabase())(
  `评分与报告集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    describe('逐题评分', () => {
      it('评分落库，单题分由服务端按公式计算', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-ok')

        const result = await evaluateAnswer(user.id, session.id, answeredQuestionId, {
          llm: evaluationLlm(4),
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        // 全 4 分 → (24/30)*100 = 80
        expect(result.evaluation.questionScore).toBe(80)
        expect(questionScoreOf(result.evaluation.dimensionScores)).toBe(80)

        const db = getDb()
        const rows = await db
          .select()
          .from(evaluations)
          .where(eq(evaluations.questionId, answeredQuestionId))
        expect(rows).toHaveLength(1)
        expect(Number(rows[0]!.questionScore)).toBe(80)
      })

      it('每条评分都保存了回答原文证据', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-evidence')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })

        const list = await listEvaluations(user.id, session.id)
        expect(list.length).toBeGreaterThan(0)
        expect(list[0]!.evidenceQuotes.length).toBeGreaterThan(0)

        // 数据库层的证据非空约束
        for (const item of list) {
          expect(item.evidenceQuotes.length).toBeGreaterThanOrEqual(1)
          for (const quote of item.evidenceQuotes) {
            expect(ANSWER_TEXT).toContain(quote.quote)
          }
        }
      })

      it('编造的引用被剔除，且不落库', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-fabricated')

        const result = await evaluateAnswer(user.id, session.id, answeredQuestionId, {
          llm: evaluationLlm(4, [
            { quote: '我用了 Kubernetes 做服务编排', reason: '编造' },
            { quote: '用两阶段提交保证数据一致性', reason: '真实' },
          ]),
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect(result.evaluation.evidenceQuotes).toHaveLength(1)
        expect(result.evaluation.evidenceQuotes[0]!.quote).toBe('用两阶段提交保证数据一致性')
        expect(result.droppedQuotes.some((item) => item.reason.includes('子串'))).toBe(true)
      })

      it('证据全部不匹配原文时判失败并重试', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-all-fake')

        const llm = FakeLlm.always({
          schema_version: '1.0',
          data: {
            dimension_scores: { job_match: 4, professional: 4, project_depth: 4, logic: 4, communication: 4, motivation: 4 },
            evidence_quotes: [{ quote: '完全不存在的一段引用内容', reason: '编造' }],
            feedback: '反馈',
            better_answer: '改进',
            reference_answer: '参考答案',
          },
        })

        const result = await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm })

        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.code).toBe('evaluation_failed')
        // 每次尝试都调用模型
        expect(llm.callCount).toBe(2)

        const db = getDb()
        const rows = await db
          .select()
          .from(evaluations)
          .where(eq(evaluations.questionId, answeredQuestionId))
        expect(rows).toHaveLength(0)
      })

      it('低分且反馈过短时补齐通用可执行建议', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-lowsuggest')

        const result = await evaluateAnswer(user.id, session.id, answeredQuestionId, {
          llm: FakeLlm.always({
            schema_version: '1.0',
            data: {
              dimension_scores: { job_match: 1, professional: 1, project_depth: 1, logic: 1, communication: 1, motivation: 1 },
              evidence_quotes: [{ quote: '用两阶段提交保证数据一致性', reason: '依据' }],
              feedback: '不好',
              better_answer: '补充取舍依据',
              reference_answer: '参考答案内容',
            },
          }),
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.evaluation.feedback).toContain('下一步可补充')
      })

      it('参考答案落库，且与「改进要点」分开保存', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-refanswer')

        const result = await evaluateAnswer(user.id, session.id, answeredQuestionId, {
          llm: evaluationLlm(4),
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return

        const db = getDb()
        const row = (
          await db.select().from(evaluations).where(eq(evaluations.questionId, answeredQuestionId))
        )[0]!

        // 参考答案是独立列：它是「示范怎么答」，不是塞进 feedback 的「改进要点」
        expect(row.referenceAnswer).toBeTruthy()
        expect(row.referenceAnswer).toContain('两阶段提交')
        // 占位符必须保留，供前端高亮提示用户替换为真实数据
        expect(row.referenceAnswer).toContain('【待补充')
        // feedback 里仍保留改进要点，两者语义不同、都要有
        expect(row.feedback).toContain('改进要点')

        // 对外视图也要带上该字段
        expect(result.evaluation.referenceAnswer).toBe(row.referenceAnswer)
      })

      it('模型未产出参考答案时落库为 null，不阻塞评分', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-refempty')

        const result = await evaluateAnswer(user.id, session.id, answeredQuestionId, {
          llm: FakeLlm.always({
            schema_version: '1.0',
            data: {
              dimension_scores: { job_match: 4, professional: 4, project_depth: 4, logic: 4, communication: 4, motivation: 4 },
              evidence_quotes: [{ quote: '用两阶段提交保证数据一致性', reason: '依据' }],
              feedback: '反馈内容够长，可以落库。',
              better_answer: '补充取舍依据',
              reference_answer: '   ',
            },
          }),
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.evaluation.referenceAnswer).toBeNull()
      })

      it('回答为空时拒绝评分（未作答）', async () => {
        const { user, session } = await seedAnsweredSession('eval-noanswer')

        const db = getDb()
        const mains = await db
          .select({ id: questions.id })
          .from(questions)
          .where(and(eq(questions.sessionId, session.id), eq(questions.depth, 0)))

        // 找一道尚未作答的题
        const answerRows = await db.select({ qid: answers.questionId }).from(answers)
        const answeredIds = new Set(answerRows.map((row) => row.qid))
        const target = mains.find((row) => !answeredIds.has(row.id))

        // 夹具必须留有一道未作答的题，否则该用例无意义
        expect(target).toBeDefined()

        await expect(
          evaluateAnswer(user.id, session.id, target!.id, { llm: evaluationLlm() }),
        ).rejects.toMatchObject({ status: 422 })
      })

      it('已评分的题默认拒绝重复评分，regenerate 时替换', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-idem')

        const first = await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })
        expect(first.ok).toBe(true)

        await expect(
          evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) }),
        ).rejects.toMatchObject({ status: 422 })

        const second = await evaluateAnswer(user.id, session.id, answeredQuestionId, {
          llm: evaluationLlm(2),
        }, { regenerate: true })
        expect(second.ok).toBe(true)
        if (second.ok) expect(second.evaluation.questionScore).toBe(40)

        const db = getDb()
        const rows = await db
          .select()
          .from(evaluations)
          .where(eq(evaluations.questionId, answeredQuestionId))
        expect(rows).toHaveLength(1)
        expect(Number(rows[0]!.questionScore)).toBe(40)
      })

      it('LLM 未配置时立即返回 ai_unavailable，且不重试', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('eval-nollm')
        const llm = new FakeLlm([{ type: 'error', error: llmUnavailableError() }])
        const result = await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm })

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.code).toBe('ai_unavailable')
          // 环境级失败不做无意义重试（否则白白消耗额度）
          expect(result.attempts).toBe(1)
        }
        expect(llm.callCount).toBe(1)
      })
    })

    describe('报告生成', () => {
      it('分数由服务端从 evaluations 聚合并落库', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-ok')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })

        const result = await generateReport(user.id, session.id, { llm: reportLlm() })
        expect(result.ok).toBe(true)
        if (!result.ok) return

        // 单题全 4 → 80 分
        expect(result.report.totalScore).toBe(80)
        expect(result.report.dimensionScores.job_match).toBe(4)

        const db = getDb()
        const rows = await db.select().from(reports).where(eq(reports.sessionId, session.id))
        expect(rows).toHaveLength(1)
        expect(Number(rows[0]!.totalScore)).toBe(80)
      })

      it('报告包含 required 四要素与简历疑点', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-fields')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(3) })
        await generateReport(user.id, session.id, { llm: reportLlm() })

        const db = getDb()
        const row = (await db.select().from(reports).where(eq(reports.sessionId, session.id)))[0]!

        expect((row.highlights as string[]).length).toBeGreaterThan(0)
        expect((row.issues as string[]).length).toBeGreaterThan(0)
        expect((row.referenceAnswers as unknown[]).length).toBeGreaterThan(0)
        expect((row.nextSteps as string[]).length).toBeGreaterThan(0)
        expect((row.resumeRisks as string[]).length).toBeGreaterThan(0)
      })

      it('生成报告后编排阶段推进到 REPORTING', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-phase')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })
        await generateReport(user.id, session.id, { llm: reportLlm() })

        const db = getDb()
        const row = (
          await db
            .select({ phase: interviewSessions.phase })
            .from(interviewSessions)
            .where(eq(interviewSessions.id, session.id))
        )[0]!
        expect(row.phase).toBe('REPORTING')
      })

      it('没有逐题评分时拒绝生成报告', async () => {
        const { user, session } = await seedAnsweredSession('report-noeval')
        await expect(
          generateReport(user.id, session.id, { llm: reportLlm() }),
        ).rejects.toMatchObject({ status: 422 })
      })

      it('已有报告时默认拒绝，regenerate 时替换', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-idem')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })
        await generateReport(user.id, session.id, { llm: reportLlm() })

        await expect(
          generateReport(user.id, session.id, { llm: reportLlm() }),
        ).rejects.toMatchObject({ status: 422 })

        const again = await generateReport(user.id, session.id, { llm: reportLlm() }, { regenerate: true })
        expect(again.ok).toBe(true)

        const db = getDb()
        const rows = await db.select().from(reports).where(eq(reports.sessionId, session.id))
        expect(rows).toHaveLength(1)
      })

      it('LLM 未配置时立即返回 ai_unavailable，且不重试', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-nollm')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })

        const llm = new FakeLlm([{ type: 'error', error: llmUnavailableError() }])
        const result = await generateReport(user.id, session.id, { llm })

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.code).toBe('ai_unavailable')
          expect(result.attempts).toBe(1)
        }
        expect(llm.callCount).toBe(1)
      })
    })

    describe('付费字段裁剪', () => {
      it('未解锁时报告响应**不包含**付费内容', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-locked')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })
        await generateReport(user.id, session.id, { llm: reportLlm() })

        const result = await getReportBySession(user.id, session.id)

        expect(result.isUnlocked).toBe(false)
        expect(result.lockedSections).toContain('issues')
        // 关键：付费内容不得出现在返回值里
        expect(result.report.issues).toEqual([])
        expect(result.report.referenceAnswers).toEqual([])
        expect(result.report.nextSteps).toEqual([])
        expect(result.report.resumeRisks).toEqual([])
        // 免费内容仍在
        expect(result.report.totalScore).toBe(80)
        expect(result.report.highlights.length).toBeGreaterThan(0)
      })

      it('解锁后返回完整内容', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-unlocked')
        await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm(4) })
        const generated = await generateReport(user.id, session.id, { llm: reportLlm() })
        if (!generated.ok) throw new Error(`报告生成失败：${generated.code}`)
        const report = generated.report

        // 解锁必须走真实链路：下单 → 支付回调发放权益。
        // 直接改 `reports.is_unlocked` 是**无效**的：hasReportUnlock() 刻意以
        // 已支付订单为权威凭证，不看该字段（见 lib/services/entitlement-service.ts）
        const { order } = await createOrder(user.id, 'report_unlock', { reportId: report.id })
        await grantEntitlement(order.id)

        const result = await getReportBySession(user.id, session.id)
        expect(result.isUnlocked).toBe(true)
        expect(result.lockedSections).toEqual([])
        expect(result.report.issues.length).toBeGreaterThan(0)
        expect(result.report.nextSteps.length).toBeGreaterThan(0)
      })
    })

    describe('报告后置校验', () => {
      it('剔除不在本次面试中的参考回答题目（防虚构题目）', () => {
        const data: ReportData = {
          summary: '总评',
          highlights: ['优势'],
          issues: ['问题'],
          reference_answers: [
            { question: '请介绍一次性能优化经历', improvement: '改进' },
            { question: '完全不存在的一道题', improvement: '改进' },
          ],
          next_actions: ['行动'],
          resume_risks: [],
        }

        const result = verifyReportData(data, {
          questionTexts: ['请介绍一次性能优化经历'],
          resumeRisks: [],
        })

        expect(result.data.reference_answers).toHaveLength(1)
        expect(result.dropped.some((item) => item.includes('题目不在本次面试中'))).toBe(true)
      })

      it('剔除简历解析结果中不存在的疑点（防新增）', () => {
        const data: ReportData = {
          summary: '总评',
          highlights: [],
          issues: [],
          reference_answers: [],
          next_actions: [],
          resume_risks: ['项目描述无任何量化结果', '凭空捏造的一个疑点问题'],
        }

        const result = verifyReportData(data, {
          questionTexts: [],
          resumeRisks: ['项目描述无任何量化结果'],
        })

        expect(result.data.resume_risks).toEqual(['项目描述无任何量化结果'])
        expect(result.dropped.some((item) => item.includes('简历疑点'))).toBe(true)
      })

      it('剔除命中敏感或录用建议的条目', () => {
        const data: ReportData = {
          summary: '总评',
          highlights: ['量化结果清晰', '候选人性格稳定，建议录用'],
          issues: [],
          reference_answers: [],
          next_actions: [],
          resume_risks: [],
        }

        const result = verifyReportData(data, { questionTexts: [], resumeRisks: [] })
        expect(result.data.highlights).toEqual(['量化结果清晰'])
      })
    })

    describe('权限隔离', () => {
      it('他人无法评分、生成报告或读取报告', async () => {
        const { user, session, answeredQuestionId } = await seedAnsweredSession('report-iso')
        const intruder = await createTestUser('report-iso-intruder')
        createdUserIds.push(intruder.id)

        await expect(
          evaluateAnswer(intruder.id, session.id, answeredQuestionId, { llm: evaluationLlm() }),
        ).rejects.toMatchObject({ status: 404 })
        await expect(
          generateReport(intruder.id, session.id, { llm: reportLlm() }),
        ).rejects.toMatchObject({ status: 404 })
        await expect(getReportBySession(intruder.id, session.id)).rejects.toMatchObject({
          status: 404,
        })

        // 本人不受影响
        const ok = await evaluateAnswer(user.id, session.id, answeredQuestionId, { llm: evaluationLlm() })
        expect(ok.ok).toBe(true)
      })

      it('报告未生成时返回 404 语义（not_found）', async () => {
        const { user, session } = await seedAnsweredSession('report-missing')
        await expect(getReportBySession(user.id, session.id)).rejects.toBeInstanceOf(ApiError)
      })
    })
  },
)
