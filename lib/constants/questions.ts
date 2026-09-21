import { questionSourceEnum, questionTypeEnum, scoreDimensionEnum } from '@/db/schema/enums'

/**
 * 题型 / 来源 / 评分维度的取值 —— 从 DB 枚举派生，保证与迁移一致。
 *
 * 单一真源仍是 `db/schema/enums.ts`（docs/DATA_MODEL.md §2）；
 * 本文件只做「给 zod 用的字面量数组」，避免在 schema 里硬编码字符串。
 */
export const QUESTION_TYPE_VALUES = questionTypeEnum.enumValues
export const QUESTION_SOURCE_VALUES = questionSourceEnum.enumValues
export const SCORE_DIMENSION_VALUES = scoreDimensionEnum.enumValues

export type QuestionType = (typeof QUESTION_TYPE_VALUES)[number]
export type QuestionSource = (typeof QUESTION_SOURCE_VALUES)[number]
export type ScoreDimension = (typeof SCORE_DIMENSION_VALUES)[number]

/** 题型中文名，用于 UI 与摘要 */
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  self_intro: '自我介绍',
  project_dig: '项目深挖',
  technical: '专业题',
  behavioral: '行为题',
  reverse: '反问环节',
}

/** 来源中文名 */
export const QUESTION_SOURCE_LABELS: Record<QuestionSource, string> = {
  jd: 'JD',
  resume: '简历',
  both: 'JD + 简历',
  generic: '通用',
}

/** 六维中文名 */
export const SCORE_DIMENSION_LABELS: Record<ScoreDimension, string> = {
  job_match: '岗位匹配',
  professional: '专业能力',
  project_depth: '项目深度',
  logic: '逻辑表达',
  communication: '沟通表达',
  motivation: '动机稳定性',
}
