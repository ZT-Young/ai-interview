import { z } from 'zod'

/**
 * 面试配置默认值 —— 题目配额依据 AGENTS.md §2 第 5 步的五个环节。
 * 具体数值为工程默认值，产品口径见 docs/product/PRD.md（待创建）。
 */
export const DEFAULT_SESSION_CONFIG = {
  durationMin: 30,
  maxQuestions: 10,
  difficulty: 'medium' as const,
}

export const sessionConfigSchema = z.object({
  durationMin: z.number().int().min(5).max(120).default(DEFAULT_SESSION_CONFIG.durationMin),
  maxQuestions: z.number().int().min(1).max(30).default(DEFAULT_SESSION_CONFIG.maxQuestions),
  difficulty: z.enum(['easy', 'medium', 'hard']).default(DEFAULT_SESSION_CONFIG.difficulty),
})

export const createSessionSchema = z.object({
  /** 简历与 JD 均可后补，但至少要有其一才能生成有效面试计划 */
  resumeId: z.string().uuid().optional(),
  jobJdId: z.string().uuid().optional(),
  config: sessionConfigSchema.optional(),
})

export const updateSessionSchema = z
  .object({
    resumeId: z.string().uuid().nullable().optional(),
    jobJdId: z.string().uuid().nullable().optional(),
    config: sessionConfigSchema.partial().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })

export type CreateSessionInput = z.infer<typeof createSessionSchema>
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>
export type SessionConfig = z.infer<typeof sessionConfigSchema>
