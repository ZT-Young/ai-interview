import Link from 'next/link'

/**
 * 认证区布局（`/login` 与 `/register` 共用）。
 *
 * 为什么做成**独立全屏分栏页**而不是普通居中窄栏：
 * 未登录访客进入产品的第一站就是它（`/` 会重定向到 `/login`），
 * 它需要独立承担「这是什么产品、值不值得注册」的说明职责，
 * 左栏品牌面板即为此存在；窄屏下自动收敛为单栏，
 * 避免 375px 出现横向滚动。
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* 左：品牌面板（仅大屏） */}
      <div className="relative isolate hidden overflow-hidden bg-gradient-to-br from-primary to-primary/60 p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-16 top-1/4 size-72 rounded-full bg-primary-foreground/10 blur-3xl" />
          <div className="absolute -right-10 bottom-0 size-64 rounded-full bg-primary-foreground/10 blur-3xl" />
        </div>

        <div className="space-y-2">
          <Link href="/intro" className="text-lg font-semibold">
            AI 模拟面试
          </Link>
          <p className="max-w-xs text-sm text-primary-foreground/80">
            粘贴岗位 JD、上传简历，让 AI 面试官陪你练一遍。
          </p>
        </div>

        <ul className="space-y-3 text-sm">
          {[
            '针对你的简历与 JD 生成专属面试计划',
            '像真实面试官一样追问细节、拉回跑题',
            '结束后给出六维评分与可执行的提升建议',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-primary-foreground/80"
              />
              <span className="text-primary-foreground/90">{item}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-primary-foreground/70">
          AI 生成内容 · 仅供练习参考，不构成任何录用判断
        </p>
      </div>

      {/* 右：表单区 */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6">
          {/* 窄屏下左栏隐藏，这里补上品牌头 */}
          <div className="space-y-2 text-center lg:hidden">
            <Link href="/intro" className="text-xl font-semibold">
              AI 模拟面试
            </Link>
            <p className="text-sm text-muted-foreground">
              粘贴岗位 JD、上传简历，让 AI 面试官陪你练一遍。
            </p>
          </div>

          {children}

          <p className="text-center text-xs text-muted-foreground">
            <Link href="/intro" className="underline underline-offset-4">
              先了解产品
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
