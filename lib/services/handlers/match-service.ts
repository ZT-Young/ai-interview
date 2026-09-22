import { buildMatchPrompt } from '@/lib/ai/prompts/parse'
import { matchParseSchema, type JdData, type MatchData, type ResumeData } from '@/lib/ai/schemas/parse'
import { parseError } from '@/lib/parsing/errors'
import type { LlmPort } from '@/lib/parsing/llm-port'
import { parseWithRetry } from '@/lib/parsing/run'
import { verifyMatchData } from '@/lib/parsing/verify'

import type { ParsedResult } from './parse-service'

/**
 * 匹配分析服务 —— 独立于解析服务。
 *
 * **为什么单独成文件**：解析服务会 import `lib/parsing/extract`，
 * 而后者引入 `pdf-parse` → `pdfjs-dist`。pdfjs 在 Next.js 的 server bundle 中
 * 加载即抛 `TypeError: Object.defineProperty called on non-object`，
 * 导致任何间接引用解析服务的路由整体 500（曾出现在 `/api/sessions/[id]/match`）。
 * 匹配分析只需要 LLM，拆开后该路由不再触碰 pdfjs。
 */

export async function matchResumeToJd(
  ports: { llm: LlmPort },
  input: { jd: JdData; resume: ResumeData },
): Promise<ParsedResult<MatchData>> {
  const prompt = buildMatchPrompt({
    jdJson: JSON.stringify(input.jd),
    resumeJson: JSON.stringify(input.resume),
  })

  const outcome = await parseWithRetry({
    llm: ports.llm,
    operation: 'match',
    system: prompt.system,
    user: prompt.user,
    schema: matchParseSchema,
  })

  const extraction = { source: 'text' as const, text: '', pageCount: 0, truncated: false }

  const baseMeta = (attempts: number, lowConfidence: string[]) => ({
    source: extraction.source,
    text_length: 0,
    page_count: 0,
    vision_used: false,
    low_confidence_fields: lowConfidence,
    prompt_version: '1.0',
    attempts,
    truncated: false,
  })

  if (!outcome.ok) {
    return {
      ok: false,
      code: outcome.code,
      error: outcome.error,
      meta: baseMeta(outcome.attempts, []),
      dropped: [],
    }
  }

  const verified = verifyMatchData(outcome.data.data)

  return {
    ok: true,
    data: verified.data,
    model: outcome.model,
    dropped: verified.dropped,
    meta: baseMeta(outcome.attempts, [
      ...outcome.lowConfidenceFields,
      ...verified.dropped.map((item) => item.path),
    ]),
  }
}

/** 便于上层统一错误文案 */
export { parseError }
