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

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100).optional(),
  /** 必须显式同意条款（AGENTS.md §7 C1） */
  acceptTerms: z.literal(true, {
    error: '必须同意用户协议与隐私政策',
  }),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '请输入密码'),
})

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).nullable().optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
