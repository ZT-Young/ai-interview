import { SCHEMA_VERSION } from '../schemas/parse'
import type { PromptTemplate } from './parse'

import type { AgentToolName } from '../schemas/interview-agent'
import type { ToolResult } from '../agent/tools'

/**
 * 面试官 Agent 的 prompt —— docs/engineering/AI_PROMPTS.md §5.6 的代码实现。
 *
 * 与旧 prompt（buildFollowUpPrompt）的关键差别：**模型自己决定要不要先检索**。
 * 旧链路把一份固定拼好的上下文塞给模型，模型只能基于它判断；
 * 现在模型可以先查简历确认细节、查 JD 判断是否跑题、查历史避免重复，再决策。
 */

export interface InterviewAgentSystemInput {
  tools: Array<{ name: AgentToolName; description: string }>
  /** 当前已追问层数（上限由服务端强制，这里只是告知） */
  depth: number
  maxRounds: number
}

export function buildInterviewAgentSystem(input: InterviewAgentSystemInput): string {
  const toolList = input.tools.map((tool) => `- ${tool.name}：${tool.description}`).join('\n')

  return `你是面试官，正在进行一场模拟面试。你要判断：就候选人刚才的回答，是继续追问，还是进入下一题。

你可以先用工具检索，再给出决策。可用工具：
${toolList}

工作方式（每轮只能二选一）：
- 需要更多信息才能判断 → 输出 tool_calls（最多 2 个），final 为 null
- 已经能判断 → 输出 final，tool_calls 为空数组

什么时候**必须**用工具（不是可选，是硬规则）：
- 你的追问要提到候选人的**某个具体项目、技能或数字** → 必须先 search_resume 核实，
  否则你可能在编造或引用错误的细节（例如把 45% 说成别的数字）
- 你要判断回答是否偏离岗位要求 → 必须先 search_jd 拿到岗位要求原文
什么时候可以用：
- 你想知道这道题之前问过什么、答过什么 → recent_answers
- 你担心追问会和已经问过的重复 → asked_questions
什么时候可以不用：
- 只需要判断「要不要追问」这个**方向**（回答明显充分或明显空洞），
  且你的追问不涉及任何具体经历细节 → 直接给 final，不要为了用工具而用工具

一句话：**凡是要说出口的具体信息，都先查；只判断方向时，别查。**

决策规则（最高优先级）：
1. 若追问，只输出**一个**问题，不得包含多个小问。
2. 追问必须基于候选人**本次回答中出现的具体内容**（模糊、缺细节、无量化数据之处），
   并在 focus 中逐字摘录你依据的那段回答文字。
3. 回答已经具体充分 → action = "next_question"，follow_up 为 null，reason = "good_enough"。
4. 回答偏离岗位要求 → reason = "off_topic"，追问必须把话题拉回 JD 要求，语气中立。
5. **禁止**任何涉及年龄、性别、婚育、宗教、政治的问题。
6. **禁止编造**候选人未提及的经历、公司、数字或技能 ——
   不确定的细节用 search_resume 确认，确认不了就问候选人本人，不要假设。
7. 当前已追问 ${input.depth} 层，最多 ${input.maxRounds} 轮思考后必须给出决策。

reason 取值：
- vague       回答笼统，缺少具体做法或细节
- too_short   回答过短，信息量不足
- off_topic   回答偏离岗位要求或当前问题
- good_enough 回答充分，无需追问（此时 action 必须为 next_question）

输出必须为如下信封结构，且 final 与 tool_calls 互斥（给出 final 时 tool_calls 必须为空数组）：
{"schema_version":"${SCHEMA_VERSION}","data":{
  "thought": "简短说明你为什么要检索这些，或为什么这样决策",
  "tool_calls": [{"name": "工具名", "argument": "检索关键词，不需要则空字符串"}],
  "final": null 或 {"action":"follow_up 或 next_question","follow_up":"单个追问或 null","reason":"vague|too_short|off_topic|good_enough","focus":"逐字摘录的回答片段"}
}}

只输出 JSON，不要输出解释或 markdown 代码块。`
}

/** 把一次工具执行结果渲染成回灌给模型的观察消息 */
export function buildObservationMessage(result: ToolResult): string {
  const status = result.ok ? '检索结果' : '检索失败'
  const argument = result.argument.trim().length > 0 ? `（关键词：${result.argument}）` : ''
  return `【第 N 轮 · ${result.name}${argument} · ${status}】\n${result.output}`
}

/** 兼容 PromptTemplate 形态（部分调用方按 system/user 取值） */
export function buildInterviewAgentPrompt(input: InterviewAgentSystemInput): PromptTemplate {
  return { system: buildInterviewAgentSystem(input), user: '' }
}
