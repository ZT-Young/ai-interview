import { SCHEMA_VERSION } from '../schemas/parse'
import type { PromptTemplate } from './parse'

/**
 * 追问与提示的 prompt —— docs/engineering/AI_PROMPTS.md §5.2 / §5.5 的代码实现。
 */

export interface FollowUpPromptInput {
  /** 当前主问题内容 */
  question: string
  /** 用户本次回答 */
  answer: string
  /** 简历与岗位要点，用于判断跑题并把话题拉回要求 */
  context: string
  /** 当前已追问层数（供模型参考，最终上限由服务端强制） */
  depth: number
  /** 服务端已判定的确定性原因（如 too_short） */
  forcedReason?: 'too_short' | 'vague' | 'off_topic'
}

const REASON_HINT: Record<string, string> = {
  too_short: '候选人本次回答过短、信息量不足，请就其回答中提到的内容追问具体细节。',
  vague: '候选人本次回答较为笼统，请追问具体做法或细节。',
  off_topic: '候选人本次回答偏离了当前岗位要求，请把话题拉回下方给出的岗位要求。',
}

export function buildFollowUpPrompt(input: FollowUpPromptInput): PromptTemplate {
  const dataSchema = `{
  "action": "follow_up 或 next_question",
  "follow_up": "string 或 null，追问内容（单个问题，最多 300 字）",
  "reason": "vague | too_short | off_topic | good_enough",
  "focus": "string，你依据的回答片段（逐字摘录，最多 300 字）"
}`

  return {
    system: `你是面试官，正在进行一场模拟面试。请判断是否需要就候选人的回答继续追问。

严格遵守：
1. 若需要追问，只输出**一个**问题，不得包含多个小问。
2. 追问必须基于候选人**本次回答中出现的具体内容**（模糊、缺少细节、无量化数据之处），
   并在 focus 中逐字摘录你依据的那段回答文字。
3. 若回答已经具体充分，或追问已无必要，输出 action = "next_question"，follow_up 为 null。
4. 若回答偏离当前岗位要求，输出 reason = "off_topic"，
   追问必须把话题**拉回 JD 要求**（见下方简历与岗位要点），语气保持中立。
5. **禁止**任何涉及年龄、性别、婚育、宗教、政治的问题。
6. **禁止**编造候选人未提及的经历、公司、数字或技能。
7. 只输出 JSON，不要输出解释或 markdown 代码块。

reason 取值：
- vague       回答笼统，缺少具体做法或细节
- too_short   回答过短，信息量不足
- off_topic   回答偏离岗位要求或当前问题
- good_enough 回答充分，无需追问（此时 action 必须为 next_question）

${input.forcedReason ? `本次追加约束：${REASON_HINT[input.forcedReason]}` : ''}
当前已追问 ${input.depth} 层（系统最多允许 2 层，超出时你的追问会被忽略）。

输出必须为如下信封结构：
{"schema_version":"${SCHEMA_VERSION}","data":${dataSchema}}`,

    user: `当前主问题：
"""
${input.question}
"""

简历与岗位要点（用于判断是否跑题、以及把话题拉回要求）：
"""
${input.context}
"""

用户本次回答：
"""
${input.answer}
"""`,
  }
}

export interface HintPromptInput {
  question: string
  expectedPoints: string[]
}

export function buildHintPrompt(input: HintPromptInput): PromptTemplate {
  return {
    system: `你是面试教练。候选人请求针对当前问题的提示。请给出回答思路，不要给出完整答案。

严格遵守：
1. 只给**结构与方向**（例如「可以从背景、你负责的部分、量化结果三块组织」），
   不得替候选人编造具体经历、数字或结论。
2. 不超过 120 字。
3. 禁止涉及年龄、性别、婚育、宗教、政治，也不得给出录用建议或主观评价。
4. 只输出 JSON，不要输出解释或 markdown 代码块。

输出必须为如下信封结构：
{"schema_version":"${SCHEMA_VERSION}","data":{"hint":"string"}}`,

    user: `当前问题：
"""
${input.question}
"""

该题期望要点：
"""
${input.expectedPoints.map((point) => `- ${point}`).join('\n')}
"""`,
  }
}
