import { logger } from './logger'

/**
 * 错误监控端口。
 *
 * 现状（**如实说明**）：未接入任何外部监控服务。
 * 配置 `SENTRY_DSN` 后本模块会以 HTTP 形式上报（Sentry 兼容的 store 接口），
 * 未配置时**降级为结构化日志**，并在启动时提示一次「监控未启用」。
 *
 * 为什么不直接装 @sentry/nextjs：会引入依赖与构建期配置，
 * 而当前没有 DSN；先把**上报端口**定义好，接入时只替换本文件实现。
 *
 * 安全：上报内容经过脱敏，**不包含 PII**（见 logger.redactFields）。
 */

export interface ErrorContext {
  /** 事件名，如 `api.handler`、`payment.callback` */
  event: string
  /** 业务上下文（禁止放 PII） */
  [key: string]: unknown
}

function dsn(): string | null {
  const value = process.env.SENTRY_DSN
  return value && value.startsWith('http') ? value : null
}

/** 是否已配置外部错误监控 */
export function isErrorMonitoringEnabled(): boolean {
  return dsn() !== null
}

let warnedOnce = false

/**
 * 上报异常。**永不抛出** —— 监控本身不应影响业务。
 */
export async function captureError(error: unknown, context: ErrorContext): Promise<void> {
  const { redactFields } = await import('./logger')

  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack?.split('\n').slice(0, 10).join('\n') : undefined

  const endpoint = dsn()

  // 未配置外部监控：降级为结构化日志
  if (!endpoint) {
    if (!warnedOnce) {
      warnedOnce = true
      logger.warn({
        event: 'observability.monitoring_disabled',
        detail: '未配置 SENTRY_DSN，错误监控降级为结构化日志',
      })
    }

    logger.error({
      event: context.event,
      message,
      stack,
      ...(redactFields(context) as Record<string, unknown>),
    })
    return
  }

  try {
    // Sentry 兼容的最小上报格式（store 接口）
    await fetch(`${endpoint.replace(/\/$/, '')}/api/store/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        level: 'error',
        platform: 'node',
        timestamp: new Date().toISOString(),
        extra: redactFields(context),
      }),
    })
  } catch (reportError) {
    // 上报失败也不能影响业务
    logger.error({
      event: 'observability.report_failed',
      message: reportError instanceof Error ? reportError.message : String(reportError),
    })
  }
}
