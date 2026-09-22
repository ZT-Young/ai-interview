import Link from 'next/link'

import { DataRightsPanel } from '@/components/features/settings/data-rights-panel'
import { LogoutButton } from '@/components/features/auth/logout-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requirePageUser } from '@/lib/api/guard'
import { legalPath, listLegalDocuments } from '@/lib/legal/documents'
import { getEntitlements } from '@/lib/services/handlers/entitlement-service'

export const metadata = { title: '账户设置' }
export const dynamic = 'force-dynamic'

/**
 * 账户设置页。
 *
 * 数据权利的落点（AGENTS.md §7 C3）：导出与删除都在这里，用户可自助完成。
 * 同时在页脚集中展示合规文本入口（C1/C2/C4）。
 */
export default async function SettingsPage() {
  const user = await requirePageUser()
  const entitlements = await getEntitlements(user.id)
  const legalDocs = listLegalDocuments()

  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">账户设置</h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">账号概览</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">会员等级</span>
            <span>{entitlements.membership}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">剩余面试次数</span>
            <span className="tabular-nums">
              {entitlements.unlimitedInterviews ? '无限' : entitlements.freeCreditsLeft}
            </span>
          </div>
          <div className="pt-1">
            <LogoutButton />
          </div>
        </CardContent>
      </Card>

      <DataRightsPanel email={user.email} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">条款与说明</CardTitle>
          <CardDescription>你在注册时同意的内容都可以在这里查看</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          {legalDocs.map((doc) => (
            <Link
              key={doc.type}
              href={legalPath(doc.type)}
              className="underline underline-offset-4"
            >
              {doc.title}
            </Link>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}
