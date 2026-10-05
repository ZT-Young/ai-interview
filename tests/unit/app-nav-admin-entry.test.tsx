/**
 * @vitest-environment jsdom
 *
 * 用户端导航里的**后台入口**可见性测试。
 *
 * 为什么值得单独测：用户端与管理端分离后，后台入口的显示条件从
 * 「账号 `is_admin`」收紧为「**确实持有管理端会话**」。
 * 这个条件很容易被改回去（改成 `user.isAdmin` 后类型依然合法、页面依然能跑），
 * 但语义就错了 —— 管理员作为普通用户使用时，界面上不该有任何后台痕迹。
 *
 * 因此这里用组件渲染把行为钉住：只要「后台」两个字出现在没有管理端会话的
 * 用户端导航里，测试就红。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

import { AppNav, type AppNavUser } from '@/components/layout/app-nav'

const candidate: AppNavUser = {
  email: 'candidate@example.test',
  username: '候选人',
  name: null,
  membership: 'free',
  freeCredits: 1,
  role: 'candidate',
  hasAdminSession: false,
}

/** 当前 DOM 里所有链接的 href —— 桌面导航与移动抽屉都在这个集合里 */
function renderedHrefs(): (string | null)[] {
  return Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'))
}

function renderNav(user: AppNavUser) {
  render(<AppNav user={user} />)
}

describe('用户端导航的后台入口', () => {
  it('没有管理端会话时，桌面导航与移动抽屉都不出现 /admin', () => {
    renderNav(candidate)

    expect(renderedHrefs()).not.toContain('/admin')
    expect(screen.queryByText('后台')).toBeNull()

    // 展开移动抽屉再看一遍：抽屉是一套独立的 JSX，容易被漏改
    fireEvent.click(screen.getByTestId('nav-toggle'))
    expect(renderedHrefs()).not.toContain('/admin')
    expect(screen.queryByText('后台')).toBeNull()
  })

  it('持有管理端会话时才出现「后台」入口', () => {
    renderNav({ ...candidate, hasAdminSession: true })

    expect(renderedHrefs()).toContain('/admin')
  })

  it('面试官身份下也不出现后台入口（入口可见性只由管理端会话决定）', () => {
    renderNav({ ...candidate, role: 'interviewer' })

    expect(renderedHrefs()).toContain('/interviewer')
    expect(renderedHrefs()).not.toContain('/admin')
  })
})
