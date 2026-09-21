import { Compass } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

/**
 * 全站 404。
 *
 * 此前访问不存在的地址会落到 Next.js 内置页面：
 * 英文「404 This page could not be found.」+ 系统默认字体，
 * 与产品语言和中文字体完全脱节，用户会以为站点挂了。
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-muted text-primary">
        <Compass className="size-6" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">页面不存在</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          该地址可能已失效，或链接输入有误。你可以回到首页继续准备面试。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/">回到首页</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sessions">我的面试记录</Link>
        </Button>
      </div>
    </main>
  )
}
