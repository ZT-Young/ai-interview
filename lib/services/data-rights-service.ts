import { asc, eq, inArray } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  answers,
  auditLogs,
  consents,
  evaluations,
  interviewMessages,
  interviewSessions,
  jobJds,
  payments,
  questions,
  reports,
  resumes,
  users,
} from '@/db/schema'
import { notFound } from '@/lib/api/errors'
import { LEGAL_VERSION, listLegalDocuments } from '@/lib/legal/documents'
import { logger } from '@/lib/observability/logger'
import { S3Storage, type StoragePort } from '@/lib/storage/s3'

import { deleteAccount } from './auth-service'

/**
 * 数据权利服务（AGENTS.md §7 C3：用户可导出、可删除）。
 *
 * **导出内容边界**：
 * - 只导出**该用户自己的**数据
 * - **绝不包含** `password_hash`、会话令牌哈希等凭据类字段
 * - 包含：账号资料、简历（含解析结果）、岗位、面试会话/题目/回答/评分/报告、订单、同意记录
 */

const EXPORT_VERSION = '1.0'

export interface DataExport {
  exportVersion: string
  exportedAt: string
  /** 导出时适用的法律文本版本 */
  legalVersion: string
  legalDocuments: Array<{ type: string; title: string; version: string }>
  account: {
    id: string
    email: string
    name: string | null
    membership: string
    freeCredits: number
    emailVerified: boolean
    createdAt: string
    termsAcceptedAt: string | null
  }
  consents: Array<{ type: string; version: string; acceptedAt: string }>
  resumes: Array<{
    id: string
    fileName: string
    fileType: string
    fileSize: number
    parseStatus: string
    rawText: string | null
    parsedData: unknown
    createdAt: string
  }>
  jobJds: Array<{
    id: string
    title: string | null
    company: string | null
    rawText: string
    parsedData: unknown
    createdAt: string
  }>
  sessions: Array<{
    id: string
    status: string
    phase: string
    config: unknown
    matchAnalysis: unknown
    createdAt: string
    questions: Array<{
      id: string
      orderIndex: number
      depth: number
      type: string
      source: string
      dimension: string
      content: string
      expectedPoints: unknown
      answer: { content: string; durationMs: number | null; createdAt: string } | null
      evaluation: {
        questionScore: number
        dimensionScores: unknown
        feedback: string
        evidenceQuotes: unknown
      } | null
    }>
    messages: Array<{ role: string; type: string; content: string; createdAt: string }>
    report: {
      totalScore: number
      dimensionScores: unknown
      highlights: unknown
      issues: unknown
      referenceAnswers: unknown
      nextSteps: unknown
      resumeRisks: unknown
      summary: string | null
      createdAt: string
    } | null
  }>
  payments: Array<{
    id: string
    unlockType: string
    amountCents: number
    currency: string
    status: string
    creditsGranted: number
    createdAt: string
    paidAt: string | null
  }>
}

export async function exportUserData(userId: string): Promise<DataExport> {
  const db = getDb()

  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const user = userRows[0]
  if (!user) throw notFound('用户不存在')

  const [consentRows, resumeRows, jdRows, sessionRows, paymentRows] = await Promise.all([
    db.select().from(consents).where(eq(consents.userId, userId)),
    db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(asc(resumes.createdAt)),
    db.select().from(jobJds).where(eq(jobJds.userId, userId)).orderBy(asc(jobJds.createdAt)),
    db
      .select()
      .from(interviewSessions)
      .where(eq(interviewSessions.userId, userId))
      .orderBy(asc(interviewSessions.createdAt)),
    db.select().from(payments).where(eq(payments.userId, userId)).orderBy(asc(payments.createdAt)),
  ])

  const sessionIds = sessionRows.map((row) => row.id)

  const questionRows = sessionIds.length
    ? await db
        .select()
        .from(questions)
        .where(inArray(questions.sessionId, sessionIds))
        .orderBy(asc(questions.orderIndex))
    : []

  const answerRows = sessionIds.length
    ? await db.select().from(answers).where(eq(answers.userId, userId))
    : []

  const evaluationRows = sessionIds.length
    ? await db.select().from(evaluations).where(inArray(evaluations.sessionId, sessionIds))
    : []

  const messageRows = sessionIds.length
    ? await db
        .select()
        .from(interviewMessages)
        .where(inArray(interviewMessages.sessionId, sessionIds))
        .orderBy(asc(interviewMessages.createdAt))
    : []

  const reportRows = sessionIds.length
    ? await db.select().from(reports).where(inArray(reports.sessionId, sessionIds))
    : []

  const answersByQuestion = new Map(answerRows.map((row) => [row.questionId, row]))
  const evaluationByQuestion = new Map(evaluationRows.map((row) => [row.questionId, row]))
  const reportBySession = new Map(reportRows.map((row) => [row.sessionId, row]))

  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    legalVersion: LEGAL_VERSION,
    legalDocuments: listLegalDocuments().map((doc) => ({
      type: doc.type,
      title: doc.title,
      version: doc.version,
    })),

    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      membership: user.membership,
      freeCredits: user.freeCredits,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      termsAcceptedAt: user.termsAcceptedAt ? user.termsAcceptedAt.toISOString() : null,
    },

    consents: consentRows.map((row) => ({
      type: row.consentType,
      version: row.version,
      acceptedAt: row.acceptedAt.toISOString(),
    })),

    resumes: resumeRows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSize: row.fileSize,
      parseStatus: row.parseStatus,
      rawText: row.rawText,
      parsedData: row.parsedData,
      createdAt: row.createdAt.toISOString(),
    })),

    jobJds: jdRows.map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company,
      rawText: row.rawText,
      parsedData: row.parsedData,
      createdAt: row.createdAt.toISOString(),
    })),

    sessions: sessionRows.map((session) => {
      const report = reportBySession.get(session.id)
      return {
        id: session.id,
        status: session.status,
        phase: session.phase,
        config: session.config,
        matchAnalysis: session.matchAnalysis,
        createdAt: session.createdAt.toISOString(),
        questions: questionRows
          .filter((row) => row.sessionId === session.id)
          .map((row) => {
            const answer = answersByQuestion.get(row.id)
            const evaluation = evaluationByQuestion.get(row.id)
            return {
              id: row.id,
              orderIndex: row.orderIndex,
              depth: row.depth,
              type: row.type,
              source: row.source,
              dimension: row.dimension,
              content: row.content,
              expectedPoints: row.expectedPoints,
              answer: answer
                ? {
                    content: answer.content,
                    durationMs: answer.durationMs,
                    createdAt: answer.createdAt.toISOString(),
                  }
                : null,
              evaluation: evaluation
                ? {
                    questionScore: Number(evaluation.questionScore),
                    dimensionScores: evaluation.dimensionScores,
                    feedback: evaluation.feedback,
                    evidenceQuotes: evaluation.evidenceQuotes,
                  }
                : null,
            }
          }),
        messages: messageRows
          .filter((row) => row.sessionId === session.id)
          .map((row) => ({
            role: row.role,
            type: row.type,
            content: row.content,
            createdAt: row.createdAt.toISOString(),
          })),
        report: report
          ? {
              totalScore: Number(report.totalScore),
              dimensionScores: report.dimensionScores,
              highlights: report.highlights,
              issues: report.issues,
              referenceAnswers: report.referenceAnswers,
              nextSteps: report.nextSteps,
              resumeRisks: report.resumeRisks,
              summary: report.summary,
              createdAt: report.createdAt.toISOString(),
            }
          : null,
      }
    }),

    payments: paymentRows.map((row) => ({
      id: row.id,
      unlockType: row.unlockType,
      amountCents: row.amountCents,
      currency: row.currency,
      status: row.status,
      creditsGranted: row.creditsGranted,
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    })),
  }
}

/* ------------------------------------------------------------------ *
 * 删除账号
 * ------------------------------------------------------------------ */

export interface DeleteAccountResult {
  deleted: boolean
  /** 已成功清理的对象存储 key 数量 */
  storageObjectsRemoved: number
  /** 清理失败的数量（不阻断删除，交由清理任务重试） */
  storageFailures: number
}

/**
 * 用户主动删除账号（AGENTS.md §7 C3）。
 *
 * 顺序（重要）：
 * 1. 先软删除账号并吊销全部会话 → **立即不可访问**（用户能感知的重点）
 * 2. 再清理对象存储中的简历原件
 * 3. 对象存储清理失败**不回滚**软删除 —— 用户意图已生效；
 *    残留对象记日志由后续清理任务处理（宁可晚删，不可删除失败）
 */
export async function deleteUserAccount(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  storage: StoragePort = new S3Storage(),
): Promise<DeleteAccountResult> {
  const db = getDb()

  const resumeRows = await db
    .select({ storageKey: resumes.storageKey })
    .from(resumes)
    .where(eq(resumes.userId, userId))

  // ① 软删除 + 吊销会话（内部写审计日志）
  await deleteAccount(userId, meta)

  // ② 清理对象存储
  let removed = 0
  let failures = 0

  for (const row of resumeRows) {
    try {
      await storage.deleteObject(row.storageKey)
      removed += 1
    } catch (error) {
      failures += 1
      logger.warn({
        event: 'data_rights.storage_delete_failed',
        // 不记录 storageKey 本身（含用户 ID，属可识别信息）
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info({
    event: 'data_rights.account_deleted',
    storageObjectsRemoved: removed,
    storageFailures: failures,
  })

  return { deleted: true, storageObjectsRemoved: removed, storageFailures: failures }
}

/** 审计：数据导出（数据权利行使记录，AGENTS.md §7 C6） */
export async function auditDataExport(userId: string): Promise<void> {
  const db = getDb()
  await db.insert(auditLogs).values({
    actorId: userId,
    action: 'user.data_exported',
    targetType: 'user',
    targetId: userId,
    metadata: JSON.stringify({ export_version: EXPORT_VERSION }),
  })
}
