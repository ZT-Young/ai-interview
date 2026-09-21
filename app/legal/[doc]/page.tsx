import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getLegalDocumentBySlug, legalPath, listLegalDocuments } from '@/lib/legal/documents'

/**
 * 合规文本页（AGENTS.md §7 C1/C2/C4）。
 *
 * 路径按 **slug**（连字符），例如 `/legal/ai-disclosure`；
 * 而库里的枚举值是 `ai_disclosure`（下划线）—— 两者由 `LEGAL_SLUGS` 映射，见 lib/legal/documents.ts。
 */
export const dynamic = 'force-static'

export function generateStaticParams() {
  return listLegalDocuments().map((doc) => ({ doc: doc.slug }))
}

export function generateMetadata({ params }: { params: { doc: string } }): Metadata {
  const document = getLegalDocumentBySlug(params.doc)
  return { title: document ? document.title : '合规说明' }
}

export default function LegalPage({ params }: { params: { doc: string } }) {
  const document = getLegalDocumentBySlug(params.doc)
  if (!document) notFound()

  const others = listLegalDocuments().filter((item) => item.type !== document.type)

  return (
    <main className="container max-w-3xl space-y-6 py-10" data-testid="legal-page">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{document.title}</h1>
        <p className="text-sm text-muted-foreground">
          版本 {document.version} · 生效日期 {document.effectiveDate}
        </p>
        <p className="text-sm text-muted-foreground">{document.summary}</p>
      </div>

      <div className="space-y-4">
        {document.sections.map((section) => (
          <Card key={section.heading}>
            <CardHeader>
              <CardTitle className="text-base">{section.heading}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed">
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {document.type === 'privacy' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">行使你的权利</CardTitle>
            <CardDescription>导出与删除都可以自助完成</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <Link href="/settings" className="underline underline-offset-4">
              前往账户设置导出或删除数据
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <nav className="flex flex-wrap gap-4 text-sm">
        {others.map((item) => (
          <Link
            key={item.type}
            href={legalPath(item.type)}
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {item.title}
          </Link>
        ))}
      </nav>
    </main>
  )
}
