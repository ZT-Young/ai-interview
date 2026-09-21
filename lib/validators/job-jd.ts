import { z } from 'zod'

export const createJobJdSchema = z.object({
  /** JD 原文；粘贴是最小可用输入（AGENTS.md §2 第 2 步） */
  rawText: z.string().trim().min(10, 'JD 内容过短').max(200_000),
  title: z.string().trim().min(1).max(200).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
})

export const updateJobJdSchema = z
  .object({
    rawText: z.string().trim().min(10).max(200_000).optional(),
    title: z.string().trim().min(1).max(200).nullable().optional(),
    company: z.string().trim().min(1).max(200).nullable().optional(),
    sourceUrl: z.string().url().max(2048).nullable().optional(),
    /** 用户修正后的解析结果（AGENTS.md §2 第 4 步） */
    parsedData: z.unknown().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })

export type CreateJobJdInput = z.infer<typeof createJobJdSchema>
export type UpdateJobJdInput = z.infer<typeof updateJobJdSchema>
