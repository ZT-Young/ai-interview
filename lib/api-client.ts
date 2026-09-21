/** 前端调用 API 的统一封装：把后端统一错误结构转成可读消息。 */

export interface ApiErrorPayload {
  error?: { code?: string; message?: string; details?: unknown }
}

export class ApiClientError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
  })

  return handleResponse<T>(response)
}

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}

  if (!response.ok) {
    const body = payload as ApiErrorPayload
    throw new ApiClientError(
      response.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? '请求失败，请稍后重试',
      body.error?.details,
    )
  }

  return payload as T
}

/**
 * 上传文件（multipart/form-data）。
 * 刻意不设置 content-type —— 浏览器需要自动补上 boundary。
 */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  return handleResponse<T>(response)
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload,
}
