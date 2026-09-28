import type { AgentToolCall, AgentToolName } from '@/lib/ai/schemas/interview-agent'

/**
 * 面试官 Agent 的工具集 —— **纯函数检索**，不产生任何副作用。
 *
 * 为什么不让模型直接拿到全部简历与 JD：
 * 1. 上下文越长越贵（看板显示 plan 的 P50 已近 20 秒，长 prompt 是主因之一）
 * 2. 全量塞入会让模型抓不住重点，反而更容易问出泛泛的问题
 * 3. **检索行为本身是可观测的**：工具调用序列写进消息 metadata，
 *    事后能回答「它为什么追问这个」，这是纯 prompt 方案做不到的
 *
 * 工具执行失败**不抛异常**，而是把错误作为观察结果回灌给模型 ——
 * 让模型自己纠正（换关键词、换工具），这正是 agent 相对单次调用的价值。
 */

export interface AgentContext {
  /** 简历结构化数据（resumes.parsedData） */
  resume: unknown
  /** JD 结构化数据（job_jds.parsedData） */
  jd: unknown
  /** 当前主问题 */
  mainQuestion: string
  /** 用户本次回答 */
  currentAnswer: string
  /** 当前主问题链上的历史问答（含本次） */
  history: Array<{ question: string; answer: string; depth: number }>
  /** 本场已问过的题目（用于避免重复提问） */
  askedQuestions: string[]
}

export interface ToolResult {
  name: AgentToolName
  argument: string
  ok: boolean
  output: string
}

/** 单条检索结果截断长度，控制 prompt 体积 */
const SNIPPET_MAX = 200

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 把任意结构化数据摊平成「标签: 文本」列表，供关键词检索 */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return value.length > 0 ? [`${prefix}${value}`] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [`${prefix}${String(value)}`]
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, prefix ? `${prefix}${index + 1}.` : ''))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}${key}: ` : `${key}: `))
  }
  return []
}

function matchSnippets(texts: string[], keyword: string, limit: number): string[] {
  const needle = keyword.trim().toLowerCase()
  const pool = needle.length === 0 ? texts : texts.filter((text) => text.toLowerCase().includes(needle))
  const source = pool.length > 0 ? pool : texts
  return source.slice(0, limit).map((text) => (text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX)}…` : text))
}

function searchResume(context: AgentContext, keyword: string): string {
  const texts = flatten(context.resume)
  if (texts.length === 0) return '（未关联简历，无法检索候选人经历）'
  const snippets = matchSnippets(texts, keyword, 3)
  return `简历相关片段：\n${snippets.map((item) => `- ${item}`).join('\n')}`
}

function searchJd(context: AgentContext, keyword: string): string {
  const parsed = context.jd as { must_have?: unknown; responsibilities?: unknown; requirements?: unknown } | null
  const texts = [
    ...asStringArray(parsed?.must_have).map((item) => `硬性要求: ${item}`),
    ...asStringArray(parsed?.responsibilities).map((item) => `职责: ${item}`),
    ...asStringArray(parsed?.requirements).map((item) => `要求: ${item}`),
  ]
  if (texts.length === 0) texts.push(...flatten(context.jd))
  if (texts.length === 0) return '（未关联岗位 JD，无法检索岗位要求）'

  const snippets = matchSnippets(texts, keyword, 4)
  return `岗位要求相关条目：\n${snippets.map((item) => `- ${item}`).join('\n')}`
}

function recentAnswers(context: AgentContext): string {
  const items = context.history.slice(-3)
  if (items.length === 0) return '（暂无历史问答）'
  return items
    .map((item) => `[追问层级 ${item.depth}] 问：${item.question}\n答：${item.answer.slice(0, 300)}`)
    .join('\n\n')
}

function askedQuestions(context: AgentContext): string {
  if (context.askedQuestions.length === 0) return '（本场还没有问过其他题目）'
  return context.askedQuestions
    .slice(-8)
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n')
}

/** 执行一个工具调用；未知工具或异常都转成「可回灌的观察结果」 */
export function executeTool(call: AgentToolCall, context: AgentContext): ToolResult {
  try {
    switch (call.name) {
      case 'search_resume':
        return { name: call.name, argument: call.argument, ok: true, output: searchResume(context, call.argument) }
      case 'search_jd':
        return { name: call.name, argument: call.argument, ok: true, output: searchJd(context, call.argument) }
      case 'recent_answers':
        return { name: call.name, argument: '', ok: true, output: recentAnswers(context) }
      case 'asked_questions':
        return { name: call.name, argument: '', ok: true, output: askedQuestions(context) }
      default:
        return { name: call.name, argument: call.argument, ok: false, output: `未知工具：${String(call.name)}` }
    }
  } catch (error) {
    return {
      name: call.name,
      argument: call.argument,
      ok: false,
      output: `工具执行失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** 工具清单（写进 prompt，让模型知道可用什么） */
export const TOOL_DESCRIPTIONS: Array<{ name: AgentToolName; description: string }> = [
  { name: 'search_resume', description: '按关键词检索候选人简历中的真实经历、技能、项目（没把握时用它确认细节，避免编造）' },
  { name: 'search_jd', description: '按关键词检索岗位 JD 的硬性要求与职责（判断跑题、把话题拉回岗位要求时用）' },
  { name: 'recent_answers', description: '查看当前这道题此前的问答（判断信息是否已经充分、是否该换角度追问）' },
  { name: 'asked_questions', description: '查看本场已经问过的题目，避免重复提问' },
]
