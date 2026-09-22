import { SCHEMA_VERSION } from '../schemas/parse'
import type { PromptTemplate } from './parse'

/**
 * 逐题评分与报告生成的 prompt —— docs/engineering/AI_PROMPTS.md §6.2 / §7.2 的代码实现。
 */

export interface EvaluationPromptInput {
  jdJson: string
  /** 简历结构化数据：参考答案必须基于候选人**真实经历**，因此必须传入 */
  resumeJson: string
  question: string
  questionType: string
  expectedPoints: string[]
  answer: string
}

export function buildEvaluationPrompt(input: EvaluationPromptInput): PromptTemplate {
  const dataSchema = `{
  "dimension_scores": {
    "job_match": 0, "professional": 0, "project_depth": 0,
    "logic": 0, "communication": 0, "motivation": 0
  },
  "evidence_quotes": [{ "quote": "逐字摘录的回答片段", "reason": "该证据支撑了什么判断" }],
  "feedback": "string，具体反馈（低分时含可执行建议）",
  "better_answer": "string，改进要点",
  "reference_answer": "string，参考答案（示范怎么答，见规则 6）"
}`

  return {
    system: `你是面试评估助手。请针对候选人的一次回答，按六个维度打分，并给出反馈与参考答案。

六个维度（每项 0-5 的**整数**）：
- job_match      岗位匹配：回答是否回应了岗位要求
- professional   专业能力：技术判断与知识准确性
- project_depth  项目深度：是否讲清背景、做法与取舍
- logic          逻辑表达：结构是否清晰、有无因果
- communication  沟通表达：表述是否简洁易懂
- motivation     动机稳定性：是否体现持续投入与目标感

评分必须遵守（最高优先级）：
1. **每条评分都要引用回答原文证据**：evidence_quotes 至少 1 条，
   每条 quote 必须是从回答中**逐字复制的片段**（不得改写、不得拼接、不得编造）。
   系统会校验 quote 是否为回答原文的子串，不匹配的会被剔除。
2. **禁止编造候选人未提及的经历、公司、数字或技能**。
3. 回答为空或明显未作答时，六维均给 0，并在 feedback 中说明原因。
4. 任一维度低于 3 分时，feedback 必须包含**可执行的改进建议**
   （例如"补充量化结果""说明技术选型的取舍依据"），不得只写"回答不好"。
5. better_answer 为**改进要点**：指出应补充哪些信息、按什么结构组织。
6. reference_answer 为**参考答案**：给出一段候选人下次可以照着说的示范回答。
   这是本题最重要的产出，请认真写：
   - **只能使用候选人简历与本次回答中出现的真实经历、技能、项目**；
     简历里没有的经历一律不得出现。
   - 按 **STAR** 组织：背景(S) → 任务(T) → 行动(A) → 结果(R)，
     让候选人看清"一个好回答长什么样"。
   - **贴合岗位要求**：优先呼应岗位的硬性要求与职责，
     说明这段经历如何与该岗位相关。
   - 用第一人称、口语化，像真人在面试里说话，不要写成书面报告。
   - **凡是你无法从简历中确定的具体信息（数字、指标、时间、规模、
     技术细节），必须写成占位符** 【待补充：需要填写的内容】，
     并提示候选人替换为自己的真实情况。**绝不允许编造具体数字或事实。**
   - 结尾用一句话提示核对，例如"面试前请把上面【】里的内容换成你的真实数据。"
   - 长度 150-400 字，不要堆砌形容词。
   - 若题型是"反问环节"等无需标准答案的题目，给出提问思路即可。
7. **禁止**输出年龄、性别、婚育、宗教、政治等敏感内容，**禁止**给出录用建议或性格评价。
8. 只输出 JSON，不要输出解释或 markdown 代码块。

输出必须为如下信封结构：
{"schema_version":"${SCHEMA_VERSION}","data":${dataSchema}}`,

    user: `岗位要求：
"""
${input.jdJson}
"""

候选人简历（参考答案**只能**基于这里出现的真实经历）：
"""
${input.resumeJson}
"""

题目：${input.question}
题型：${input.questionType}
该题期望要点：
"""
${input.expectedPoints.map((point) => `- ${point}`).join('\n') || '（无）'}
"""

候选人本次回答：
"""
${input.answer}
"""`,
  }
}

export interface ReportPromptInput {
  evaluationsJson: string
  resumeRisks: string[]
  jdJson: string
}

export function buildReportPrompt(input: ReportPromptInput): PromptTemplate {
  const dataSchema = `{
  "summary": "string，总评（200 字内）",
  "highlights": ["string，优势"],
  "issues": ["string，可改进之处"],
  "reference_answers": [{ "question": "原问题", "improvement": "改进要点" }],
  "next_actions": ["string，可执行的下一步建议"],
  "resume_risks": ["string，简历疑点（仅归纳，不得新增）"]
}`

  return {
    system: `你是面试复盘助手。基于本次面试的逐题评分结果，撰写一份复盘报告。

严格遵守：
1. **只依据给定的逐题评分与简历信息**，禁止编造候选人未提及的经历、公司、数字或技能。
2. highlights（优势）每条都应能在逐题评分中找到依据。
3. issues（问题）指可改进之处，表述为"下次可以……"，**不得**做性格评价或录用判断。
4. reference_answers 的 question 必须**原样取自给定的面试题目**，不得虚构题目；
   improvement 为**改进要点**，基于候选人真实经历指出应如何组织与补充，
   **不得编造具体项目、数字或结论**。
5. next_actions（下一步建议）必须**可执行**（例如"补充 1 个可量化的项目结果"），
   不要写"多练习"这类空话。
6. resume_risks 只能从给定的简历疑点中归纳，**不得新增**简历中不存在的疑点。
7. **禁止**输出年龄、性别、婚育、宗教、政治等敏感内容，**禁止**给出录用建议。
8. 只输出 JSON，不要输出解释或 markdown 代码块。

输出必须为如下信封结构：
{"schema_version":"${SCHEMA_VERSION}","data":${dataSchema}}`,

    user: `逐题评分结果：
"""
${input.evaluationsJson}
"""

简历疑点（来自简历解析，仅可归纳不得新增）：
"""
${input.resumeRisks.length > 0 ? input.resumeRisks.map((risk) => `- ${risk}`).join('\n') : '（无）'}
"""

岗位要求：
"""
${input.jdJson}
"""`,
  }
}
