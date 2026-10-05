import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InviteForm } from '@/components/features/interviewer/invite-form'
import { requirePageUser } from '@/lib/api/guard'
import { listSharedWithMe } from '@/lib/services/handlers/share-service'
import { RoleSwitchCard } from '@/components/features/interviewer/role-switch-card'
import type { Role } from '@/components/features/auth/role-options'

export const metadata = { title: '面试官工作台' }
export const dynamic = 'force-dynamic'

/**
 * 面试官工作台（B 端，规格见 docs/design/INTERVIEWER_SIDE.md §4）。
 *
 * **合规边界**：本页不展示任何录用/排序结论，也不提供这类入口。
 * 能看到的只有「候选人主动授权给我的」练习报告。
 *
 * 身份是单值列（V1 取舍），因此求职者误入本页时不是报错，
 * 而是给出「切换到面试官身份」的入口 —— 同一个人完全可以上午练、下午看别人的。
 */
export default async function InterviewerHomePage() {
  const user = await requirePageUser()

  if (user.role !== 'interviewer') {
    return (
      <main className="container space-y-6 py-8">
        <h1 className="text-xl font-bold">面试官工作台</h1>
        <RoleSwitchCard currentRole={user.role as Role} />
      </main>
    )
  }

  const shares = await listSharedWithMe(user.id)

  return (
    <main className="container space-y-6 py-8" data-testid="interviewer-home">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">面试官工作台</h1>
        <p className="text-sm text-muted-foreground">
          候选人主动授权给你的练习报告会列在这里
        </p>
      </div>

      {/*
        AI 生成内容标识（AGENTS.md §7 C4）+ 用途边界（C5）。
        两个标识都必须常驻：这里的内容来自 AI 评分，
        若不写明「不构成录用建议」，它就很容易被当成筛选依据。
      */}
      <div
        role="note"
        data-testid="interviewer-compliance-note"
        className="rounded-md border px-3 py-2 text-xs text-muted-foreground"
      >
        报告内容为 AI 生成，仅供练习参考；且由候选人主动分享给你，
        <strong className="font-medium">不构成录用建议</strong>。
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">发起查看邀请</CardTitle>
          <CardDescription>
            填写候选人的邮箱 / 手机号 / 用户名发起请求，
            <strong className="font-medium">对方接受后你才能看到</strong>
            —— 在那之前这里不会出现任何候选人数据。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">已授权给我的报告</CardTitle>
          <CardDescription>共 {shares.length} 条；候选人可随时撤销</CardDescription>
        </CardHeader>
        <CardContent>
          {shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有候选人分享报告给你。发起邀请后，等对方接受即可。
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {shares.map((share) => (
                <li key={share.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    可见范围：{share.visibility === 'full' ? '完整报告' : '摘要'}
                    {share.note ? ` · 附言：${share.note}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    已查看 {share.viewCount} 次
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
