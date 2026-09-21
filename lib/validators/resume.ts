import { z } from 'zod'

/** 简历允许的文件类型（AGENTS.md §2 第 3 步：PDF / Word / 图片） */
export const RESUME_FILE_TYPES = ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg'] as const

export type ResumeFileType = (typeof RESUME_FILE_TYPES)[number]

export const createResumeSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileType: z.enum(RESUME_FILE_TYPES),
  fileSize: z.number().int().positive().max(20 * 1024 * 1024, '文件不能超过 20MB'),
  /** Phase 2 由上传接口产出；Phase 1 允许直接传入，便于联调 */
  storageKey: z.string().trim().min(1).max(1024),
  isPrimary: z.boolean().default(false),
})

export const updateResumeSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).optional(),
    rawText: z.string().max(200_000).nullable().optional(),
    /** 用户在解析结果页修改后的结构化数据（AGENTS.md §2 第 4 步：允许用户修改） */
    parsedData: z.unknown().nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的字段' })

export const listResumesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type CreateResumeInput = z.input<typeof createResumeSchema>
export type CreateResumePayload = z.output<typeof createResumeSchema>
export type UpdateResumeInput = z.infer<typeof updateResumeSchema>
