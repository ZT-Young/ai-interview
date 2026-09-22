import { Card, CardContent } from '@/components/ui/card'

/** 面试房间加载态骨架屏（docs/design/UI.md §3） */
export default function InterviewLoading() {
  return (
    <main className="container max-w-3xl space-y-4 py-6" aria-busy="true" aria-live="polite">
      <div className="h-6 w-24 animate-pulse rounded bg-muted" />

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </div>

      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="h-16 flex-1 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex justify-end">
          <div className="h-10 w-2/3 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="h-20 w-full animate-pulse rounded bg-muted" />
          <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">正在加载面试进度…</p>
    </main>
  )
}
