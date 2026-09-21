import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { interviewSessions, jobJds, questions, resumes } from '@/db/schema'
import { ApiError } from '@/lib/api/errors'
import { createJobJd, updateParseState as updateJdParseState } from '@/lib/services/job-jd-service'
import { createResume, updateParseState as updateResumeParseState } from '@/lib/services/resume-service'
import { createSession } from '@/lib/services/session-service'
import { generatePlan, getSessionPlan } from '@/lib/services/plan-service'
import { matchResumeToJd } from '@/lib/services/match-service'
import type { PlanQuestion } from '@/lib/ai/schemas/plan'

import { FakeLlm, llmUnavailableError } from '../helpers/fakes'
import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
} from '../helpers/db'

/**
 * 面试计划生成集成测试：验证「生成 → 落库 → 读回」与配额校验。
 *
 * 需要 DATABASE_URL + AUTH_SECRET；缺失时显式跳过。
 * LLM 用 fake，因此这些断言验证的是**服务与数据库行为**，不消耗真实额度。
 */

const createdUserIds: string[] = []

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

function buildQuestions(count = 12): PlanQuestion[] {
  const pool: PlanQuestion[] = [
    { content: '请先做一个自我介绍。', type: 'self_intro', source: 'generic', dimension: 'communication', expected_points: ['教育背景', '核心技能'], follow_up_allowed: false },
    { content: '请介绍 AI 面试平台这个项目你负责的部分。', type: 'project_dig', source: 'resume', dimension: 'project_depth', expected_points: ['项目背景', '个人职责'], follow_up_allowed: true },
    { content: '这个项目的技术难点是什么，你怎么权衡的？', type: 'project_dig', source: 'both', dimension: 'project_depth', expected_points: ['难点描述', '权衡依据'], follow_up_allowed: true },
    { content: '项目里数据一致性是如何保证的？', type: 'project_dig', source: 'resume', dimension: 'professional', expected_points: ['一致性方案', '故障处理'], follow_up_allowed: true },
    { content: '你在这个项目中的角色和协作方式是怎样的？', type: 'project_dig', source: 'resume', dimension: 'communication', expected_points: ['角色定位', '协作机制'], follow_up_allowed: true },
    { content: '请说明 PostgreSQL 索引在什么场景下会失效。', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['失效场景', '验证方法'], follow_up_allowed: true },
    { content: 'TypeScript 的泛型约束你通常怎么设计？', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['约束设计', '实际用例'], follow_up_allowed: true },
    { content: '高并发下你会怎么设计限流方案？', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['限流算法', '降级策略'], follow_up_allowed: true },
    { content: '分布式系统里你如何处理幂等？', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['幂等键设计', '重试边界'], follow_up_allowed: true },
    { content: '请讲一次你和同事意见不一致的经历，你怎么处理的？', type: 'behavioral', source: 'both', dimension: 'communication', expected_points: ['背景', '行动', '结果'], follow_up_allowed: true },
    { content: '请讲一次你在有限时间内交付目标的经历。', type: 'behavioral', source: 'resume', dimension: 'motivation', expected_points: ['目标', '取舍', '结果'], follow_up_allowed: true },
    { content: '关于这个岗位，你想了解什么？', type: 'reverse', source: 'generic', dimension: 'motivation', expected_points: ['关注点', '提问质量'], follow_up_allowed: false },
  ]
  return pool.slice(0, count)
}

/**
 * 与生产一致的信封对象。
 *
 * ⚠️ 返回**对象**而不是 JSON 字符串：`FakeLlm.always(json)` 会自行 `JSON.stringify`，
 * 传字符串会被二次编码，schema 报 `Invalid input: expected object, received string`。
 * 需要「原始字符串」的场景（`FakeLlm` 的 `content` step）自行 `JSON.stringify`。
 */
function envelopeOf(questionList: PlanQuestion[]): {
  schema_version: string
  data: { questions: PlanQuestion[] }
} {
  return {
    schema_version: '1.0',
    data: { questions: questionList },
  }
}

/** 建造一套「已完成解析 + 已有匹配分析」的会话 */
async function seedSession(prefix: string) {
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
      must_have: ['3+ years Node.js'],
      nice_to_have: [],
      responsibilities: ['build backend services'],
      keywords: ['TypeScript'],
    },
  })

  const session = await createSession(user.id, { resumeId: resume.id, jobJdId: jobJd.id })

  // 匹配分析由 Phase 2 的匹配接口产出；此处直接写入以聚焦计划生成
  const db = getDb()
  await db
    .update(interviewSessions)
    .set({
      matchAnalysis: {
        match_score: 72,
        advantages: [{ point: '技术栈匹配', evidence: 'TypeScript' }],
        gaps: ['简历中未提及分布式系统经验'],
        suggested_questions: [{ question: '请介绍一次性能优化经历', based_on: 'advantage' }],
      },
    })
    .where(eq(interviewSessions.id, session.id))

  return { user, session, resume, jobJd }
}

const PAGE_PORTS = (llm: FakeLlm) => ({ llm })

/* ------------------------------------------------------------------ *
 * 测试
 * ------------------------------------------------------------------ */

describe.skipIf(!hasTestDatabase())(
  `面试计划生成集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    it('生成 12 道题并落库，题量在 8-12 之间', async () => {
      const { user, session } = await seedSession('plan-ok')
      const llm = FakeLlm.always(envelopeOf(buildQuestions(12)))

      const result = await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.total).toBe(12)
        expect(result.total).toBeGreaterThanOrEqual(8)
        expect(result.total).toBeLessThanOrEqual(12)
        expect(result.quota).toEqual({
          self_intro: 1,
          project_dig: 4,
          technical: 4,
          behavioral: 2,
          reverse: 1,
        })
      }
    })

    it('五类题型全部落库且 order_index 连续', async () => {
      const { user, session } = await seedSession('plan-types')
      const llm = FakeLlm.always(envelopeOf(buildQuestions(12)))
      await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      const plan = await getSessionPlan(user.id, session.id)
      const types = new Set(plan.questions.map((item) => item.type))

      expect([...types].sort()).toEqual(
        ['behavioral', 'project_dig', 'reverse', 'self_intro', 'technical'].sort(),
      )
      expect(plan.questions.map((item) => item.orderIndex)).toEqual(
        plan.questions.map((_, index) => index),
      )
    })

    it('每题六个字段完整落库（含 dimension / expected_points / follow_up_allowed）', async () => {
      const { user, session } = await seedSession('plan-fields')
      const llm = FakeLlm.always(envelopeOf(buildQuestions(12)))
      await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      const plan = await getSessionPlan(user.id, session.id)
      const selfIntro = plan.questions.find((item) => item.type === 'self_intro')!

      // 1 问题文本 2 类型 3 来源 4 考察维度 5 期望要点 6 是否可追问
      expect(selfIntro.content.length).toBeGreaterThan(0)
      expect(selfIntro.type).toBe('self_intro')
      expect(selfIntro.source).toBe('generic')
      expect(selfIntro.dimension).toBe('communication')
      expect(selfIntro.expectedPoints).toEqual(['教育背景', '核心技能'])
      expect(selfIntro.followUpAllowed).toBe(false)

      // 主问题：depth 0 且无父级
      expect(plan.questions.every((item) => item.depth === 0)).toBe(true)
    })

    it('会话状态从 draft 迁移到 planned，并写入 plan 摘要', async () => {
      const { user, session } = await seedSession('plan-status')
      const llm = FakeLlm.always(envelopeOf(buildQuestions(12)))
      await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      const plan = await getSessionPlan(user.id, session.id)
      expect(plan.status).toBe('planned')

      const summary = plan.plan as { total: number; prompt_version: string; model: string }
      expect(summary.total).toBe(12)
      expect(summary.prompt_version).toBe('1.0')
      expect(summary.model).toBe('fake-model')
    })

    it('已有计划时默认拒绝（防误删用户已答题）', async () => {
      const { user, session } = await seedSession('plan-guard')
      const llm = FakeLlm.always(envelopeOf(buildQuestions(12)))
      await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      await expect(generatePlan(user.id, session.id, PAGE_PORTS(llm))).rejects.toBeInstanceOf(ApiError)
      await expect(generatePlan(user.id, session.id, PAGE_PORTS(llm))).rejects.toMatchObject({
        status: 422,
      })
    })

    it('显式 regenerate 时替换旧题，不产生重复行', async () => {
      const { user, session } = await seedSession('plan-regen')
      await generatePlan(user.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12)))))

      // 8 题同样满足配额：1 self_intro + 3 project_dig + 2 technical + 1 behavioral + 1 reverse
      const pool = buildQuestions(12)
      const custom: PlanQuestion[] = [
        pool[0]!,
        pool[1]!,
        pool[2]!,
        pool[3]!,
        pool[5]!,
        pool[6]!,
        pool[10]!,
        pool[11]!,
      ]

      const result = await generatePlan(
        user.id,
        session.id,
        PAGE_PORTS(FakeLlm.always(envelopeOf(custom))),
        { regenerate: true },
      )

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.total).toBe(8)

      // 旧题被替换而非追加
      const plan = await getSessionPlan(user.id, session.id)
      expect(plan.total).toBe(8)
    })

    it('生成失败（模型输出不合配额）时重试，最终判定失败且不落库', async () => {
      const { user, session } = await seedSession('plan-invalid')
      // 两次都只返回 7 题（低于下限）
      const llm = FakeLlm.always(envelopeOf(buildQuestions(7)))

      const result = await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('plan_generation_failed')
        expect(result.attempts).toBe(2)
        expect(result.error.userMessage).toContain('生成面试计划失败')
      }
      expect(llm.callCount).toBe(2)

      // 数据库不应有任何题目，会话状态也不应变化
      const plan = await getSessionPlan(user.id, session.id)
      expect(plan.total).toBe(0)
      expect(plan.status).toBe('draft')
    })

    it('第一次不合规、第二次合规时成功（降温重试）', async () => {
      const { user, session } = await seedSession('plan-retry')
      const llm = new FakeLlm([
        { type: 'content', content: JSON.stringify(envelopeOf(buildQuestions(7))) },
        { type: 'content', content: JSON.stringify(envelopeOf(buildQuestions(12))) },
      ])

      const result = await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.attempts).toBe(2)
        expect(result.total).toBe(12)
      }
      expect(llm.requests[1]!.temperature).toBe(0.2)
    })

    it('LLM 不可用时返回 ai_unavailable，不写库', async () => {
      const { user, session } = await seedSession('plan-noenv')
      const llm = new FakeLlm([{ type: 'error', error: llmUnavailableError() }])

      const result = await generatePlan(user.id, session.id, PAGE_PORTS(llm))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('ai_unavailable')
        expect(result.attempts).toBe(1)
      }

      const plan = await getSessionPlan(user.id, session.id)
      expect(plan.total).toBe(0)
    })

    it('简历未解析成功时拒绝生成', async () => {
      const { user, session, resume } = await seedSession('plan-unparsed')
      const db = getDb()
      await db
        .update(resumes)
        .set({ parseStatus: 'failed', parsedData: null })
        .where(and(eq(resumes.id, resume.id), isNull(resumes.deletedAt)))

      await expect(
        generatePlan(user.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12))))),
      ).rejects.toMatchObject({ status: 422 })
    })

    it('JD 未解析成功时拒绝生成', async () => {
      const { user, session, jobJd } = await seedSession('plan-unparsed-jd')
      const db = getDb()
      await db
        .update(jobJds)
        .set({ parseStatus: 'failed', parsedData: null })
        .where(and(eq(jobJds.id, jobJd.id), isNull(jobJds.deletedAt)))

      await expect(
        generatePlan(user.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12))))),
      ).rejects.toMatchObject({ status: 422 })
    })

    it('缺少匹配分析时拒绝生成', async () => {
      const { user, session } = await seedSession('plan-nomatch')
      const db = getDb()
      await db
        .update(interviewSessions)
        .set({ matchAnalysis: null })
        .where(eq(interviewSessions.id, session.id))

      await expect(
        generatePlan(user.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12))))),
      ).rejects.toMatchObject({ status: 422 })
    })

    it('权限隔离：他人无法生成或读取该会话的计划', async () => {
      const { user, session } = await seedSession('plan-isolation')
      const intruder = await createTestUser('plan-intruder')
      createdUserIds.push(intruder.id)

      await generatePlan(user.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12)))))

      // 他人读取
      await expect(getSessionPlan(intruder.id, session.id)).rejects.toMatchObject({
        code: 'not_found',
        status: 404,
      })
      // 他人生成
      await expect(
        generatePlan(intruder.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12))))),
      ).rejects.toMatchObject({ status: 404 })

      // 本人仍可正常读取
      await expect(getSessionPlan(user.id, session.id)).resolves.toMatchObject({ total: 12 })
    })

    it('落库的题目确实关联到该会话', async () => {
      const { user, session } = await seedSession('plan-link')
      await generatePlan(user.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12)))))

      const db = getDb()
      const rows = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.sessionId, session.id))

      expect(rows).toHaveLength(12)
    })

    it('匹配分析 → 出题链路：match_analysis 可写入并被计划生成消费', async () => {
      const { user, session, resume, jobJd } = await seedSession('plan-e2e')

      // 1) 清除种子里的匹配分析，模拟「还没做匹配」
      const db = getDb()
      await db
        .update(interviewSessions)
        .set({ matchAnalysis: null })
        .where(eq(interviewSessions.id, session.id))

      const resumeRow = (await db.select().from(resumes).where(eq(resumes.id, resume.id)).limit(1))[0]!
      const jdRow = (await db.select().from(jobJds).where(eq(jobJds.id, jobJd.id)).limit(1))[0]!

      // 2) 此时出题应被拒绝
      await expect(
        generatePlan(user.id, session.id, PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12))))),
      ).rejects.toMatchObject({ status: 422 })

      // 3) 生成匹配分析（与 /api/sessions/:id/match 走同一个服务）
      const matched = await matchResumeToJd(
        { llm: FakeLlm.always({
          schema_version: '1.0',
          data: {
            match_score: 68,
            advantages: [{ point: 'TypeScript 经验匹配', evidence: 'built the scoring service' }],
            gaps: ['简历中未提及分布式系统经验'],
            suggested_questions: [{ question: '请介绍一次性能优化经历', based_on: 'advantage' }],
          },
        }) },
        {
          jd: jdRow.parsedData as never,
          resume: resumeRow.parsedData as never,
        },
      )
      expect(matched.ok).toBe(true)
      if (matched.ok) {
        await db
          .update(interviewSessions)
          .set({ matchAnalysis: matched.data })
          .where(eq(interviewSessions.id, session.id))
      }

      // 4) 现在出题成功
      const result = await generatePlan(
        user.id,
        session.id,
        PAGE_PORTS(FakeLlm.always(envelopeOf(buildQuestions(12)))),
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.total).toBe(12)
    })
  },
)
