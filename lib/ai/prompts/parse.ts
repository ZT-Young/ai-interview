/**
 * Prompt 模板 —— docs/engineering/AI_PROMPTS.md 的代码实现。
 *
 * 所有 prompt 集中在 lib/ai（AGENTS.md §4：复杂 AI 逻辑只放 lib/ai），
 * 禁止在组件或路由里内联 prompt 文本。
 */

import { SCHEMA_VERSION } from '../schemas/parse'

/** 所有 prompt 共享的禁止项（对齐 AGENTS.md §6.1 N4 / N5） */
const COMMON_PROHIBITIONS = `
绝对禁止（最高优先级）：
1. 只能使用输入文本中出现的信息，禁止推断、补全、猜测或美化。
2. 禁止输出或推断年龄、性别、婚育、宗教、政治面貌、民族、健康状况等敏感信息；
   即使原文出现也必须忽略，不得写入任何字段。
3. 未提及的字段：字符串填 ""，数组填 []。
4. 只输出 JSON，不要输出解释、markdown 代码块或多余文字。
5. 输出的 JSON 必须严格符合下面给出的 schema，不得增加未列出的字段。

输出必须为如下信封结构：
{"schema_version":"${SCHEMA_VERSION}","data":{...}}
`.trim()

export interface PromptTemplate {
  system: string
  user: string
}

/** 1. JD 解析（docs/engineering/AI_PROMPTS.md §1.1） */
export function buildJdParsePrompt(input: { text: string; fromImage: boolean }): PromptTemplate {
  const dataSchema = `{
  "title": "string, 岗位名称，最多 200 字",
  "company": "string, 公司名，最多 200 字",
  "must_have": ["string，硬性要求，最多 20 条，每条 200 字内"],
  "nice_to_have": ["string，加分项，最多 20 条，每条 200 字内"],
  "responsibilities": ["string，岗位职责，最多 20 条，每条 200 字内"],
  "keywords": ["string，关键技术/领域关键词，最多 30 个，每个 50 字内"]
}`

  return {
    system: `你是招聘信息结构化助手。请从用户提供的岗位 JD 中提取结构化信息。

${COMMON_PROHIBITIONS}

must_have 与 nice_to_have 的划分规则：
- must_have：原文写"必须/要求/任职资格"，或作为硬性条件陈述的项
- nice_to_have：原文写"优先/加分/熟悉者优先/最好具备"的项
- 无法判断归属时，放入 must_have

data 字段结构：
${dataSchema}`,

    user: input.fromImage
      ? `请从附件图片中的岗位 JD 提取结构化信息（先完整识别图中文字，再按 schema 输出）。`
      : `JD 原文：\n"""\n${input.text}\n"""`,
  }
}

/** 2. 简历解析（docs/engineering/AI_PROMPTS.md §2.1） */
export function buildResumeParsePrompt(input: {
  text: string
  fromImage: boolean
}): PromptTemplate {
  const dataSchema = `{
  "name": "string, 候选人姓名，最多 100 字；未提及填 \"\"",
  "years": "integer 0-60，工作年限估计；简历无任何时间信息填 0",
  "skills": ["string，技能，最多 50 个，每个 60 字内，只能取自原文出现的词"],
  "projects": [
    {
      "name": "string，项目名称，最多 200 字",
      "role": "string，担任角色，最多 100 字；简历未写角色必须填 \"\"",
      "actions": ["string，做了什么（动词开头，保留技术名词与数字），最多 10 条，每条 300 字内"],
      "results": ["string，结果与量化数据（如 QPS 提升 40%），最多 10 条；没有则填 []"],
      "evidence": ["string，逐字摘录的原文片段，最多 3 条，每条 300 字内"]
    }
  ],
  "education": [
    { "school": "string", "degree": "string", "major": "string", "period": "string" }
  ],
  "risks": ["string，仅客观可验证的简历疑点，最多 10 条，每条 200 字内"]
}`

  return {
    system: `你是简历结构化助手。请从用户提供的简历文本中提取结构化信息。

${COMMON_PROHIBITIONS}

关于 projects（最重要）：
- 项目未写角色/职责时，role 必须为 ""，**不得根据技能或岗位推断角色**。
- 项目未写量化结果时，results 必须为 []。
- evidence 必须是原文逐字摘录，用于后续溯源，最多 3 条。

关于 risks：
- 只允许客观可验证的陈述问题，例如"多段经历时间重叠（2021.03-2021.09）"、
  "项目描述无任何量化结果"、"技能与项目经历无法对应"。
- 禁止输出主观评价、性格判断、诚信判断、录用建议。

data 字段结构：
${dataSchema}`,

    user: input.fromImage
      ? `请从附件图片中的简历提取结构化信息（先完整识别图中文字，再按 schema 输出）。`
      : `简历文本：\n"""\n${input.text}\n"""`,
  }
}

/** 3. 匹配分析（docs/engineering/AI_PROMPTS.md §3.1） */
export function buildMatchPrompt(input: { jdJson: string; resumeJson: string }): PromptTemplate {
  const dataSchema = `{
  "match_score": "integer 0-100，简历与 JD 要求的匹配程度",
  "advantages": [
    { "point": "string，优势点，最多 200 字", "evidence": "string，简历中的支撑原文，最多 300 字" }
  ],
  "gaps": ["string，JD 要求但简历未体现的能力，最多 10 条，每条 200 字内"],
  "suggested_questions": [
    { "question": "string，单个问题，最多 120 字", "based_on": "advantage 或 gap" }
  ]
}`

  return {
    system: `你是面试准备助手。请对比候选人的简历与目标岗位 JD，输出匹配分析。

${COMMON_PROHIBITIONS}

额外规则：
- advantages 必须能在简历中找到对应证据（写入 evidence 字段）。
- gaps 表述为"简历中未提及 X"，**禁止**写成"候选人不会 X"。
- suggested_questions 每次只问一个问题（不超过 120 字），且必须基于 advantages 或 gaps 之一。
- suggested_questions 禁止涉及年龄、性别、婚育、宗教、政治等敏感话题。
- match_score 仅用于帮用户定位准备重点，**不是**能力评价，也不用于任何筛选决策。

data 字段结构：
${dataSchema}`,

    user: `JD 结构化要求：\n"""\n${input.jdJson}\n"""\n\n简历结构化信息：\n"""\n${input.resumeJson}\n"""`,
  }
}
