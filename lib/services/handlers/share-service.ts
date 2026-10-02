import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'

import { getDb } from '@/db/client'
import { auditLogs, interviewSessions, reportShares, users } from '@/db/schema'
import { conflict, notFound, validationError } from '@/lib/api/errors'
import { logger } from '@/lib/observability/logger'

import { getReportBySession } from './report-service'

/**
 * 报告分享服务（B 端场景 A）。
 *
 * 规格见 docs/design/INTERVIEWER_SIDE.md §4，字段见 DATA_MODEL §3.14。
 *
 * **三条不可让步的规则**
 *
 * 1. **一切起源于候选人的动作**。链接是候选人亲手建的，邀请是候选人亲手接受的。
 *    服务层不提供任何「给定 userId 就能看别人报告」的入口 —— 那等于绕过授权。
 * 2. **令牌与访问码只存哈希**。原文只在创建的响应里出现一次，之后无法还原，
 *    所以遗失链接只能撤销重发，这也正是期望行为。
 * 3. **越权一律 404 而非 403**。把「资源存在但你没权限」说出口本身就是信息泄露，
 *    与全项目口径一致（lib/api/errors.ts）。
 */

/** 一次 ticket/token 的字节数（32 → 64 个十六进制字符） */
const TOKEN_BYTES = 32

export type ShareKind = 'link' | 'invite'
export type ShareVisibility = 'summary' | 'full'
export type ShareStatus = 'pending' | 'active' | 'declined' | 'revoked'

export interface SharedReportPayload {
  report: unknown
  matchScore: number | null
  baseSuggestions: unknown
  visibility: ShareVisibility
  sharedAt: string
  /** 候选人附言；未填时为 null */
  note: string | null
  owner: { username: string | null; name: string | null }
}

export interface CandidateShareView {
  id: string
  sessionId: string | null
  kind: ShareKind
  status: ShareStatus
  visibility: ShareVisibility
  note: string | null
  expiresAt: string | null
  revokedAt: string | null
  viewCount: number
  lastViewedAt: string | null
  createdAt: string
  /** 邀请模式下才有的请求方信息 */
  requester?: { id: string; username: string | null; name: string | null } | null
}

/** 令牌哈希：与会话令牌同一原则，库里永远只有哈希 */
function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** 访问码哈希（若设了访问码） */
function hashAccessCode(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** 定长时间比较，防时序侧信道 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  let diff = 0
  for (let i = 0; i < bufA.length; i += 1) diff |= bufA[i]! ^ bufB[i]!
  return diff === 0
}

function toCandidateView(row: typeof reportShares.$inferSelect): CandidateShareView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind,
    status: row.status,
    visibility: row.visibility,
    note: row.note,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt ? row.lastViewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 会话必须属于该候选人且已产出报告，否则不能分享（分享一个空报告毫无意义） */
async function assertSessionShareable(ownerId: string, sessionId: string): Promise<void> {
  const db = getDb()
  const rows = await db
    .select({ id: interviewSessions.id })
    .from(interviewSessions)
    .where(
      and(
        eq(interviewSessions.id, sessionId),
        eq(interviewSessions.userId, ownerId),
        isNull(interviewSessions.deletedAt),
      ),
    )
    .limit(1)

  if (!rows[0]) throw notFound('面试会话不存在')

  const { reports } = await import('@/db/schema')
  const reportRows = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.sessionId, sessionId))
    .limit(1)

  if (!reportRows[0]) throw validationError('该面试尚未生成报告，无法分享')
}

/**
 * 候选人创建「链接分享」。
 *
 * @returns `token` **只在这一次返回值里出现**，之后凭哈希再也取不回原文。
 */
export async function createLinkShare(
  ownerId: string,
  input: {
    sessionId: string
    visibility?: ShareVisibility
    note?: string
    expiresInDays?: number
    accessCode?: string
  },
): Promise<{ share: CandidateShareView; token: string }> {
  await assertSessionShareable(ownerId, input.sessionId)

  const db = getDb()
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const expiresAt =
    typeof input.expiresInDays === 'number'
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null

  const [row] = await db
    .insert(reportShares)
    .values({
      ownerId,
      sessionId: input.sessionId,
      kind: 'link',
      // 创建动作本身即构成候选人的明确授权
      status: 'active',
      tokenHash: hashToken(token),
      visibility: input.visibility ?? 'summary',
      note: input.note?.trim() || null,
      accessCodeHash: input.accessCode ? hashAccessCode(input.accessCode) : null,
      expiresAt,
    })
    .returning()

  if (!row) throw new Error('创建分享失败')

  await db.insert(auditLogs).values({
    actorId: ownerId,
    action: 'report.share_created',
    targetType: 'interview_session',
    targetId: input.sessionId,
    metadata: JSON.stringify({ kind: 'link', visibility: row.visibility, shareId: row.id }),
  })

  return { share: toCandidateView(row), token }
}

/**
 * 面试官发起「查看邀请」。
 *
 * **注意**：此刻还不产生任何可读数据 —— 必须等候选人接受。
 * 若填写的标识查不到账号，返回 validationError 而不是 404 详情，避免账号枚举。
 */
export async function createInvite(
  requesterId: string,
  input: { candidateIdentifier: string; note?: string },
): Promise<CandidateShareView> {
  const db = getDb()
  const identifier = input.candidateIdentifier.trim()

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(eq(users.email, identifier.toLowerCase()), eq(users.phone, identifier), eq(users.username, identifier)),
      ),
    )
    .limit(1)

  const candidate = rows[0]
  if (!candidate) throw validationError('未找到该候选人，请确认邮箱 / 手机号 / 用户名是否正确')
  if (candidate.id === requesterId) throw validationError('不能向自己发起邀请')

  const [row] = await db
    .insert(reportShares)
    .values({
      ownerId: candidate.id,
      // sessionId 留空：面试官无从知道候选人练过哪场，由候选人在接受时自选
      kind: 'invite',
      status: 'pending',
      inviteeUserId: requesterId,
      inviteeIdentifier: identifier,
      visibility: 'summary',
      note: input.note?.trim() || null,
    })
    .returning()

  if (!row) throw new Error('创建邀请失败')

  await db.insert(auditLogs).values({
    actorId: requesterId,
    action: 'report.share_invited',
    targetType: 'user',
    targetId: candidate.id,
    metadata: JSON.stringify({ shareId: row.id }),
  })

  return toCandidateView(row)
}

/** 候选人视角：我发出的分享 + 待我处理的邀请 */
export async function listCandidateShares(
  ownerId: string,
): Promise<{ outgoing: CandidateShareView[]; pendingInvites: CandidateShareView[] }> {
  const db = getDb()
  const rows = await db
    .select({
      share: reportShares,
      requesterUsername: users.username,
      requesterName: users.name,
      requesterId: users.id,
    })
    .from(reportShares)
    .leftJoin(users, eq(users.id, reportShares.inviteeUserId))
    .where(eq(reportShares.ownerId, ownerId))
    .orderBy(desc(reportShares.createdAt))

  const outgoing: CandidateShareView[] = []
  const pendingInvites: CandidateShareView[] = []

  for (const r of rows) {
    const view: CandidateShareView = {
      ...toCandidateView(r.share),
      requester:
        r.share.kind === 'invite' && r.requesterId
          ? { id: r.requesterId, username: r.requesterUsername, name: r.requesterName }
          : null,
    }
    if (r.share.kind === 'invite' && r.share.status === 'pending') pendingInvites.push(view)
    else outgoing.push(view)
  }

  return { outgoing, pendingInvites }
}

/** 面试官视角：被明确授权给我的分享 */
export async function listSharedWithMe(interviewerId: string): Promise<CandidateShareView[]> {
  const db = getDb()
  const rows = await db
    .select({ share: reportShares })
    .from(reportShares)
    .where(and(eq(reportShares.inviteeUserId, interviewerId), eq(reportShares.status, 'active')))
    .orderBy(desc(reportShares.createdAt))

  return rows.map((r) => toCandidateView(r.share))
}

/** 候选人接受邀请：自选一场面试与可见范围，此刻才真正授权 */
export async function acceptInvite(
  ownerId: string,
  shareId: string,
  input: { sessionId: string; visibility?: ShareVisibility },
): Promise<CandidateShareView> {
  const db = getDb()

  const rows = await db
    .select()
    .from(reportShares)
    .where(and(eq(reportShares.id, shareId), eq(reportShares.ownerId, ownerId)))
    .limit(1)

  const row = rows[0]
  if (!row || row.kind !== 'invite') throw notFound('邀请不存在')
  if (row.status !== 'pending') throw conflict('该邀请已处理过')

  await assertSessionShareable(ownerId, input.sessionId)

  const [updated] = await db
    .update(reportShares)
    .set({
      status: 'active',
      sessionId: input.sessionId,
      visibility: input.visibility ?? 'summary',
      respondedAt: new Date(),
    })
    .where(eq(reportShares.id, shareId))
    .returning()

  if (!updated) throw new Error('接受邀请失败')

  await db.insert(auditLogs).values({
    actorId: ownerId,
    action: 'report.share_accepted',
    targetType: 'interview_session',
    targetId: input.sessionId,
    metadata: JSON.stringify({ shareId, visibility: updated.visibility }),
  })

  return toCandidateView(updated)
}

/** 候选人拒绝或撤销（拒绝 pending 邀请 / 撤销已生效分享，同一动作） */
export async function revokeShare(ownerId: string, shareId: string): Promise<CandidateShareView> {
  const db = getDb()

  const rows = await db
    .select()
    .from(reportShares)
    .where(and(eq(reportShares.id, shareId), eq(reportShares.ownerId, ownerId)))
    .limit(1)

  const row = rows[0]
  if (!row) throw notFound('分享不存在')
  if (row.status === 'revoked') return toCandidateView(row)

  const settledStatus: ShareStatus = row.status === 'pending' ? 'declined' : 'revoked'

  const [updated] = await db
    .update(reportShares)
    .set({ status: settledStatus, revokedAt: new Date(), respondedAt: new Date() })
    .where(eq(reportShares.id, shareId))
    .returning()

  if (!updated) throw new Error('撤销分享失败')

  await db.insert(auditLogs).values({
    actorId: ownerId,
    action: 'report.share_revoked',
    targetType: 'report_share',
    targetId: shareId,
    metadata: JSON.stringify({ settledStatus }),
  })

  return toCandidateView(updated)
}

/**
 * 按令牌读取被分享的报告（公开页面用，无需登录）。
 *
 * 判定顺序刻意如此：任何一环不过都返回 **404**，
 * 不区分「链接错了 / 过期了 / 被撤销了」—— 否则就是在帮试探者缩小范围。
 */
export async function readSharedByToken(
  token: string,
  options: { accessCode?: string; ip?: string; userAgent?: string } = {},
): Promise<SharedReportPayload> {
  const db = getDb()

  const rows = await db
    .select()
    .from(reportShares)
    .where(eq(reportShares.tokenHash, hashToken(token)))
    .limit(1)

  const share = rows[0]
  if (!share || !isAccessible(share)) throw notFound('链接无效或已失效')

  if (share.accessCodeHash) {
    const code = options.accessCode?.trim() ?? ''
    if (!code || !safeEqual(hashAccessCode(code), share.accessCodeHash)) {
      throw notFound('链接无效或已失效')
    }
  }

  await touchShare(share.id, options)
  return buildPayload(share.ownerId, share.sessionId!, share.visibility, share.note)
}

/** 面试官读取被授权给自己的报告（邀请模式，必须本人） */
export async function readSharedForInterviewer(
  interviewerId: string,
  shareId: string,
): Promise<SharedReportPayload> {
  const db = getDb()

  const rows = await db
    .select()
    .from(reportShares)
    .where(
      and(
        eq(reportShares.id, shareId),
        eq(reportShares.inviteeUserId, interviewerId),
        eq(reportShares.status, 'active'),
      ),
    )
    .limit(1)

  const share = rows[0]
  if (!share || !isAccessible(share)) throw notFound('该分享不存在或已失效')

  await touchShare(share.id, {})
  return buildPayload(share.ownerId, share.sessionId!, share.visibility, share.note)
}

/** 是否处于「可读」状态：已生效、未撤销、未过期 */
function isAccessible(share: typeof reportShares.$inferSelect): boolean {
  if (share.status !== 'active' || share.revokedAt) return false
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return false
  return Boolean(share.sessionId)
}

/**
 * 累加查看次数并写审计日志（IP/UA 用于事后追溯「谁看过」）。
 *
 * **必须 SQL 自增**：先读再写在高并发下会丢计数（两次访问读到同一个值）。
 * 计数错不致命，但审计日志必须写成功，因此把自增放进 try ——
 * 宁可次数少记一次，也不能让整个分享页面打不开。
 */
async function touchShare(
  shareId: string,
  options: { ip?: string; userAgent?: string; actorId?: string | null },
): Promise<void> {
  const db = getDb()
  try {
    await db
      .update(reportShares)
      .set({ viewCount: sql`${reportShares.viewCount} + 1`, lastViewedAt: new Date() })
      .where(eq(reportShares.id, shareId))

    await db.insert(auditLogs).values({
      actorId: options.actorId ?? null,
      action: 'report.share_viewed',
      targetType: 'report_share',
      targetId: shareId,
      ip: options.ip ?? null,
      userAgent: options.userAgent ?? null,
    })
  } catch (error) {
    logger.warn({ scope: 'share-service', event: 'touch_failed', shareId, error: String(error) })
  }
}

/**
 * 组装给对方看的内容。
 *
 * **可见性复用免费/付费那套裁剪口径**（`getReportBySession` + isUnlocked），
 * 不另写一份 —— 否则总有一天两边会不一致，而这里的 bug 直接是隐私事故。
 */
async function buildPayload(
  ownerId: string,
  sessionId: string,
  visibility: ShareVisibility,
  note: string | null,
): Promise<SharedReportPayload> {
  const db = getDb()

  // 用 owner 身份读报告：候选人的解锁权益决定 TA 手上有多少内容
  const { report, baseSuggestions, matchScore } = await getReportBySession(ownerId, sessionId)

  const ownerRows = await db
    .select({ username: users.username, name: users.name })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1)

  const owner = ownerRows[0] ?? { username: null, name: null }

  return {
    report: visibility === 'full' ? report : summaryOnly(report as unknown as Record<string, unknown>),
    matchScore,
    baseSuggestions,
    visibility,
    sharedAt: new Date().toISOString(),
    note,
    owner: { username: owner.username, name: owner.name },
  }
}

/**
 * `summary` 可见范围：总分、六维、优势、总评。
 *
 * 这里做**第二道裁剪**是刻意的：`getReportBySession` 裁的是候选人自己的付费墙，
 * 这里裁的是候选人愿意给对方看多少。两者语义不同，任何一道漏了都会多给出去。
 */
function summaryOnly(report: Record<string, unknown>): Record<string, unknown> {
  const allowed = ['id', 'totalScore', 'dimensionScores', 'highlights', 'summary', 'createdAt']
  const out: Record<string, unknown> = {}
  for (const key of allowed) if (key in report) out[key] = report[key]
  return out
}

/** 测试与种子数据用：生成 token 原文 */
export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}
