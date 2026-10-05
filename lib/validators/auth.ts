import { z } from 'zod'

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/auth/password'

/** 邮箱统一小写规范化后入库，避免大小写导致重复注册 */
export const emailSchema = z
  .string()
  .trim()
  .min(1, '请输入邮箱')
  .max(255, '邮箱过长')
  .email('邮箱格式不正确')
  .transform((value) => value.toLowerCase())

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 位`)

/**
 * 手机号（中国大陆 11 位）。
 *
 * 只做格式校验，**不校验号段是否真实存在**（那需要运营商数据）。
 * 唯一性由数据库 `users_phone_unique` 保证。
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, '请输入手机号')
  .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')

/**
 * 用户名：既用于展示，也可作为登录标识。
 *
 * 限制字符集是为了保证「用户名 / 手机号 / 邮箱」三种登录标识可被无歧义地区分：
 * 不含 `@`、不全为数字开头为 1 的 11 位，因此不会与邮箱、手机号判断冲突
 * （解析顺序见 auth-service 的 `resolveUserByIdentifier`）。
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(2, '用户名至少 2 个字符')
  .max(30, '用户名最多 30 个字符')
  .regex(/^[一-龥a-zA-Z0-9_-]+$/, '用户名只能包含中文、字母、数字、下划线或连字符')
  // 关键：禁止取成手机号的样子。否则登录时会被 resolveIdentifierKind 判为手机号，
  // 查 users.phone 查不到，用户就再也登不上自己的账号（且原因极难自查）。
  .refine((value) => !/^1[3-9]\d{9}$/.test(value), '用户名不能与手机号格式相同')

/** 登录标识：用户名 / 手机号 / 邮箱 三选一，由服务端判定类型 */
export const identifierSchema = z
  .string()
  .trim()
  .min(1, '请输入账号')
  .max(255, '账号过长')

/**
 * 短信验证码。
 *
 * 演示/本地环境下**固定为 8888**（未接短信服务商），因此这里只校验位数，
 * 真正的值校验在 `lib/auth/verification-code.ts`。
 * 放宽到 4–6 位，接真实短信时无需改动前端。
 */
export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, '验证码为 4–6 位数字')

const acceptTermsSchema = z.literal(true, {
  error: '必须同意用户协议与隐私政策',
})

/** 身份取值本体（**不带默认值**，避免误用） */
const roleValueSchema = z.enum(['candidate', 'interviewer'])

/**
 * 注册专用：必须有身份，不传按面试者。
 */
export const roleSchema = roleValueSchema.default('candidate')

/**
 * 登录 / 更新资料专用：**不传表示「不改」**，绝不能补默认值。
 *
 * 为什么必须分成两个 schema：`.default()` 会让 zod 在字段缺失时把值补上，
 * 于是 `PATCH /api/auth/me { name: '张三' }` 会被解析成 `role: 'candidate'`，
 * 服务层按「传了就改」处理 → **面试官改个昵称就被踢回求职者侧**。
 * 同理，登录不传 role 会被当成「切成面试者」，等于每次登录都重置身份。
 * 「缺省」与「显式选了面试者」是两件事，schema 必须能区分。
 */
export const optionalRoleSchema = roleValueSchema.optional()

/* ---------------------------------------------------------------------------
 * 注册：邮箱 / 手机号 双通道
 * ------------------------------------------------------------------------- */

export const registerEmailSchema = z.object({
  channel: z.literal('email'),
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100).optional(),
  /** 注册时选定的身份（面试者 / 面试官）；不传按面试者处理 */
  role: roleSchema,
  /** 必须显式同意条款（AGENTS.md §7 C1） */
  acceptTerms: acceptTermsSchema,
})

export const registerPhoneSchema = z.object({
  channel: z.literal('phone'),
  phone: phoneSchema,
  code: verificationCodeSchema,
  /**
   * 可选密码：设置后可用「手机号 + 密码」登录；不设则只能用验证码登录。
   * 因此 `password_hash` 允许为空（见 db/schema/users.ts）。
   */
  password: passwordSchema.optional(),
  name: z.string().trim().min(1).max(100).optional(),
  role: roleSchema,
  acceptTerms: acceptTermsSchema,
})

export const registerSchema = z.discriminatedUnion('channel', [
  registerEmailSchema,
  registerPhoneSchema,
])

/* ---------------------------------------------------------------------------
 * 登录：统一标识 + 密码 / 验证码 双模式
 * ------------------------------------------------------------------------- */

export const loginSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('password'),
    identifier: identifierSchema,
    password: z.string().min(1, '请输入密码'),
    /** 本次登录要进入哪一侧；不传表示保持账号现有身份 */
    role: optionalRoleSchema,
  }),
  z.object({
    mode: z.literal('code'),
    identifier: identifierSchema,
    code: verificationCodeSchema,
    role: optionalRoleSchema,
  }),
])

/** 请求发送短信验证码 */
export const smsCodeSchema = z.object({
  phone: phoneSchema,
})

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).nullable().optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    /** 用户名可自行修改；唯一性由服务层查库保证（冲突返回 409） */
    username: usernameSchema.optional(),
    /** 切换身份（面试者 ↔ 面试官）。不传表示不改，绝不补默认值 */
    role: optionalRoleSchema,
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })

/**
 * 服务层入参一律用 **输入类型**（`z.input`）而非 `z.infer`（输出类型）：
 * 带 `.default()` 的字段在输出类型里是必填，会让「不传 role」的老调用点全部报错。
 * 默认值由 zod 解析时补上，服务层拿到的仍然是完整的 `role` 值。
 */
export type RegisterInput = z.input<typeof registerSchema>
export type RegisterEmailInput = z.input<typeof registerEmailSchema>
export type RegisterPhoneInput = z.input<typeof registerPhoneSchema>
export type LoginInput = z.input<typeof loginSchema>
export type UpdateProfileInput = z.input<typeof updateProfileSchema>
export type SmsCodeInput = z.infer<typeof smsCodeSchema>
