/**
 * prompt 模块的聚合入口。
 *
 * ⚠️ 这里**不能**用 `export *`：每个 prompt 模块都导出了同名的 `PROMPT_VERSION`
 * （形如 `parse.jd@1` / `plan@1`），`export *` 会产生 TS2308 歧义。
 * 因此改为显式具名导出，并把各模块的 PROMPT_VERSION 以模块前缀重新导出，
 * 避免调用方误用别人的版本号。
 */

export {
  buildJdParsePrompt,
  buildResumeParsePrompt,
  buildMatchPrompt,
  PROMPT_VERSION as PARSE_PROMPT_VERSION,
} from './parse'
export type { PromptTemplate } from './parse'

export { buildPlanPrompt, PROMPT_VERSION as PLAN_PROMPT_VERSION } from './plan'
export type { PlanPromptInput } from './plan'

export { buildEvaluationPrompt, buildReportPrompt, PROMPT_VERSION as EVALUATION_PROMPT_VERSION } from './evaluation'
export type { EvaluationPromptInput, ReportPromptInput } from './evaluation'

export { buildFollowUpPrompt, buildHintPrompt, PROMPT_VERSION as INTERVIEW_PROMPT_VERSION } from './interview'
export type { FollowUpPromptInput, HintPromptInput } from './interview'

export {
  buildInterviewAgentSystem,
  buildObservationMessage,
  buildInterviewAgentPrompt,
  PROMPT_VERSION as AGENT_PROMPT_VERSION,
} from './interview-agent'
export type { InterviewAgentSystemInput } from './interview-agent'
