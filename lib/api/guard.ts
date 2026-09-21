import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { resolveSessionUser, type AuthenticatedUser } from '@/lib/auth/verify-session'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'

import { unauthorized } from './errors'

/**
 * 权限守卫 —— 所有受保护 **API 路由**的第一行。
 *
 * 用法：
 *   const user = await requireUser()
 *   // 之后所有查询必须带 user.id 过滤（见 ownedBy）
 *
 * ⚠️ **不要在页面（page.tsx）里使用本函数**：
 * 它抛的是 API 层 401 异常，在页面渲染中会被 Next.js 当作未知渲染错误，
 * 打印整段堆栈（把真正的问题淹没在日志里）。页面请用 `requirePageUser()`。
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value
  const user = await resolveSessionUser(token)
  if (!user) throw unauthorized()
  return user
}

/**
 * 页面专用守卫：未登录时 `redirect('/login')`。
 *
 * 与 `requireUser()` 的区别是**不抛 API 异常**，因此不会污染服务端日志。
 * 虽然 `(app)/layout.tsx` 已做守卫，页面内仍应调用本函数：
 * 一是让每个页面的依赖显式可见，二是避免在 layout 与 page 的渲染时序上踩坑。
 */
export async function requirePageUser(): Promise<AuthenticatedUser> {
  const user = await optionalUser()
  if (!user) redirect('/login')
  return user
}

/** 可选鉴权：用于「登录与否都能访问」的页面/接口 */
export async function optionalUser(): Promise<AuthenticatedUser | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value
  return resolveSessionUser(token)
}

/** 读取当前请求的客户端信息，供审计日志使用 */
export function requestContext(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for')
  return {
    ip: forwarded ? forwarded.split(',')[0]!.trim() : null,
    userAgent: request.headers.get('user-agent'),
  }
}
