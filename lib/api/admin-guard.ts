import { cache } from 'react'

import { notFound } from '@/lib/api/errors'
import { requireAdminUser } from '@/lib/api/guard'
import type { AuthenticatedUser } from '@/lib/auth/verify-session'

/**
 * 管理员守卫 —— **只认管理端会话**。
 *
 * **安全约定**：
 * - 未登录 / 不是管理端会话 → 401
 * - 不是管理员 → **404**（不是 403）
 *
 * 为什么用 404：403 等于告诉攻击者「这个入口存在，只是你没权限」，
 * 便于其针对性探测。全项目的越权场景统一返回 404（见 lib/api/errors.ts）。
 *
 * **用户端与管理端完全分离**：这里不再接受用户端会话 ——
 * 哪怕账号 `is_admin = true`，用 `/login` 登录产生的会话也进不了后台。
 * 管理员必须走 `/admin/login` 单独登录一次，拿到 `kind='admin'` 的会话。
 * 这样即便管理员在用户侧被钓鱼，攻击者拿到的会话也碰不到后台。
 *
 * 身份来源：`users.is_admin`，**只能手动改库设置**，系统无自我提权接口。
 */

export interface AdminUser extends AuthenticatedUser {
  isAdmin: true
}

export async function requireAdmin(): Promise<AdminUser> {
  const user = await requireAdminUser()
  /**
   * `requireAdminUser()` 内部的 join 是**每次请求现查库**，不是会话建立时的快照，
   * 所以「撤销管理员」在下一次请求即生效（`tests/integration/admin-session.test.ts`
   * 有回归用例守着）。这里只是把类型收窄成 `isAdmin: true`。
   */
  if (!user.isAdmin) throw notFound('页面不存在')
  return { ...user, isAdmin: true }
}

/**
 * 用于页面：返回 null 而非抛错（页面层自行 notFound()）。
 *
 * 用 `cache()` 包一层的原因：Next.js 的 layout 与 page **并行渲染**，
 * 因此 `app/admin/(protected)/layout.tsx` 里的守卫**无法阻止** page 组件执行。
 * 若 page 不在取数前自行守卫，未登录访问 `/admin` 会先打一次数据库查询、
 * 在日志里留下一条误导性的数据库错误（而响应本身仍是 404）。
 * `cache()` 让同一请求内的 layout 与 page 复用同一次鉴权结果，不产生额外查询。
 */
export const getAdminOrNull = cache(async (): Promise<AdminUser | null> => {
  try {
    return await requireAdmin()
  } catch {
    return null
  }
})
