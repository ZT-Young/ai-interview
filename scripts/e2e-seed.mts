/**
 * E2E seed —— 造出 E2E 需要的会话，并把可直接粘贴的变量打印出来。
 *
 * 用法：
 *   pnpm e2e:seed          # 造数据并打印变量
 *   pnpm e2e:seed --write  # 同时写回 .env.local
 *
 * ⚠️ 为什么需要**两种状态**的会话（踩过一次坑，务必保留）：
 * - 面试房间的用例要求会话处于「计划已生成、**尚未开始**」（`planned/IDLE`），
 *   它们会点「开始面试」并驱动状态机前进；
 * - 报告用例要求会话「已完成、已生成报告」。
 * 早期只产出一个「跑完整场面试」的会话给两者共用，结果是面试房间页面直接
 * 报「该会话还没有面试计划」，而 `/next` 试图 `REPORTING → FINISHED`
 * 被状态机拒绝（422）——看起来像功能坏了，实际是 seed 状态用错了。
 *
 * ⚠️ 本脚本用 **fake LLM** 产出计划/评分/报告，因此：
 * - 验证的是**服务与数据库行为**，不消耗真实模型额度；
 * - 造出的内容是固定的，不代表真实模型输出质量。
 */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

const { getDb, closeDb, hasDatabaseUrl } = await import('@/db/client')
const { interviewSessions } = await import('@/db/schema')
const { eq } = await import('drizzle-orm')
const { register } = await import('@/lib/services/handlers/auth-service')
const { createResume, updateParseState: updateResumeParseState } =
  await import('@/lib/services/handlers/resume-service')
const { createJobJd, updateParseState: updateJdParseState } =
  await import('@/lib/services/handlers/job-jd-service')
const { createSession } = await import('@/lib/services/handlers/session-service')
const { generatePlan } = await import('@/lib/services/handlers/plan-service')
const { submitAnswer } = await import('@/lib/services/handlers/orchestration-service')
const { evaluateAnswer } = await import('@/lib/services/handlers/evaluation-service')
const { generateReport } = await import('@/lib/services/handlers/report-service')
const { createOrder, grantEntitlement } = await import('@/lib/services/handlers/payment-service')

const PASSWORD = 'Test-Password-123'
const WRITE_ENV = process.argv.includes('--write')

/** fake LLM：只实现各服务用到的 `complete`，返回预设结构化输出 */
function fakeLlm(data: unknown) {
  return {
    async complete() {
      return {
        content: JSON.stringify({ schema_version: '1.0', data }),
        model: 'e2e-seed-fake',
      }
    },
  }
}

const PLAN_QUESTIONS = [
  { content: '请先做一个自我介绍。', type: 'self_intro', source: 'generic', dimension: 'communication', expected_points: ['教育背景', '核心技能'], follow_up_allowed: false },
  { content: '请介绍 AI 面试平台这个项目你负责的部分。', type: 'project_dig', source: 'resume', dimension: 'project_depth', expected_points: ['项目背景', '个人职责'], follow_up_allowed: true },
  { content: '这个项目的技术难点是什么，你怎么权衡的？', type: 'project_dig', source: 'both', dimension: 'project_depth', expected_points: ['难点描述', '权衡依据'], follow_up_allowed: true },
  { content: '项目里数据一致性是如何保证的？', type: 'project_dig', source: 'resume', dimension: 'professional', expected_points: ['一致性方案', '故障处理'], follow_up_allowed: true },
  { content: '请说明 PostgreSQL 索引在什么场景下会失效。', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['失效场景', '验证方法'], follow_up_allowed: true },
  { content: '高并发下你会怎么设计限流方案？', type: 'technical', source: 'jd', dimension: 'professional', expected_points: ['限流算法', '降级策略'], follow_up_allowed: true },
  { content: '请讲一次你在有限时间内交付目标的经历。', type: 'behavioral', source: 'resume', dimension: 'motivation', expected_points: ['目标', '取舍', '结果'], follow_up_allowed: true },
  { content: '关于这个岗位，你想了解什么？', type: 'reverse', source: 'generic', dimension: 'motivation', expected_points: ['关注点', '提问质量'], follow_up_allowed: false },
]

const ANSWER =
  '我在 AI 面试平台项目里负责评分服务重构，用两阶段提交保证数据一致性，接口 P95 从 800ms 降到 220ms，覆盖 300 个自动化用例。'

const EVALUATION = {
  dimension_scores: {
    job_match: 4,
    professional: 4,
    project_depth: 4,
    logic: 4,
    communication: 4,
    motivation: 4,
  },
  evidence_quotes: [
    { quote: '用两阶段提交保证数据一致性', reason: '体现数据一致性方案' },
    { quote: 'P95 从 800ms 降到 220ms', reason: '有量化结果' },
  ],
  feedback: '整体不错，项目深度可再补充技术选型的取舍依据。',
  better_answer: '建议补充为什么选择两阶段提交，以及对比过哪些替代方案。',
}

const REPORT = {
  summary: '整体表现中等偏上，项目描述可补充技术选型的取舍说明。',
  highlights: ['量化结果清晰', '技术方案表述结构化'],
  issues: ['下次可以补充技术选型的对比依据'],
  reference_answers: [
    {
      question: '请介绍 AI 面试平台这个项目你负责的部分。',
      improvement: '补充优化前后的指标对比，以及为什么选这个方案',
    },
  ],
  next_actions: ['补充 1 个可量化的项目结果', '为每个技术选型准备 1 条替代方案对比'],
  resume_risks: ['项目描述无任何量化结果'],
}

const NEXT_QUESTION = {
  action: 'next_question',
  follow_up: null,
  reason: 'good_enough',
  focus: '',
}

/** 建一个「已解析简历 + 已解析 JD + 匹配分析 + 8 题计划」的会话（状态 draft→planned） */
async function seedPlannedSession(userId: string) {
  const resume = await createResume(userId, {
    fileName: 'resume.pdf',
    fileType: 'pdf',
    fileSize: 1024,
    storageKey: `resumes/${userId}/resume.pdf`,
  })
  await updateResumeParseState(userId, resume.id, {
    parseStatus: 'success',
    parsedData: {
      name: 'Zhang Wei',
      years: 3,
      skills: ['TypeScript', 'PostgreSQL', 'Node.js'],
      projects: [
        {
          name: 'AI Interview Platform',
          role: 'Backend Engineer',
          actions: ['重构评分服务'],
          results: ['P95 从 800ms 降到 220ms'],
          evidence: ['覆盖 300 个自动化用例'],
        },
      ],
      education: [],
      risks: ['项目描述无任何量化结果'],
    },
  })

  const jobJd = await createJobJd(userId, {
    rawText:
      'Responsibilities: build backend services using TypeScript. Requirements: 3+ years Node.js, PostgreSQL.',
  })
  await updateJdParseState(userId, jobJd.id, {
    parseStatus: 'success',
    parsedData: {
      title: 'AI Backend Engineer',
      company: 'Example Tech',
      must_have: ['3+ years Node.js', '熟悉 PostgreSQL'],
      nice_to_have: ['有 AI 产品经验'],
      responsibilities: ['build backend services', '优化接口性能'],
      keywords: ['TypeScript', 'PostgreSQL'],
    },
  })

  const session = await createSession(userId, { resumeId: resume.id, jobJdId: jobJd.id })

  const db = getDb()
  await db
    .update(interviewSessions)
    .set({
      matchAnalysis: {
        match_score: 72,
        advantages: [{ point: '技术栈匹配', evidence: 'TypeScript / PostgreSQL' }],
        gaps: ['简历中未提及分布式系统经验'],
        suggested_questions: [{ question: '请介绍一次性能优化经历', based_on: 'advantage' }],
      },
    })
    .where(eq(interviewSessions.id, session.id))

  const planned = await generatePlan(userId, session.id, {
    llm: fakeLlm({ questions: PLAN_QUESTIONS }) as never,
  })
  if (!planned.ok) throw new Error(`计划生成失败：${JSON.stringify(planned)}`)

  return { sessionId: session.id, total: planned.total }
}

async function currentQuestionId(sessionId: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({ current: interviewSessions.currentQuestionId })
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sessionId))
    .limit(1)
  return rows[0]?.current ?? null
}

/** 把会话跑完整场面试并生成报告（面试房间用例**不能**用这个会话） */
async function completeInterview(userId: string, sessionId: string): Promise<string> {
  const { startInterview } = await import('@/lib/services/handlers/orchestration-service')
  await startInterview(userId, sessionId)

  for (let i = 0; i < PLAN_QUESTIONS.length; i += 1) {
    const current = await currentQuestionId(sessionId)
    if (!current) break

    // 必须先提交回答再评分：evaluateAnswer 要求该题已有 answers 行
    const step = await submitAnswer(
      userId,
      sessionId,
      { action: 'answer', content: ANSWER },
      { llm: fakeLlm(NEXT_QUESTION) as never },
    )

    const evaluated = await evaluateAnswer(userId, sessionId, current, {
      llm: fakeLlm(EVALUATION) as never,
    })
    if (!evaluated.ok) throw new Error(`第 ${i + 1} 题评分失败：${JSON.stringify(evaluated)}`)

    if (step.finished) break
  }

  const report = await generateReport(userId, sessionId, { llm: fakeLlm(REPORT) as never })
  if (!report.ok) throw new Error(`报告生成失败：${JSON.stringify(report)}`)

  return report.report.id
}

async function writeEnvLocal(lines: string[]): Promise<void> {
  const path = '.env.local'
  let content = ''
  try {
    content = await readFile(path, 'utf8')
  } catch {
    content = ''
  }

  // 覆盖同名变量的旧值，避免残留过期 sessionId 导致 E2E 假失败
  for (const line of lines) {
    const key = line.split('=')[0]!
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`
  }

  await writeFile(path, content, 'utf8')
  console.log(`[e2e:seed] 已写回 ${path}`)
}

async function main() {
  if (!hasDatabaseUrl()) {
    console.error('[e2e:seed] 缺少 DATABASE_URL，请先配置 .env.local（可用 pnpm local:db 起本地库）')
    process.exit(1)
  }

  const email = `e2e-seed-${randomUUID().slice(0, 8)}@example.test`
  const { user } = await register({ email, password: PASSWORD, acceptTerms: true })
  console.log(`[e2e:seed] 用户 ${email} (${user.id})`)

  // ① 面试房间用：计划已生成、尚未开始（planned/IDLE）
  const interview = await seedPlannedSession(user.id)
  console.log(`[e2e:seed] 面试房间会话 ${interview.sessionId}（${interview.total} 题，planned/IDLE）`)

  // ② 报告/历史/会员用：跑完整场并生成 + 解锁报告
  const reportSession = await seedPlannedSession(user.id)
  const reportId = await completeInterview(user.id, reportSession.sessionId)
  const { order } = await createOrder(user.id, 'report_unlock', { reportId })
  await grantEntitlement(order.id)
  console.log(`[e2e:seed] 报告会话 ${reportSession.sessionId}（已生成并解锁）`)

  // ③ 补足免费次数：生成报告会消耗 1 次额度，「再次训练」需要能成功创建新会话。
  //    不补的话 seed 账号额度为 0，历史页的「再次训练」用例必然失败。
  const pkg = await createOrder(user.id, 'package_10')
  await grantEntitlement(pkg.order.id)
  console.log('[e2e:seed] 已为测试账号补充 10 次面试额度')

  const vars = [
    `E2E_INTERVIEW_SEED="${email}:${PASSWORD}:${interview.sessionId}"`,
    `E2E_REPORT_SEED="${email}:${PASSWORD}:${reportSession.sessionId}"`,
  ]

  console.log('')
  console.log('[e2e:seed] 把以下两行写入 .env.local（或直接 `pnpm e2e:seed --write`）：')
  for (const line of vars) console.log(line)
  console.log('')

  if (WRITE_ENV) await writeEnvLocal(vars)

  await closeDb()
}

main().catch(async (error) => {
  console.error('[e2e:seed] 失败：', error)
  await closeDb().catch(() => {})
  process.exit(1)
})
