import {
  jdParseSchema,
  matchParseSchema,
  resumeParseSchema,
  isJdDataEmpty,
  isResumeDataEmpty,
  type ExtractionMeta,
  type JdData,
  type MatchData,
  type ResumeData,
} from '@/lib/ai/schemas/parse'
import { buildJdParsePrompt, buildMatchPrompt, buildResumeParsePrompt } from '@/lib/ai/prompts/parse'
import {
  extractDocument,
  MAX_TEXT_LENGTH,
  type ExtractionResult,
} from '@/lib/parsing/extract'
import { parseError, type ParseError, type ParseErrorCode } from '@/lib/parsing/errors'
import { OpenAiCompatibleLlm, type LlmPort } from '@/lib/parsing/llm-port'
import { createStorage } from '@/lib/storage'
import { parseWithRetry } from '@/lib/parsing/run'
import { verifyJdData, verifyMatchData, verifyResumeData, type DroppedItem } from '@/lib/parsing/verify'
import type { StoragePort } from '@/lib/storage/s3'
import { SCHEMA_VERSION } from '@/lib/ai/schemas/parse'

/**
 * 解析领域服务 —— ③ 领域服务层。
 *
 * 组合流程：抽取文本 → AI 结构化 → schema 校验（含重试）→ 后置过滤。
 * **不访问数据库**：落库由接口层调用 Phase 1 的 CRUD 完成。
 * LlmPort / StoragePort 通过参数注入，测试可替换为 fake（无需真实 AI 与 S3）。
 */

export interface ParsePorts {
  llm: LlmPort
  storage: StoragePort
}

/**
 * 生产环境的默认端口实现。
 *
 * 存储走 `createStorage()` 工厂而不是直接 `new S3Storage()`：
 * 后者在缺少 S3 配置时会在**构造期**抛错（且历史上是裸 Error → 被兜底成 500），
 * 工厂在开发环境会回退本地文件系统，并使「未配置」这种情况抛出可识别的
 * `StorageUnavailableError`，由调用方映射为 503。
 */
export function createDefaultPorts(): ParsePorts {
  return { llm: new OpenAiCompatibleLlm(), storage: createStorage() }
}

export interface ParsedSuccess<T> {
  ok: true
  data: T
  meta: ExtractionMeta
  model: string
  /** 被后置过滤丢弃的条目，写入审计日志 */
  dropped: DroppedItem[]
}

export interface ParsedFailure {
  ok: false
  code: ParseErrorCode
  error: ParseError
  meta: ExtractionMeta
  model?: string
  dropped: DroppedItem[]
}

export type ParsedResult<T> = ParsedSuccess<T> | ParsedFailure

function metaOf(input: {
  extraction: ExtractionResult
  attempts: number
  lowConfidence: string[]
}): ExtractionMeta {
  return {
    source: input.extraction.source,
    text_length: input.extraction.text.length,
    page_count: input.extraction.pageCount,
    vision_used: input.extraction.source === 'image',
    low_confidence_fields: input.lowConfidence,
    prompt_version: SCHEMA_VERSION,
    attempts: input.attempts,
    truncated: input.extraction.truncated,
  }
}

/** 抽取失败时的兜底 meta（source 取 text，长度 0） */
function emptyMeta(): ExtractionMeta {
  return {
    source: 'text',
    text_length: 0,
    page_count: 0,
    vision_used: false,
    low_confidence_fields: [],
    prompt_version: SCHEMA_VERSION,
    attempts: 0,
    truncated: false,
  }
}

async function extractFromStorage(
  ports: ParsePorts,
  input: { storageKey: string; fileName: string; mimeType?: string | null },
): Promise<ExtractionResult | ParsedFailure> {
  let buffer: Buffer
  try {
    buffer = await ports.storage.getObject(input.storageKey)
  } catch (error) {
    const failure = parseError('corrupted_file', { cause: error })
    return { ok: false, code: failure.code, error: failure, meta: emptyMeta(), dropped: [] }
  }

  try {
    return await extractDocument({ buffer, fileName: input.fileName, mimeType: input.mimeType })
  } catch (error) {
    const failure =
      error instanceof Error && 'userMessage' in error
        ? (error as ParseError)
        : parseError('corrupted_file', { cause: error })
    return {
      ok: false,
      code: failure.code,
      error: failure,
      meta: { ...emptyMeta(), source: 'pdf' },
      dropped: [],
    }
  }
}

/* ------------------------------------------------------------------ *
 * JD 解析
 * ------------------------------------------------------------------ */

export async function parseJdFile(
  ports: ParsePorts,
  input: { storageKey: string; fileName: string; mimeType?: string | null },
): Promise<ParsedResult<JdData>> {
  const extraction = await extractFromStorage(ports, input)
  if ('ok' in extraction) return extraction

  return parseJdFromExtraction(ports, extraction)
}

/** 直接解析已抽取的内容（粘贴文本场景，无需 S3） */
export async function parseJdText(
  ports: ParsePorts,
  text: string,
): Promise<ParsedResult<JdData>> {
  if (text.trim().length < 10) {
    const failure = parseError('text_too_short')
    return { ok: false, code: failure.code, error: failure, meta: emptyMeta(), dropped: [] }
  }
  return parseJdFromExtraction(ports, {
    source: 'text',
    text: text.slice(0, MAX_TEXT_LENGTH),
    pageCount: 0,
    truncated: text.length > MAX_TEXT_LENGTH,
  })
}

async function parseJdFromExtraction(
  ports: ParsePorts,
  extraction: ExtractionResult,
): Promise<ParsedResult<JdData>> {
  const prompt = buildJdParsePrompt({
    text: extraction.text,
    fromImage: extraction.source === 'image',
  })

  const outcome = await parseWithRetry({
    llm: ports.llm,
    operation: 'parse_jd',
    system: prompt.system,
    user: prompt.user,
    images: extraction.imageBase64
      ? [{ base64: extraction.imageBase64, mimeType: extraction.imageMimeType ?? 'image/png' }]
      : undefined,
    schema: jdParseSchema,
    isEmpty: (data) => isJdDataEmpty(data as JdData),
  })

  if (!outcome.ok) {
    return {
      ok: false,
      code: outcome.code,
      error: outcome.error,
      meta: metaOf({ extraction, attempts: outcome.attempts, lowConfidence: [] }),
      dropped: [],
    }
  }

  const verified = verifyJdData(outcome.data.data)
  if (isJdDataEmpty(verified.data)) {
    const failure = parseError('ai_invalid_output')
    return {
      ok: false,
      code: failure.code,
      error: failure,
      meta: metaOf({ extraction, attempts: outcome.attempts, lowConfidence: [] }),
      dropped: verified.dropped,
    }
  }

  return {
    ok: true,
    data: verified.data,
    model: outcome.model,
    dropped: verified.dropped,
    meta: metaOf({
      extraction,
      attempts: outcome.attempts,
      lowConfidence: [...outcome.lowConfidenceFields, ...verified.dropped.map((item) => item.path)],
    }),
  }
}

/* ------------------------------------------------------------------ *
 * 简历解析
 * ------------------------------------------------------------------ */

export async function parseResumeFile(
  ports: ParsePorts,
  input: { storageKey: string; fileName: string; mimeType?: string | null },
): Promise<ParsedResult<ResumeData>> {
  const extraction = await extractFromStorage(ports, input)
  if ('ok' in extraction) return extraction

  return parseResumeFromExtraction(ports, extraction)
}

/**
 * 直接解析**已粘贴的简历文本**（无需读取存储）。
 *
 * 与 `parseJdText` 对应：让「粘贴文本」成为与「上传文件」等价的一等输入
 * （AGENTS.md §2 第 3 步要求上传简历，但粘贴同样是最小可用输入路径）。
 *
 * 注意：结构化（技能/项目/学历）**必须调用模型**，因此没有 LLM 时会返回
 * `ai_unavailable`——调用方应保留记录并提示用户手动填写，而不是丢弃数据。
 */
export async function parseResumeText(
  ports: ParsePorts,
  text: string,
): Promise<ParsedResult<ResumeData>> {
  if (text.trim().length < 10) {
    const failure = parseError('text_too_short')
    return { ok: false, code: failure.code, error: failure, meta: emptyMeta(), dropped: [] }
  }

  return parseResumeFromExtraction(ports, {
    source: 'text',
    text: text.slice(0, MAX_TEXT_LENGTH),
    pageCount: 0,
    truncated: text.length > MAX_TEXT_LENGTH,
  })
}

async function parseResumeFromExtraction(
  ports: ParsePorts,
  extraction: ExtractionResult,
): Promise<ParsedResult<ResumeData>> {
  const prompt = buildResumeParsePrompt({
    text: extraction.text,
    fromImage: extraction.source === 'image',
  })

  const outcome = await parseWithRetry({
    llm: ports.llm,
    operation: 'parse_resume',
    system: prompt.system,
    user: prompt.user,
    images: extraction.imageBase64
      ? [{ base64: extraction.imageBase64, mimeType: extraction.imageMimeType ?? 'image/png' }]
      : undefined,
    schema: resumeParseSchema,
    isEmpty: (data) => isResumeDataEmpty(data as ResumeData),
  })

  if (!outcome.ok) {
    return {
      ok: false,
      code: outcome.code,
      error: outcome.error,
      meta: metaOf({ extraction, attempts: outcome.attempts, lowConfidence: [] }),
      dropped: [],
    }
  }

  // 图片场景无原文，「原文一致性」检查自动跳过（hasSource 为 false）
  const verified = verifyResumeData(outcome.data.data, extraction.text)
  if (isResumeDataEmpty(verified.data)) {
    const failure = parseError('ai_invalid_output')
    return {
      ok: false,
      code: failure.code,
      error: failure,
      meta: metaOf({ extraction, attempts: outcome.attempts, lowConfidence: [] }),
      dropped: verified.dropped,
    }
  }

  return {
    ok: true,
    data: verified.data,
    model: outcome.model,
    dropped: verified.dropped,
    meta: metaOf({
      extraction,
      attempts: outcome.attempts,
      lowConfidence: [...outcome.lowConfidenceFields, ...verified.dropped.map((item) => item.path)],
    }),
  }
}

/* ------------------------------------------------------------------ *
 * 匹配分析已移至 lib/services/match-service.ts
 *
 * 原因：本文件 import 了 lib/parsing/extract（pdf-parse → pdfjs-dist），
 * 而 pdfjs 在 Next.js server bundle 中加载即抛
 * `TypeError: Object.defineProperty called on non-object`，
 * 会让仅需匹配分析的路由整体 500。
 * ------------------------------------------------------------------ */
