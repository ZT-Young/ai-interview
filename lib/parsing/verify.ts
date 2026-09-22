import type { JdData, MatchData, ResumeData } from '../ai/schemas/parse'

/**
 * 输出后置校验 —— docs/engineering/AI_PROMPTS.md §5 的代码实现。
 *
 * 不依赖模型自觉：对已通过 schema 校验的结果再做一次规则化过滤。
 * 命中禁止项的内容会被**丢弃**（而非报错），并记录在 dropped 中供审计。
 */

/** 敏感个人信息关键词（N5 / 合规） */
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /年龄|出生年|出生日期|生日|生于\d{4}|\d{1,2}\s*岁|多大|贵庚/,
  // 注意：不要用 \b 包裹中文字符 —— 正则的 \b 只对 ASCII 词字符生效，
  // `\b男\b` 无法匹配「男，28 岁」。改用枚举式匹配。
  /性别|男性|女性|男，|女，|^男$|^女$|男\s*\/\s*女/,
  /已婚|未婚|离异|婚姻|结婚|婚育/,
  /生育|已育|未育|孕|子女|生孩子/,
  /宗教|信仰|佛教|基督教|伊斯兰/,
  /政治面貌|党员|团员|党派/,
  /民族|籍贯|户口|老家/,
  /身份证|护照号|证件号/,
  /身高|体重|健康状况|病史|残疾/,
]

/**
 * 禁止项：录用建议、性格与诚信判断（N4 / 合规 C5）。
 *
 * ⚠️ 这里的模式必须**足够精确**：它是一个**拒绝**过滤器，误杀会直接让用户
 * 拿不到面试计划（表现为 502「生成面试计划失败」），而用户完全看不出原因。
 *
 * 实测踩过的误杀（真实模型产出的**正当题目**被判违规）：
 *   「请讲一次你负责排查线上性能或**稳定性**问题的经历…」
 * —— `稳定性` 在技术语境里指系统/服务可靠性，是后端岗位的核心考察点，
 *    JD 职责里本身就写着「稳定性保障」，第六个评分维度也叫「动机稳定性」。
 *    原本的 `/稳定性/` 把它当成「性格稳定性」判断而整题拒绝。
 * 因此改为只拦**明确的负面判断**（`稳定性差`/`不稳定`），不再拦中性词本身。
 */
export const PROHIBITED_PATTERNS: readonly RegExp[] = [
  /建议录用|不建议录用|不予录用|淘汰|pass\s*掉|不适合该岗位|不予考虑/,
  /性格|稳定性差|不稳定|诚信|造假|可疑|说谎|不诚实/,
  /录用建议|招聘决策|录用决策/,
]

export type DropReason = 'sensitive' | 'prohibited' | 'not_in_source'

export interface DroppedItem {
  path: string
  reason: DropReason
  value: string
}

export interface VerifyResult<T> {
  data: T
  dropped: DroppedItem[]
}

export function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

/** 供出题等其它模块复用（docs/engineering/AI_PROMPTS.md §4.3、§6.3） */
export function containsSensitive(value: string): boolean {
  return matchesAny(value, SENSITIVE_PATTERNS)
}

/** 命中录用建议 / 性格与诚信判断等禁止项 */
export function containsProhibited(value: string): boolean {
  return matchesAny(value, PROHIBITED_PATTERNS)
}

/**
 * 关键词是否在原文中出现。
 * 归一化处理大小写与空白，避免因排版差异误杀（如 "Type  Script" / "typescript"）。
 */
function appearsInSource(value: string, source: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '')
  const needle = normalize(value)
  if (needle.length === 0) return true
  return normalize(source).includes(needle)
}

/* ------------------------------------------------------------------ *
 * JD
 * ------------------------------------------------------------------ */

function verifyJdList(
  values: string[],
  path: string,
  drop: (item: DroppedItem) => void,
): string[] {
  return values.filter((value) => {
    if (matchesAny(value, SENSITIVE_PATTERNS)) {
      drop({ path, reason: 'sensitive', value })
      return false
    }
    if (matchesAny(value, PROHIBITED_PATTERNS)) {
      drop({ path, reason: 'prohibited', value })
      return false
    }
    return true
  })
}

export function verifyJdData(data: JdData): VerifyResult<JdData> {
  const dropped: DroppedItem[] = []
  const drop = (item: DroppedItem) => dropped.push(item)

  return {
    data: {
      title: matchesAny(data.title, SENSITIVE_PATTERNS) ? '' : data.title,
      company: data.company,
      must_have: verifyJdList(data.must_have, 'must_have', drop),
      nice_to_have: verifyJdList(data.nice_to_have, 'nice_to_have', drop),
      responsibilities: verifyJdList(data.responsibilities, 'responsibilities', drop),
      keywords: verifyJdList(data.keywords, 'keywords', drop),
    },
    dropped,
  }
}

/* ------------------------------------------------------------------ *
 * 简历
 * ------------------------------------------------------------------ */

/**
 * 简历后置校验。
 *
 * 除敏感/禁止项外，额外做「原文一致性」检查（N4）：
 * 关键字段必须能在原文中找到，否则剔除 —— 这是防止模型编造的主要手段。
 * 注意：`years` 与 `role` 为 "" 属于**合法空值**，不做剔除。
 */
export function verifyResumeData(data: ResumeData, sourceText: string): VerifyResult<ResumeData> {
  const dropped: DroppedItem[] = []
  const drop = (item: DroppedItem) => dropped.push(item)

  const hasSource = sourceText.trim().length > 0

  const filterText = (value: string, path: string): boolean => {
    if (matchesAny(value, SENSITIVE_PATTERNS)) {
      drop({ path, reason: 'sensitive', value })
      return false
    }
    if (matchesAny(value, PROHIBITED_PATTERNS)) {
      drop({ path, reason: 'prohibited', value })
      return false
    }
    return true
  }

  // 技能：必须出现在原文中
  const skills = data.skills.filter((skill) => {
    if (!filterText(skill, 'skills')) return false
    if (hasSource && !appearsInSource(skill, sourceText)) {
      drop({ path: 'skills', reason: 'not_in_source', value: skill })
      return false
    }
    return true
  })

  const projects = data.projects
    .filter((project) => {
      if (!project.name) return false
      if (!filterText(project.name, 'projects[].name')) return false
      if (hasSource && !appearsInSource(project.name, sourceText)) {
        drop({ path: 'projects[].name', reason: 'not_in_source', value: project.name })
        return false
      }
      return true
    })
    .map((project) => ({
      name: project.name,
      // role 允许为 ""（简历未写），但若乱填了禁止内容则清空
      role: filterText(project.role, 'projects[].role') ? project.role : '',
      actions: project.actions.filter((action) => filterText(action, 'projects[].actions')),
      results: project.results.filter((result) => filterText(result, 'projects[].results')),
      evidence: project.evidence,
    }))

  const education = data.education.filter((item) =>
    filterText(item.school, 'education[].school'),
  )

  const risks = data.risks.filter((risk) => {
    if (matchesAny(risk, SENSITIVE_PATTERNS)) {
      drop({ path: 'risks', reason: 'sensitive', value: risk })
      return false
    }
    if (matchesAny(risk, PROHIBITED_PATTERNS)) {
      drop({ path: 'risks', reason: 'prohibited', value: risk })
      return false
    }
    return true
  })

  return {
    data: {
      name: filterText(data.name, 'name') ? data.name : '',
      years: data.years,
      skills,
      projects,
      education,
      risks,
    },
    dropped,
  }
}

/* ------------------------------------------------------------------ *
 * 匹配分析
 * ------------------------------------------------------------------ */

export function verifyMatchData(data: MatchData): VerifyResult<MatchData> {
  const dropped: DroppedItem[] = []
  const drop = (item: DroppedItem) => dropped.push(item)

  const filterText = (value: string, path: string): boolean => {
    if (matchesAny(value, SENSITIVE_PATTERNS)) {
      drop({ path, reason: 'sensitive', value })
      return false
    }
    if (matchesAny(value, PROHIBITED_PATTERNS)) {
      drop({ path, reason: 'prohibited', value })
      return false
    }
    return true
  }

  return {
    data: {
      match_score: data.match_score,
      advantages: data.advantages.filter(
        (item) =>
          filterText(item.point, 'advantages[].point') &&
          filterText(item.evidence, 'advantages[].evidence'),
      ),
      gaps: data.gaps.filter((gap) => filterText(gap, 'gaps')),
      suggested_questions: data.suggested_questions.filter((item) =>
        filterText(item.question, 'suggested_questions[].question'),
      ),
    },
    dropped,
  }
}
