import { NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, validationError } from './errors'

/** 统一 JSON 成功响应 */
export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json<T>(data, { status })
}

export function created<T>(data: T): NextResponse<T> {
  return NextResponse.json<T>(data, { status: 201 })
}

/**
 * 路由处理器包装器：统一异常 → 错误响应。
 * 让 app/api/**\/route.ts 只关注「校验 → 调服务 → 返回」。
 *
 * 返回类型放宽为 `Response`：部分路由需要自定义响应头
 * （例如数据导出的 `content-disposition`）而不用 NextResponse。
 */
export function apiHandler<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/**
 * 用 zod 解析请求体。
 * 校验失败抛 422 而非 500（AGENTS.md §10：必须有错误处理）。
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw validationError('请求体不是合法的 JSON')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    throw validationError('请求参数不合法', result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })))
  }
  return result.data
}

/** 列表分页参数（V1 固定上限，防止一次拉全表） */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type Pagination = z.infer<typeof paginationSchema>

export function parsePagination(searchParams: URLSearchParams): Pagination {
  return paginationSchema.parse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  })
}
