/**
 * 结构化日志（AGENTS.md §7 C6、任务要求「配置日志」）。
 *
 * 约定：
 * - 输出**单行 JSON**，便于日志平台采集
 * - **绝不记录 PII**：不写简历原文、作答内容、邮箱、令牌
 * - level 由 `LOG_LEVEL` 控制（debug | info | warn | error，默认 info）
 * - 生产环境可只输出 JSON；开发环境附加可读前缀
 *
 * 本模块只做输出，不依赖任何外部服务（错误上报见 error-monitor.ts）。
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function currentLevel(): LogLevel {
  const value = process.env.LOG_LEVEL as LogLevel | undefined
  return value && LOG_LEVELS.includes(value) ? value : 'info'
}

export interface LogFields {
  /** 事件名，建议用 `域.动作`，如 `auth.login`、`payment.callback` */
  event: string
  /** 附加字段（**禁止放 PII**） */
  [key: string]: unknown
}

/** 需要从日志中剔除的字段名（防误传 PII） */
const FORBIDDEN_FIELDS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'authorization',
  'cookie',
  'rawText',
  'parsedData',
  'content',
  'answer',
  'email',
  'resumeText',
])

/**
 * 递归剔除敏感字段。
 *
 * 这一层是**兜底防守**：即使调用方不小心把整个对象传进来，
 * 也不会把密码或简历原文写进日志。
 */
export function redactFields(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactFields(item, depth + 1))
  }

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      result[key] = '[redacted]'
      continue
    }
    result[key] = redactFields(item, depth + 1)
  }
  return result
}

function emit(level: LogLevel, fields: LogFields): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return

  const payload = {
    level,
    time: new Date().toISOString(),
    ...(redactFields(fields) as Record<string, unknown>),
  }

  const line = JSON.stringify(payload)

  // error 走 stderr，便于容器与平台按级别分流
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (fields: LogFields) => emit('debug', fields),
  info: (fields: LogFields) => emit('info', fields),
  warn: (fields: LogFields) => emit('warn', fields),
  error: (fields: LogFields) => emit('error', fields),
}
