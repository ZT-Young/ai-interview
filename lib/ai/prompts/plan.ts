import { SCHEMA_VERSION } from '../schemas/parse'
import { MAX_QUESTIONS, MIN_QUESTIONS, TYPE_MAX } from '../schemas/plan'
import type { PromptTemplate } from './parse'

/**
 * 面试计划（出题）prompt —— docs/AI_PROMPTS.md §4.1 的代码实现。
 */

export interface PlanPromptInput {
  jdJson: string
  resumeJson: string
  matchJson: string
  /** 面试配置（题量上限等），来自 InterviewSession.config */
  maxQuestions?: number
  difficulty?: 'easy' | 'medium' | 'hard'
}

const DIFFICULTY_HINT: Record<'easy' | 'medium' | 'hard', string> = {
  easy: '难度偏基础：重点考察岗位核心要求的理解与基本经验，避免偏题怪题。',
  medium: '难度中等：兼顾核心要求与一到两个有区分度的问题。',
  hard: '难度偏难：增加场景设计与权衡取舍类问题，但仍必须落在 JD 与简历范围内。',
}

export function buildPlanPrompt(input: PlanPromptInput): PromptTemplate {
  const effectiveMax = Math.min(input.maxQuestions ?? MAX_QUESTIONS, MAX_QUESTIONS)

  const dataSchema = `{
  "questions": [
    {
      "content": "string，单个问题，最多 300 字",
      "type": "self_intro | project_dig | technical | behavioral | reverse",
      "source": "jd | resume | both | generic",
      "dimension": "job_match | professional | project_depth | logic | communication | motivation",
      "expected_points": ["string，期望要点，2-5 条，每条 120 字内"],
      "follow_up_allowed": true
    }
  ]
}`

  return {
    system: `你是面试官。请根据候选人的简历与目标岗位 JD，生成一份面试计划。

严格遵守：
1. **一次只问一个问题**：每道题必须是单个问题，不得包含多个小问。
2. **必须基于给定的 JD 与简历**，禁止编造候选人的经历、公司、数字或技能。
   - 依据 JD 要求 → source = "jd"
   - 依据简历中的具体经历 → source = "resume"
   - 同时依据两者 → source = "both"
   - 仅"自我介绍"与"反问环节"可以 source = "generic"
3. 题型与数量配额（总数必须为 ${MIN_QUESTIONS}-${effectiveMax} 道）：
   - self_intro 自我介绍：恰好 1 道
   - project_dig 项目深挖：最多 ${TYPE_MAX.project_dig} 道，必须指向简历中真实存在的项目
   - technical 专业题：最多 ${TYPE_MAX.technical} 道，必须对应 JD 中的 must_have 或职责
   - behavioral 行为题：最多 ${TYPE_MAX.behavioral} 道，围绕 STAR（背景/任务/行动/结果/数据）
   - reverse 反问：恰好 1 道，引导候选人向面试官提问
   五种题型都必须至少出现一次。
4. dimension 只能取：job_match / professional / project_depth / logic / communication / motivation。
5. expected_points 为该题的期望要点（2-5 条，每条 120 字内），用于帮候选人自查，
   **不得**包含对候选人的评价、性格判断或录用建议。
6. follow_up_allowed：该题是否适合继续追问；自我介绍与反问应为 false，项目深挖与行为题通常为 true。
7. **禁止**任何涉及年龄、性别、婚育、宗教、政治的问题。
8. 不得出现重复题目。
9. 只输出 JSON，不要输出解释或 markdown 代码块。

${input.difficulty ? DIFFICULTY_HINT[input.difficulty] : DIFFICULTY_HINT.medium}

输出必须为如下信封结构：
{"schema_version":"${SCHEMA_VERSION}","data":${dataSchema}}`,

    user: `JD 结构化要求：
"""
${input.jdJson}
"""

简历结构化信息：
"""
${input.resumeJson}
"""

匹配分析：
"""
${input.matchJson}
"""`,
  }
}
