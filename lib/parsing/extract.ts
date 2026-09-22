import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

import { parseError } from './errors'

/**
 * 文档文本抽取 —— 对应 docs/engineering/AI_PROMPTS.md §4 的 source 取值。
 *
 * - PDF：pdf-parse v2（PDFParse class），抽取文字层
 * - DOCX：mammoth.extractRawText
 * - 图片：不做本地 OCR，交给视觉 LLM 直读（decision: 视觉优先）
 * - doc（旧版二进制 Word）：不在 V1 范围，明确提示用户另存为 docx
 */

/** 单个文件大小上限：20MB（与 lib/validators/resume.ts 保持一致） */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** 抽取出的文本下限；低于此值视为未能识别的扫描件 */
const MIN_TEXT_LENGTH = 30

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  txt: 'text/plain',
  md: 'text/markdown',
}

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index === -1 ? '' : fileName.slice(index + 1).toLowerCase()
}

export function mimeTypeOf(fileName: string, provided?: string | null): string | undefined {
  if (provided && provided !== 'application/octet-stream') return provided
  return MIME_BY_EXTENSION[extensionOf(fileName)]
}

export type ExtractSource = 'pdf' | 'docx' | 'image' | 'text'

export interface ExtractionResult {
  source: ExtractSource
  /** 抽取到的纯文本；图片为空（交由视觉模型直读） */
  text: string
  pageCount: number
  /** 图片的 base64 数据，供视觉模型使用 */
  imageBase64?: string
  imageMimeType?: string
  /** 文本是否被截断（超出模型上下文上限） */
  truncated: boolean
}

/**
 * 模型上下文保护：过长文本按字符截断。
 * 截断会置 truncated=true，前端据此提示用户"解析可能不完整"。
 */
export const MAX_TEXT_LENGTH = 60_000

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_LENGTH) return { text, truncated: false }
  return { text: text.slice(0, MAX_TEXT_LENGTH), truncated: true }
}

/**
 * 清洗 pdf-parse 输出：移除其自动附加的 `-- n of m --` 页码分隔行，
 * 这些噪声会干扰模型对版式的理解。
 */
function cleanPdfText(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  let text = ''
  let pageCount = 0

  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText()
      text = cleanPdfText(result.text ?? '')
      pageCount = result.total ?? 0
    } finally {
      await parser.destroy()
    }
  } catch (error) {
    throw parseError('corrupted_file', { cause: error })
  }

  if (text.length < MIN_TEXT_LENGTH) {
    // 常见于扫描版 PDF：没有文字层，需要用户改用图片走视觉识别
    throw parseError('no_text_layer')
  }

  const truncatedResult = truncate(text)
  return { source: 'pdf', text: truncatedResult.text, pageCount, truncated: truncatedResult.truncated }
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  let text = ''
  try {
    const result = await mammoth.extractRawText({ buffer })
    text = (result.value ?? '').trim()
  } catch (error) {
    throw parseError('corrupted_file', { cause: error })
  }

  if (text.length < MIN_TEXT_LENGTH) {
    throw parseError('no_text_layer')
  }

  const truncatedResult = truncate(text)
  return { source: 'docx', text: truncatedResult.text, pageCount: 0, truncated: truncatedResult.truncated }
}

function extractImage(buffer: Buffer, mimeType: string): ExtractionResult {
  return {
    source: 'image',
    text: '',
    pageCount: 1,
    imageBase64: buffer.toString('base64'),
    imageMimeType: mimeType,
    truncated: false,
  }
}

function extractPlainText(buffer: Buffer): ExtractionResult {
  const text = buffer.toString('utf8').trim()
  if (text.length < MIN_TEXT_LENGTH) {
    throw parseError('text_too_short')
  }
  const truncatedResult = truncate(text)
  return { source: 'text', text: truncatedResult.text, pageCount: 0, truncated: truncatedResult.truncated }
}

/**
 * 按文件类型抽取内容。失败时抛 ParseError（带用户可读文案）。
 */
export async function extractDocument(input: {
  buffer: Buffer
  fileName: string
  mimeType?: string | null
}): Promise<ExtractionResult> {
  const { buffer, fileName } = input

  if (buffer.byteLength === 0) throw parseError('corrupted_file')
  if (buffer.byteLength > MAX_FILE_BYTES) throw parseError('corrupted_file')

  const extension = extensionOf(fileName)
  const mimeType = mimeTypeOf(fileName, input.mimeType) ?? ''

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return extractPdf(buffer)
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === 'docx'
  ) {
    return extractDocx(buffer)
  }

  if (extension === 'doc' || mimeType === 'application/msword') {
    // 旧版二进制 .doc 不在 V1 范围，明确提示而不是尝试解析出乱码
    throw parseError('not_in_scope')
  }

  if (mimeType.startsWith('image/')) {
    return extractImage(buffer, mimeType)
  }

  if (mimeType.startsWith('text/') || extension === 'txt' || extension === 'md') {
    return extractPlainText(buffer)
  }

  throw parseError('unsupported_type')
}
