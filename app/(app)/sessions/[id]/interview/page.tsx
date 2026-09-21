import { InterviewConsole, type Step } from '@/components/features/interview/interview-console'
import { ApiError } from '@/lib/api/errors'
import { requirePageUser } from '@/lib/api/guard'
import { getNextQuestion, listMessages } from '@/lib/services/orchestration-service'

export const metadata = { title: '面试房间' }
export const dynamic = 'force-dynamic'

/**
 * 面试房间页（docs/UI.md §4）。
 *
 * 服务端在渲染时恢复进度（`getNextQuestion` + `currentQuestionId`）：
 * - 会话尚未生成计划 → 422，展示引导
 * - 进行中 → 返回当前唯一一道题
 * - 已结束 → finished: true
 *
 * 加载态由 `loading.tsx` 提供；错误态在本页处理。
 */
export default async function InterviewPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser()

  let step: Step = {
    phase: 'IDLE',
    message: null,
    question: null,
    progress: { answered: 0, total: 0 },
    finished: false,
  }
  let loadError: string | null = null

  try {
    step = (await getNextQuestion(user.id, params.id)) as Step
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0

    if (status === 422) {
      loadError = '该会话还没有面试计划，请先到面试计划页生成计划。'
    } else if (status === 404) {
      loadError = '面试会话不存在或无权访问。'
    } else {
      loadError = '无法加载面试进度，请稍后重试。'
    }
  }

  const messages = loadError ? [] : await listMessages(user.id, params.id)

  return (
    <main className="container max-w-3xl space-y-4 py-6 pb-24">
      <h1 className="text-xl font-bold">模拟面试</h1>

      {loadError ? (
        <div
          role="alert"
          data-testid="interview-load-error"
          className="space-y-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-3 text-sm text-destructive"
        >
          <p>{loadError}</p>
          <a href={`/sessions/${params.id}`} className="underline underline-offset-4">
            返回面试计划页
          </a>
        </div>
      ) : (
        <InterviewConsole sessionId={params.id} initialStep={step} />
      )}

      {!loadError ? (
        <p className="text-xs text-muted-foreground">本场面试已持久化 {messages.length} 条消息。</p>
      ) : null}
    </main>
  )
}
