import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  resolveAdminSessionUser,
  resolveSessionUser,
  type AuthenticatedUser,
} from '@/lib/auth/verify-session'
import { ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/lib/auth/session'

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

/**
 * 管理端守卫（API 用）：必须是**管理端会话** + `is_admin`。
 *
 * 与 `requireUser()` 的关系：两者**完全独立**。
 * 用户端会话再怎么有 `is_admin` 也进不了后台，反之后台会话也不用于用户端接口。
 */
export async function requireAdminUser(): Promise<AuthenticatedUser> {
  const token = cookies().get(ADMIN_SESSION_COOKIE_NAME)?.value
  const user = await resolveAdminSessionUser(token)
  if (!user) throw unauthorized()
  return user
}

/**
 * 管理端守卫（页面用）：未登录或不是管理端会话 → 重定向到**管理端登录页**。
 *
 * 注意重定向目标是 `/admin/login` 而不是 `/login`：
 * 用户端登录页不应知道后台的存在，这是「用户端看不到管理端」的一部分。
 */
export async function requireAdminPageUser(): Promise<AuthenticatedUser> {
  const admin = await optionalAdminUser()
  if (!admin) redirect('/admin/login')
  return admin
}

/** 可选的管理端鉴权：用于「登录与否都能访问」的页面（如后台登录页自身） */
export async function optionalAdminUser(): Promise<AuthenticatedUser | null> {
  const token = cookies().get(ADMIN_SESSION_COOKIE_NAME)?.value
  return resolveAdminSessionUser(token)
}

/** 读取当前请求的客户端信息，供审计日志使用 */
export function requestContext(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for')
  return {
    ip: forwarded ? forwarded.split(',')[0]!.trim() : null,
    userAgent: request.headers.get('user-agent'),
  }
}
