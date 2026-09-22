import { z } from 'zod'

/**
 * AI 结构化输出的 zod schema —— docs/engineering/AI_PROMPTS.md 的代码实现。
 *
 * 硬性约定：
 * - 所有对象 `.strict()`（等价 JSON Schema 的 additionalProperties: false）
 * - 所有字段必填；未知信息用空值表达（字符串 ""、数组 []、years 0）
 * - 统一信封 { schema_version, data }
 */

export const SCHEMA_VERSION = '1.0'

/** 统一信封包装器 */
export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z
    .object({
      schema_version: z.literal(SCHEMA_VERSION),
      data,
    })
    .strict()
}

/** 文本字段：AI 偶发返回 null 时归一化为 ""（避免因空值直接判失败） */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((value) => value ?? '')

const textArray = (maxItems: number, maxLength: number) =>
  z
    .array(z.string().max(maxLength).nullable().transform((value) => value ?? ''))
    .max(maxItems)
    .nullable()
    .transform((value) => value ?? [])

/* ------------------------------------------------------------------ *
 * 1. JD 解析（docs/engineering/AI_PROMPTS.md §1.2）
 * ------------------------------------------------------------------ */

export const jdDataSchema = z
  .object({
    title: text(200),
    company: text(200),
    must_have: textArray(20, 200),
    nice_to_have: textArray(20, 200),
    responsibilities: textArray(20, 200),
    keywords: textArray(30, 50),
  })
  .strict()

export const jdParseSchema = envelope(jdDataSchema)
export type JdData = z.infer<typeof jdDataSchema>

/* ------------------------------------------------------------------ *
 * 2. 简历解析（docs/engineering/AI_PROMPTS.md §2.2）
 * ------------------------------------------------------------------ */

export const resumeProjectSchema = z
  .object({
    name: text(200),
    /** 简历未写角色时必须为 ""，禁止推断（N4） */
    role: text(100),
    actions: textArray(10, 300),
    results: textArray(10, 300),
    evidence: textArray(3, 300),
  })
  .strict()

export const resumeEducationSchema = z
  .object({
    school: text(200),
    degree: text(60),
    major: text(120),
    period: text(60),
  })
  .strict()

export const resumeDataSchema = z
  .object({
    name: text(100),
    /** 工作年限；简历未给时间信息时为 0 */
    years: z
      .number()
      .int()
      .min(0)
      .max(60)
      .nullable()
      .transform((value) => value ?? 0),
    skills: textArray(50, 60),
    projects: z
      .array(resumeProjectSchema)
      .max(20)
      .nullable()
      .transform((value) => value ?? []),
    education: z
      .array(resumeEducationSchema)
      .max(10)
      .nullable()
      .transform((value) => value ?? []),
    /** 客观可验证的简历疑点，禁止性格/诚信判断（见 §2.3） */
    risks: textArray(10, 200),
  })
  .strict()

export const resumeParseSchema = envelope(resumeDataSchema)
export type ResumeData = z.infer<typeof resumeDataSchema>
export type ResumeProject = z.infer<typeof resumeProjectSchema>
export type ResumeEducation = z.infer<typeof resumeEducationSchema>

/* ------------------------------------------------------------------ *
 * 3. 匹配分析（docs/engineering/AI_PROMPTS.md §3.2）
 * ------------------------------------------------------------------ */

export const matchAdvantageSchema = z
  .object({
    point: text(200),
    evidence: text(300),
  })
  .strict()

export const matchQuestionSchema = z
  .object({
    question: text(120),
    based_on: z.enum(['advantage', 'gap']),
  })
  .strict()

export const matchDataSchema = z
  .object({
    match_score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .transform((value) => value ?? 0),
    advantages: z
      .array(matchAdvantageSchema)
      .max(10)
      .nullable()
      .transform((value) => value ?? []),
    gaps: textArray(10, 200),
    suggested_questions: z
      .array(matchQuestionSchema)
      .max(10)
      .nullable()
      .transform((value) => value ?? []),
  })
  .strict()

export const matchParseSchema = envelope(matchDataSchema)
export type MatchData = z.infer<typeof matchDataSchema>

/* ------------------------------------------------------------------ *
 * 4. 抽取元信息（docs/engineering/AI_PROMPTS.md §4.2）
 * ------------------------------------------------------------------ */

export const EXTRACT_SOURCES = ['pdf', 'docx', 'doc', 'image', 'text'] as const

export const extractionMetaSchema = z.object({
  source: z.enum(EXTRACT_SOURCES),
  text_length: z.number().int().min(0),
  page_count: z.number().int().min(0),
  vision_used: z.boolean(),
  /** 图片识别或文本残缺时模型自报的不确定字段，前端高亮提示核对 */
  low_confidence_fields: z.array(z.string()),
  prompt_version: z.string(),
  attempts: z.number().int().min(1),
  truncated: z.boolean(),
})

export type ExtractionMeta = z.infer<typeof extractionMetaSchema>

/* ------------------------------------------------------------------ *
 * 5. 空内容检测辅助（docs/engineering/AI_PROMPTS.md §5.1）
 * ------------------------------------------------------------------ */

/** JD 全空判定：所有字段都为空时视为解析失败 */
export function isJdDataEmpty(data: JdData): boolean {
  return (
    data.title.length === 0 &&
    data.company.length === 0 &&
    data.must_have.length === 0 &&
    data.nice_to_have.length === 0 &&
    data.responsibilities.length === 0 &&
    data.keywords.length === 0
  )
}

/** 简历全空判定 */
export function isResumeDataEmpty(data: ResumeData): boolean {
  return (
    data.name.length === 0 &&
    data.years === 0 &&
    data.skills.length === 0 &&
    data.projects.length === 0 &&
    data.education.length === 0 &&
    data.risks.length === 0
  )
}
