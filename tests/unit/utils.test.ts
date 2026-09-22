import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils/index'

describe('cn', () => {
  it('合并类名', () => {
    expect(cn('px-2', 'text-sm')).toBe('px-2 text-sm')
  })

  it('冲突的 Tailwind 类以后者为准', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('忽略假值', () => {
    expect(cn('p-1', false && 'hidden', undefined, null, 'm-1')).toBe('p-1 m-1')
  })

  it('支持条件对象写法', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active')
  })
})
