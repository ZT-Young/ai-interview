import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import {
  aiCallLogs,
  auditLogs,
  interviewSessions,
  payments,
  questions,
  reports,
  resumes,
  users,
} from '@/db/schema'
import { notFound, validationError } from '@/lib/api/errors'

/**
 * 管理后台服务 —— ③ 领域服务层。
 *
 * **PII 边界（硬要求）**：
 * - 默认**不返回** `resumes.raw_text` / `parsed_data`（简历原文），
 *   需显式设置 `ADMIN_VIEW_RESUME_CONTENT=true` 才可见，且每次查看写审计日志
 * - **永不返回** `users.passwordHash`、会话令牌
 * - 日志只含元数据（写入侧已由 `sanitizeLogText` 脱敏）
 */

/** 简历原文是否对管理员可见（默认关闭） */
export function isResumeContentVisible(): boolean {
  return process.env.ADMIN_VIEW_RESUME_CONTENT === 'true'
}

const LIST_LIMIT = 50

/** 免费次数可调范围（服务端校验，防止误操作把余额改成极端值） */
export const MIN_FREE_CREDITS = 0
export const MAX_FREE_CREDITS = 1000

/* ------------------------------------------------------------------ *
 * 概览
 * ------------------------------------------------------------------ */

export interface AdminOverview {
  users: number
  sessions: number
  reports: number
  orders: number
  aiErrors24h: number
  resumeContentVisible: boolean
}

export async function getOverview(): Promise<AdminOverview> {
  const db = getDb()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [userCount, sessionCount, reportCount, orderCount, errorCount] = await Promise.all([
    db.select({ value: count() }).from(users).where(isNull(users.deletedAt)),
    db.select({ value: count() }).from(interviewSessions).where(isNull(interviewSessions.deletedAt)),
    db.select({ value: count() }).from(reports),
    db.select({ value: count() }).from(payments),
    db
      .select({ value: count() })
      .from(aiCallLogs)
      .where(and(eq(aiCallLogs.status, 'error'), gte(aiCallLogs.createdAt, since))),
  ])

  return {
    users: Number(userCount[0]?.value ?? 0),
    sessions: Number(sessionCount[0]?.value ?? 0),
    reports: Number(reportCount[0]?.value ?? 0),
    orders: Number(orderCount[0]?.value ?? 0),
    aiErrors24h: Number(errorCount[0]?.value ?? 0),
    resumeContentVisible: isResumeContentVisible(),
  }
}

/* ------------------------------------------------------------------ *
 * 用户列表
 * ------------------------------------------------------------------ */

export interface AdminUserView {
  id: string
  email: string
  name: string | null
  membership: string
  freeCredits: number
  isAdmin: boolean
  emailVerified: boolean
  createdAt: string
  /** 简历数量（只给数量，不给内容） */
  resumeCount: number
  sessionCount: number
}

export async function listUsers(): Promise<AdminUserView[]> {
  const db = getDb()

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      membership: users.membership,
      freeCredits: users.freeCredits,
      isAdmin: users.isAdmin,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      // 只聚合数量，不触碰 raw_text / parsed_data
      resumeCount: sql<number>`(select count(*) from ${resumes} r where r.user_id = ${users.id} and r.deleted_at is null)`,
      sessionCount: sql<number>`(select count(*) from ${interviewSessions} s where s.user_id = ${users.id} and s.deleted_at is null)`,
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))
    .limit(LIST_LIMIT)

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    membership: row.membership,
    freeCredits: row.freeCredits,
    isAdmin: row.isAdmin,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
    resumeCount: Number(row.resumeCount ?? 0),
    sessionCount: Number(row.sessionCount ?? 0),
  }))
}

/**
 * 用户详情。**默认不含简历原文**。
 *
 * 开启 `ADMIN_VIEW_RESUME_CONTENT=true` 时才附带原文，并由调用方写审计日志。
 */
export async function getUserDetail(
  userId: string,
): Promise<{
  user: AdminUserView
  resumes: Array<{
    id: string
    fileName: string
    fileSize: number
    parseStatus: string
    createdAt: string
    /** 仅在 ADMIN_VIEW_RESUME_CONTENT=true 时存在 */
    rawText?: string | null
    parsedData?: unknown
  }>
  /** 本次响应是否包含简历原文 */
  includesResumeContent: boolean
}> {
  const db = getDb()

  const userRows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)

  const user = userRows[0]
  if (!user) throw notFound('用户不存在')

  const include = isResumeContentVisible()

  const resumeRows = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), isNull(resumes.deletedAt)))
    .orderBy(desc(resumes.createdAt))
    .limit(LIST_LIMIT)

  const resumeCount = resumeRows.length
  const sessionRows = await db
    .select({ value: count() })
    .from(interviewSessions)
    .where(and(eq(interviewSessions.userId, userId), isNull(interviewSessions.deletedAt)))

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      membership: user.membership,
      freeCredits: user.freeCredits,
      isAdmin: user.isAdmin,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      resumeCount,
      sessionCount: Number(sessionRows[0]?.value ?? 0),
    },
    resumes: resumeRows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      fileSize: row.fileSize,
      parseStatus: row.parseStatus,
      createdAt: row.createdAt.toISOString(),
      // 关键：仅在显式开启时附带原文
      ...(include ? { rawText: row.rawText, parsedData: row.parsedData } : {}),
    })),
    includesResumeContent: include,
  }
}

/* ------------------------------------------------------------------ *
 * 会话与报告
 * ------------------------------------------------------------------ */

export interface AdminSessionView {
  id: string
  userId: string
  userEmail: string
  status: string
  phase: string
  questionCount: number
  hasReport: boolean
  totalScore: number | null
  createdAt: string
}

export async function listSessions(): Promise<AdminSessionView[]> {
  const db = getDb()

  const rows = await db
    .select({
      id: interviewSessions.id,
      userId: interviewSessions.userId,
      userEmail: users.email,
      status: interviewSessions.status,
      phase: interviewSessions.phase,
      createdAt: interviewSessions.createdAt,
      questionCount: sql<number>`(select count(*) from ${questions} q where q.session_id = ${interviewSessions.id})`,
      totalScore: reports.totalScore,
    })
    .from(interviewSessions)
    .innerJoin(users, eq(users.id, interviewSessions.userId))
    .leftJoin(reports, eq(reports.sessionId, interviewSessions.id))
    .where(isNull(interviewSessions.deletedAt))
    .orderBy(desc(interviewSessions.createdAt))
    .limit(LIST_LIMIT)

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    status: row.status,
    phase: row.phase,
    questionCount: Number(row.questionCount ?? 0),
    hasReport: row.totalScore !== null,
    totalScore: row.totalScore === null ? null : Number(row.totalScore),
    createdAt: row.createdAt.toISOString(),
  }))
}

/* ------------------------------------------------------------------ *
 * 订单
 * ------------------------------------------------------------------ */

export interface AdminOrderView {
  id: string
  userEmail: string
  unlockType: string
  amountCents: number
  currency: string
  status: string
  productId: string | null
  createdAt: string
}

export async function listAllOrders(): Promise<AdminOrderView[]> {
  const db = getDb()

  const rows = await db
    .select({
      id: payments.id,
      userEmail: users.email,
      unlockType: payments.unlockType,
      amountCents: payments.amountCents,
      currency: payments.currency,
      status: payments.status,
      productId: payments.provider,
      providerOrderId: payments.providerOrderId,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.userId))
    .orderBy(desc(payments.createdAt))
    .limit(LIST_LIMIT)

  // 渠道订单号不返回给后台（避免无关人员拿到可用于对账的标识）
  return rows.map((row) => ({
    id: row.id,
    userEmail: row.userEmail,
    unlockType: row.unlockType,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
    productId: row.productId,
    createdAt: row.createdAt.toISOString(),
  }))
}

/* ------------------------------------------------------------------ *
 * AI 调用日志与错误日志
 * ------------------------------------------------------------------ */

export interface AdminLogView {
  id: string
  operation: string
  model: string | null
  status: string
  durationMs: number | null
  promptTokens: number | null
  completionTokens: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

export async function listAiLogs(options: { status?: 'success' | 'error' } = {}): Promise<AdminLogView[]> {
  const db = getDb()

  const rows = await db
    .select()
    .from(aiCallLogs)
    .where(options.status ? eq(aiCallLogs.status, options.status) : undefined)
    .orderBy(desc(aiCallLogs.createdAt))
    .limit(LIST_LIMIT)

  return rows.map((row) => ({
    id: row.id,
    operation: row.operation,
    model: row.model,
    status: row.status,
    durationMs: row.durationMs,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  }))
}

/* ------------------------------------------------------------------ *
 * 敏感操作：调整免费次数
 * ------------------------------------------------------------------ */

export interface AdjustCreditsInput {
  userId: string
  /** 目标值（绝对值），服务端校验范围 */
  freeCredits: number
  /** 操作原因，写入审计日志 */
  reason: string
}

/**
 * 手动调整用户免费次数。
 *
 * 安全要点：
 * - 范围校验在服务端（`MIN_FREE_CREDITS` ~ `MAX_FREE_CREDITS`）
 * - **调整前后值都写入审计日志**（AGENTS.md §7 C6）
 * - 目标用户必须存在且未被软删除
 */
export async function adjustFreeCredits(
  adminUserId: string,
  input: AdjustCreditsInput,
): Promise<{ userId: string; before: number; after: number }> {
  if (!Number.isInteger(input.freeCredits)) throw validationError('免费次数必须为整数')
  if (input.freeCredits < MIN_FREE_CREDITS || input.freeCredits > MAX_FREE_CREDITS) {
    throw validationError(
      `免费次数必须在 ${MIN_FREE_CREDITS} ~ ${MAX_FREE_CREDITS} 之间`,
    )
  }

  const db = getDb()

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ freeCredits: users.freeCredits })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .limit(1)

    const target = rows[0]
    if (!target) throw notFound('用户不存在')

    const before = target.freeCredits

    await tx
      .update(users)
      .set({ freeCredits: input.freeCredits, updatedAt: new Date() })
      .where(eq(users.id, input.userId))

    // 审计日志：记录操作者、目标、前后值、原因
    await tx.insert(auditLogs).values({
      actorId: adminUserId,
      action: 'admin.credits_adjusted',
      targetType: 'user',
      targetId: input.userId,
      metadata: JSON.stringify({
        before,
        after: input.freeCredits,
        delta: input.freeCredits - before,
        reason: input.reason.slice(0, 200),
      }),
    })

    return { userId: input.userId, before, after: input.freeCredits }
  })
}

/** 记录「查看了简历原文」的审计事件（仅在实际返回原文时调用） */
export async function auditResumeContentView(
  adminUserId: string,
  targetUserId: string,
  resumeId: string,
): Promise<void> {
  const db = getDb()
  await db.insert(auditLogs).values({
    actorId: adminUserId,
    action: 'admin.resume_content_viewed',
    targetType: 'resume',
    targetId: resumeId,
    metadata: JSON.stringify({ target_user_id: targetUserId }),
  })
}

/** 最近审计日志（后台可查，只读） */
export async function listAuditLogs(): Promise<
  Array<{ id: string; action: string; actorId: string | null; targetId: string | null; metadata: string | null; createdAt: string }>
> {
  const db = getDb()
  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(LIST_LIMIT)

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    targetId: row.targetId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }))
}
