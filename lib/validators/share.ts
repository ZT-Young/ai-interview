import { z } from 'zod'

/**
 * B 端报告分享的请求契约（docs/design/INTERVIEWER_SIDE.md §4）。
 *
 * 与 `lib/validators/auth.ts` 同为「入参方向」的 zod schema，
 * 区别于 `lib/ai/schemas`（模型输出方向）。
 */

/**
 * 分享可见范围。
 *
 * **注意**：这是「候选人愿意给对方看多少」，
 * 与 `entitlements`（能否看自己的完整报告）**不是一回事**，不要合并成一个开关。
 */
export const shareVisibilitySchema = z.enum(['summary', 'full'])

/** 分享有效期天数：1–90，超出让用户走「重新发一条」而不是留一个永久链接 */
export const shareExpiresInDaysSchema = z
  .number()
  .int('有效期必须为整数天')
  .min(1, '有效期至少 1 天')
  .max(90, '有效期最多 90 天')

/** 候选人创建链接分享 */
export const createLinkShareSchema = z.object({
  sessionId: z.string().uuid('面试会话 ID 不合法'),
  visibility: shareVisibilitySchema.optional(),
  note: z.string().trim().max(200, '附言最多 200 字').optional(),
  expiresInDays: shareExpiresInDaysSchema.optional(),
  /**
   * 可选访问码（4–8 位数字）。
   * 用于「链接可能被转发」的场景；不填表示持链接即可看。
   */
  accessCode: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, '访问码为 4–8 位数字')
    .optional(),
})

/** 候选人接受邀请：必须指定要分享哪一场 + 可见范围 */
export const acceptInviteSchema = z.object({
  sessionId: z.string().uuid('面试会话 ID 不合法'),
  visibility: shareVisibilitySchema.optional(),
})

/** 面试官发起邀请：填候选人的邮箱 / 手机号 / 用户名 */
export const createInviteSchema = z.object({
  candidateIdentifier: z.string().trim().min(2, '请填写候选人的邮箱 / 手机号 / 用户名').max(255),
  note: z.string().trim().max(200, '附言最多 200 字').optional(),
})

/** 公开访问：访问码走查询参数 */
export const shareAccessQuerySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, '访问码格式不正确')
    .optional(),
})

export type CreateLinkShareInput = z.infer<typeof createLinkShareSchema>
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>
export type CreateInviteInput = z.infer<typeof createInviteSchema>
