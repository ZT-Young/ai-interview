import Link from 'next/link'

import { AppNav, type AppNavUser } from '@/components/layout/app-nav'
import { optionalAdminUser, optionalUser } from '@/lib/api/guard'
import { isFreeMode } from '@/lib/config/free-mode'

/**
 * 已登录区域的顶部导航（服务端组件）。
 *
 * 为什么单独抽成组件而不是写在 `(app)/layout.tsx` 里：
 * 布局需要保持轻薄，而这里要做「取用户 → 组装视图模型」的数据准备。
 * `optionalUser()` 返回的对象已包含 email / name / membership / freeCredits，
 * 因此**不需要**额外查库（曾经考虑过调 getEntitlements，但那会多一次查询）。
 */
export async function AppHeader() {
  const user = await optionalUser()
  if (!user) return null

  /**
   * 后台入口只在**确实持有管理端会话**时出现。
   *
   * 与 `user.isAdmin` 的区别很关键：管理员用用户端账号登录时 `isAdmin` 仍为 true，
   * 但此时 TA 是作为普通用户在用产品 —— 用户端界面不该出现任何后台痕迹。
   * （真正的访问控制始终在服务端，这里只是不给人看不该看的东西。）
   */
  const adminSession = await optionalAdminUser()

  const viewUser: AppNavUser = {
    email: user.email,
    username: user.username,
    name: user.name,
    membership: user.membership,
    freeCredits: user.freeCredits,
    role: user.role,
    hasAdminSession: adminSession !== null,
  }

  return (
    <>
      {/* 免费模式下隐藏会员入口与剩余次数（服务端判定，前端不做门禁决策） */}
      <AppNav user={viewUser} freeMode={isFreeMode()} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-16 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        跳到主要内容
      </a>
    </>
  )
}

/** 页脚：合规标识与法务入口（AGENTS.md §7 C2 / C4） */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t bg-card/40">
      <div className="container flex flex-wrap items-center gap-x-4 gap-y-2 py-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-1.5 rounded-full bg-warning"
            aria-hidden="true"
          />
          AI 生成内容 · 仅供练习参考，不构成任何录用判断
        </span>
        <span className="hidden sm:inline text-border" aria-hidden="true">
          |
        </span>
        <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
          隐私政策
        </Link>
        <Link href="/legal/terms" className="transition-colors hover:text-foreground">
          用户协议
        </Link>
        <Link href="/legal/ai-disclosure" className="transition-colors hover:text-foreground">
          AI 生成内容说明
        </Link>
      </div>
    </footer>
  )
}
