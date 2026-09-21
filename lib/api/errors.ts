import { NextResponse } from 'next/server'

/**
 * API 错误契约 —— ② 接口层统一错误映射。
 * 领域服务与能力层抛 ApiError，路由层不重复判断错误类型。
 */

export type ApiErrorCode =
  | 'unauthorized' // 未登录 / 会话失效
  | 'forbidden' // 已登录但无权（V1 尽量用 not_found 代替）
  | 'not_found' // 资源不存在**或不属于当前用户**
  | 'validation_error' // 入参不合法
  | 'conflict' // 唯一约束冲突（如邮箱已注册）
  | 'rate_limited'
  | 'service_unavailable' // 依赖未配置或不可用（如 S3 / LLM 未配）
  | 'upstream_error' // 上游返回内容不可用（如 AI 产出不合规）
  | 'internal_error'

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 422,
  conflict: 409,
  rate_limited: 429,
  service_unavailable: 503,
  upstream_error: 502,
  internal_error: 500,
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
  }
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = details
  }
}

/**
 * 资源不存在或不属于当前用户时统一返回 404。
 *
 * 刻意不用 403：403 会泄露「该 ID 存在」这一信息，
 * 使攻击者能枚举他人资源（见 docs/ARCHITECTURE.md §4）。
 */
export function notFound(message = '资源不存在'): ApiError {
  return new ApiError('not_found', message)
}

export function unauthorized(message = '未登录或会话已失效'): ApiError {
  return new ApiError('unauthorized', message)
}

/**
 * 已登录但不满足权益要求（对应 403）。
 *
 * 注意与 `notFound` 的分工：**资源归属**问题一律用 404（不泄露存在性）；
 * 只有「资源确实属于你，但你没有这项权益」才用 403。
 */
export function forbidden(message = '当前账号无权使用该功能'): ApiError {
  return new ApiError('forbidden', message)
}

export function conflict(message: string): ApiError {
  return new ApiError('conflict', message)
}

export function validationError(message = '请求参数不合法', details?: unknown): ApiError {
  return new ApiError('validation_error', message, details)
}

export function internalError(message = '服务器内部错误'): ApiError {
  return new ApiError('internal_error', message)
}

/** 依赖未配置或不可用（S3 / LLM 缺失），对应 503 */
export function serviceUnavailable(message: string): ApiError {
  return new ApiError('service_unavailable', message)
}

/** 上游返回内容不可用（AI 产出不合规/不合配额），对应 502 */
export function upstreamError(message: string, details?: unknown): ApiError {
  return new ApiError('upstream_error', message, details)
}

/** 把任意抛出物转换为统一的错误响应；未知错误一律 500，且不暴露内部细节。 */
export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    )
  }

  // 环境未配置（缺 DATABASE_URL 等）→ 503 + 可执行提示，而不是 500
  if (isDatabaseUnavailable(error)) {
    return NextResponse.json<ApiErrorBody>(
      {
        error: {
          code: 'service_unavailable',
          message:
            '数据库未配置或不可用。请在 .env.local 中设置 DATABASE_URL（参考 .env.example）后重启服务。',
        },
      },
      { status: 503 },
    )
  }

  // 未预期错误：记录服务端日志，但只向客户端返回通用信息
  console.error('[api] 未处理异常', error)
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'internal_error', message: '服务器内部错误' } },
    { status: 500 },
  )
}

/**
 * 识别「数据库不可用」。
 *
 * 用鸭子类型而不是 `instanceof`：Next.js 的模块打包边界可能导致
 * 同一模块被加载成两份，`instanceof` 会失败。
 */
function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown }

  if (candidate.name === 'DatabaseUnavailableError') return true
  if (candidate.code === 'database_unavailable') return true

  // 兜底：连接层面的常见失败
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  return (
    message.includes('缺少 DATABASE_URL') || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/.test(message)
  )
}
