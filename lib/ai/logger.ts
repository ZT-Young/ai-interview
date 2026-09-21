import { getDb, hasDatabaseUrl } from '@/db/client'
import { aiCallLogs, sanitizeLogText } from '@/db/schema'

/**
 * AI 调用与错误日志。
 *
 * 设计要点：
 * - **不阻断主流程**：写日志失败只 `console.error`，绝不让日志问题导致 AI 功能失败
 * - **PII 最小化**：只记元数据；错误信息经 `sanitizeLogText` 截断并去除换行，
 *   防止上游把整段 prompt / 简历原文塞进错误信息
 * - 未配置数据库时静默跳过（保证单元测试与无 DB 环境不报错）
 */

export type AiOperation =
  | 'parse_jd'
  | 'parse_resume'
  | 'match'
  | 'plan'
  | 'follow_up'
  | 'hint'
  | 'evaluate'
  | 'report'
  | 'unknown'

export interface AiCallRecord {
  operation: AiOperation
  /** 模型标识（来自 LLM_MODEL，不含密钥） */
  model?: string | null
  durationMs?: number | null
  promptTokens?: number | null
  completionTokens?: number | null
  userId?: string | null
  sessionId?: string | null
  promptVersion?: string | null
  errorCode?: string | null
  errorMessage?: unknown
}

/**
 * 记录一次成功的 AI 调用。
 *
 * 刻意**不 await 失败**：调用方可以 `void logAiSuccess(...)`，
 * 日志写入不影响响应延迟。
 */
export async function logAiSuccess(record: AiCallRecord): Promise<void> {
  await write({ ...record, status: 'success' })
}

/** 记录一次失败的 AI 调用（错误日志） */
export async function logAiError(record: AiCallRecord & { errorCode: string }): Promise<void> {
  await write({ ...record, status: 'error' })
}

async function write(record: AiCallRecord & { status: 'success' | 'error' }): Promise<void> {
  if (!hasDatabaseUrl()) return

  try {
    const db = getDb()
    await db.insert(aiCallLogs).values({
      userId: record.userId ?? null,
      sessionId: record.sessionId ?? null,
      operation: record.operation,
      model: record.model ?? null,
      status: record.status,
      durationMs: record.durationMs ?? null,
      promptTokens: record.promptTokens ?? null,
      completionTokens: record.completionTokens ?? null,
      errorCode: record.errorCode ?? null,
      errorMessage: sanitizeLogText(record.errorMessage),
      promptVersion: record.promptVersion ?? null,
    })
  } catch (error) {
    // 日志写入失败不影响业务
    console.error('[ai-log] 写入调用日志失败', error)
  }
}

/** 便捷包装：记录一次 AI 调用的成功与失败（自动计时） */
export async function withAiLogging<T>(
  record: Omit<AiCallRecord, 'durationMs'>,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await run()
    void logAiSuccess({ ...record, durationMs: Date.now() - startedAt })
    return result
  } catch (error) {
    void logAiError({
      ...record,
      durationMs: Date.now() - startedAt,
      errorCode: typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown',
      errorMessage: error instanceof Error ? error.message : error,
    })
    throw error
  }
}
