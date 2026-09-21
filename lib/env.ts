import { z } from 'zod'

/**
 * 环境变量集中校验。
 *
 * 设计原则（对齐 AGENTS.md §8「不硬编码密钥」）：
 * - 这里只定义 schema 与分组，真实值一律来自 .env.local / 部署平台环境变量。
 * - Phase 0 不强制要求任何密钥：数据库/AI/存储相关变量缺失时，
 *   由各模块在**实际调用时**报出可读错误，而不是在 import 阶段就让 build 失败。
 * - 接入真实功能时，把对应变量从 optional() 提升为必填。
 */

const commonSchema = z.object({
  /** 数据库 */
  DATABASE_URL: z.string().url().optional(),
  /** LLM（OpenAI 兼容接口：DeepSeek / Qwen / GPT） */
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MODEL: z.string().min(1).optional(),
  /** 语音识别 */
  ASR_API_KEY: z.string().min(1).optional(),
  ASR_BASE_URL: z.string().url().optional(),
  /** S3 兼容对象存储（简历原件） */
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  /** 鉴权（Auth.js / Supabase Auth，选型 TBD，见 AGENTS.md §9.2） */
  AUTH_SECRET: z.string().min(16).optional(),
})

export type Env = z.infer<typeof commonSchema>

export type EnvGroup = 'database' | 'llm' | 'asr' | 'storage' | 'auth'

/** 判定「分组是否就绪」所需的键；S3_REGION 等有默认值的项不计入。 */
const REQUIRED_KEYS: Record<EnvGroup, readonly (keyof Env)[]> = {
  database: ['DATABASE_URL'],
  llm: ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'],
  asr: ['ASR_API_KEY', 'ASR_BASE_URL'],
  storage: ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'],
  auth: ['AUTH_SECRET'],
}
const GROUP_HINTS: Record<EnvGroup, string> = {
  database: '请配置 DATABASE_URL（PostgreSQL 连接串），参考 .env.example。',
  llm: '请配置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（OpenAI 兼容接口），参考 .env.example。',
  asr: '请配置 ASR_API_KEY 与 ASR_BASE_URL（语音转文字），参考 .env.example。',
  storage: '请配置 S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET，参考 .env.example。',
  auth: '请配置 AUTH_SECRET（至少 16 字符，可用 `openssl rand -base64 32` 生成）。',
}

export interface EnvGroupResult {
  /** 该分组必需变量是否齐备且格式合法 */
  ok: boolean
  /** 已解析的变量值（仅包含确实存在的键） */
  data: Record<string, string>
  /** 缺失或格式非法的变量名 */
  missing: string[]
}

/**
 * 读取并校验指定分组的环境变量。
 *
 * 不抛异常：调用方依据 `ok` 决定降级或在真正需要时调用 assertEnvGroup。
 * 注意：必需键的存在性用 REQUIRED_KEYS 判定，**不能**依赖合并 schema 的 safeParse
 * （合并后全部字段均为 optional，空环境也会解析成功）。
 */
export function readEnvGroup(group: EnvGroup): EnvGroupResult {
  const parsed = commonSchema.safeParse(process.env)
  const values = (parsed.success ? parsed.data : {}) as Record<string, unknown>

  // 格式非法（而非缺失）的键也要报出来
  const invalid = new Set(
    parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0] ?? '')),
  )

  const missing = REQUIRED_KEYS[group].filter((key) => {
    const value = values[key]
    return typeof value !== 'string' || value.length === 0 || invalid.has(String(key))
  })

  const data = Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  )

  return { ok: missing.length === 0, data, missing: missing.map(String) }
}

/** 分组变量缺失时抛出可读错误，供真正需要该能力的功能调用。 */
export function assertEnvGroup(group: EnvGroup): Record<string, string> {
  const { ok, data, missing } = readEnvGroup(group)
  if (!ok) {
    throw new Error(
      `[env] 缺少或非法的环境变量（${group}）：${missing.join(', ')}\n${GROUP_HINTS[group]}`,
    )
  }
  return data
}
