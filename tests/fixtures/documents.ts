import { strToU8, zipSync } from 'fflate'

/**
 * 测试文件夹具 —— 使用**真实格式**构造，不用假数据冒充。
 *
 * - PDF：手工拼装最小合法 PDF（Helvetica 内联，正交文本）
 * - DOCX：用 fflate 打包最小 OOXML（Word 可识别的结构）
 *
 * 这样 `extractDocument` 走的是真实解析库，测试才有意义。
 */

/** 构造最小合法 PDF，包含给定的 ASCII 文本 */
export function buildPdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  const stream = `BT /F1 12 Tf 20 50 Td (${escaped}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const object of objects) {
    offsets.push(pdf.length)
    pdf += object
  }

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

/** 构造最小 DOCX（OOXML zip），包含给定段落文本 */
export function buildDocx(paragraphs: string[]): Buffer {
  const escapeXml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const body = paragraphs
    .map(
      (text) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join('')

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body>
</w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(documentXml),
  })

  return Buffer.from(zipped)
}

/** 1x1 像素 PNG（真实图片字节，供视觉管线测试） */
export function buildPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

/** 足够长的示例简历文本（用于原文一致性校验与 docx 抽取） */
export const SAMPLE_RESUME_TEXT = [
  '张伟  后端开发工程师',
  '技能：TypeScript、PostgreSQL、Node.js、Docker',
  '项目：AI 面试平台',
  '负责面试流程编排与评分服务开发，使用 TypeScript 与 PostgreSQL 实现题库与报告模块。',
  '结果：接口 P95 延迟从 800ms 降至 220ms，覆盖 300+ 自动化用例。',
].join('\n')

/** 足够长的示例 JD 文本 */
export const SAMPLE_JD_TEXT =
  '岗位职责：负责 AI 应用后端开发与性能优化，参与题库与评分服务设计。' +
  '任职资格：3 年以上 Node.js 开发经验，熟悉 TypeScript 与 PostgreSQL，具备分布式系统经验。' +
  '加分项：有 LLM 应用落地经验者优先。'
