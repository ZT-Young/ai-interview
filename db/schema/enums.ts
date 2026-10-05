import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * 枚举单一真源 —— 见 docs/engineering/DATA_MODEL.md §2 与 docs/engineering/ARCHITECTURE.md §3.6。
 * 新增取值必须走迁移；禁止在业务代码里散落字符串字面量。
 */

/** 用户会员等级 */
export const membershipLevelEnum = pgEnum('membership_level', ['free', 'plus', 'pro'])

/** 会话**生命周期**（宏观）；面试进行中的细粒度位置见 orchestrationPhaseEnum */
export const sessionStatusEnum = pgEnum('session_status', [
  'draft',
  'planned',
  'in_progress',
  'completed',
  'cancelled',
  'failed',
])

/** 题目类型 */
export const questionTypeEnum = pgEnum('question_type', [
  'self_intro',
  'project_dig',
  'technical',
  'behavioral',
  'reverse',
])

/** 题目来源 */
export const questionSourceEnum = pgEnum('question_source', ['jd', 'resume', 'both', 'generic'])

/** 回答录入方式 */
export const answerSourceEnum = pgEnum('answer_source', ['text', 'voice'])

/** 评分维度（六项，AGENTS.md §6.2） */
export const scoreDimensionEnum = pgEnum('score_dimension', [
  'job_match',
  'professional',
  'project_depth',
  'logic',
  'communication',
  'motivation',
])

/** 解析状态（简历 / JD 共用） */
export const parseStatusEnum = pgEnum('parse_status', [
  'pending',
  'processing',
  'success',
  'failed',
])

/** 订单状态 */
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
  'cancelled',
])

/**
 * 解锁类型（会员与次数分离，AGENTS.md §5）。
 * `free_trial` 用于记录**免费额度的消耗**，使免费与付费走同一张凭证表，
 * 对账与审计完整，并天然获得 `(provider, provider_order_id)` 的幂等保护。
 */
export const unlockTypeEnum = pgEnum('unlock_type', [
  'report',
  'package',
  'subscription',
  'free_trial',
])

/** 同意类型（AGENTS.md §7 C1/C2） */
export const consentTypeEnum = pgEnum('consent_type', ['terms', 'privacy', 'ai_disclosure'])

/**
 * 产品身份（B 端面试官侧，DATA_MODEL §2.10）。
 * 与 `users.is_admin` 正交：一个是产品身份，一个是后台权限。
 */
export const userRoleEnum = pgEnum('user_role', ['candidate', 'interviewer'])

/**
 * 分享方式（DATA_MODEL §2.11）。
 * `link`：候选人主动生成链接；`invite`：面试官发起、候选人确认后才可读。
 * 两条路径都必须有候选人的明确动作，系统不得自动开放（AGENTS.md §7 C1）。
 */
export const shareKindEnum = pgEnum('share_kind', ['link', 'invite'])

/** 分享状态机（DATA_MODEL §2.12） */
export const shareStatusEnum = pgEnum('share_status', [
  'pending',
  'active',
  'declined',
  'revoked',
])

/**
 * 会话属于哪一端（DATA_MODEL §2.14）。
 *
 * **用户端与管理端完全分离**的关键：登录入口分开还不够 ——
 * 若两端共用同一条会话，那么「在用户端登录过的管理员」被钓鱼页面诱导时，
 * 后台接口仍会放行。因此会话必须自带归属，且 Cookie 名也不同。
 */
export const sessionKindEnum = pgEnum('session_kind', ['user', 'admin'])

/**
 * 分享可见范围（DATA_MODEL §2.14）。
 * 由**候选人自主选择**，与付费墙无关 —— 别把它和 `entitlements` 混成一个开关。
 */
export const shareVisibilityEnum = pgEnum('share_visibility', ['summary', 'full'])

/**
 * 面试**编排阶段**（微观）。
 * 与 sessionStatusEnum 的关系见 docs/engineering/ARCHITECTURE.md §3.6.1。
 */
export const orchestrationPhaseEnum = pgEnum('orchestration_phase', [
  'IDLE',
  'PARSING',
  'READY',
  'ASKING',
  'WAITING_ANSWER',
  'FOLLOW_UP',
  'NEXT_QUESTION',
  'FINISHED',
  'REPORTING',
])

/** 对话消息的发出方 */
export const messageRoleEnum = pgEnum('message_role', ['ai', 'user', 'system'])

/** 对话消息类型 */
export const messageTypeEnum = pgEnum('message_type', [
  'question',
  'follow_up',
  'hint',
  'answer',
  'skip',
  'system',
])

/** 六维评分的取值范围（AGENTS.md §6.2：每项 0–5） */
export const SCORE_MIN = 0
export const SCORE_MAX = 5

/** 总分取值范围（AGENTS.md §6.2：总分 0–100） */
export const TOTAL_SCORE_MIN = 0
export const TOTAL_SCORE_MAX = 100

/** 每道主问题允许的最大追问层级（AGENTS.md §2 第 7 步：最多追问 2 层） */
export const MAX_QUESTION_DEPTH = 2
