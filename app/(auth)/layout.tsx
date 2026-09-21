import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="container flex min-h-dvh flex-col justify-center py-12">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <Link href="/" className="text-xl font-semibold">
            AI 模拟面试
          </Link>
          <p className="text-sm text-muted-foreground">
            粘贴岗位 JD、上传简历，让 AI 面试官陪你练一遍。
          </p>
        </div>
        {children}
      </div>
    </main>
  )
}
