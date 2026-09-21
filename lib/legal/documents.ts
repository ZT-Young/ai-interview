/**
 * 法律文本的**单一真源**（AGENTS.md §7 C2、C1、C4）。
 *
 * 设计要点：
 * - 正文放代码里而不是数据库：便于版本化、代码评审与部署原子性
 * - `version` 与 `consents.version` 对应（`db/schema/consents.ts` 的 `CURRENT_CONSENT_VERSION`）
 * - 条款实质变更时必须**提升版本号**，注册流程会据此重新征得同意
 *
 * 注意：以下为面向 AI 模拟面试产品的条款模板，不构成法律意见。
 * 正式上线前应由法务审阅。
 */

export const LEGAL_TYPES = ['terms', 'privacy', 'ai_disclosure'] as const
export type LegalType = (typeof LEGAL_TYPES)[number]

export interface LegalSection {
  heading: string
  paragraphs: string[]
}

export interface LegalDocument {
  /** 稳定标识，与 `consents.consent_type` 枚举值一致（下划线） */
  type: LegalType
  /** URL slug（连字符，符合 URL 习惯） */
  slug: string
  /** 标题 */
  title: string
  /** 版本号，与 consents.version 对齐 */
  version: string
  /** 生效日期（ISO 8601 日期） */
  effectiveDate: string
  /** 一句话摘要，用于注册页链接旁的说明 */
  summary: string
  sections: LegalSection[]
}

/**
 * 类型 → URL slug 的映射。
 *
 * **为什么要单独定义**：枚举值（`ai_disclosure`，下划线）与 URL（`ai-disclosure`，连字符）
 * 惯例不同；若让路由直接用枚举值，所有链接都会 404。
 * 这里把两者解耦：库里用 `type`，链接用 `slug`。
 */
export const LEGAL_SLUGS: Record<LegalType, string> = {
  terms: 'terms',
  privacy: 'privacy',
  ai_disclosure: 'ai-disclosure',
}

/** 当前法律文本版本；与 db/schema/consents.ts 的 CURRENT_CONSENT_VERSION 保持一致 */
export const LEGAL_VERSION = 'v1'

export const LEGAL_DOCUMENTS: Record<LegalType, LegalDocument> = {
  terms: {
    type: 'terms',
    slug: LEGAL_SLUGS.terms,
    title: '用户协议',
    version: LEGAL_VERSION,
    effectiveDate: '2026-01-01',
    summary: '使用本服务前请阅读：服务性质、账号规则与使用边界。',
    sections: [
      {
        heading: '一、服务性质',
        paragraphs: [
          '本产品提供的是**面试练习工具**：由人工智能根据你提供的岗位描述与个人简历生成模拟面试问题、追问与练习反馈。',
          '本服务不提供任何形式的求职结果承诺，也不代表任何真实企业的招聘意向、评价或决定。',
        ],
      },
      {
        heading: '二、账号与使用',
        paragraphs: [
          '你需要使用有效的邮箱注册账号，并对账号下的一切操作负责。',
          '你不得利用本服务生成、存储或传播违法内容，不得尝试绕过访问控制、批量抓取或干扰服务正常运行。',
          '我们可能对明显异常的访问行为（例如短时间大量请求）进行限流，以保障服务稳定。',
        ],
      },
      {
        heading: '三、你提供的内容',
        paragraphs: [
          '你保留对自己上传的简历、岗位描述与作答内容的所有权利。',
          '你授权我们在提供服务所必需的范围内处理这些内容（例如用于解析、生成问题与评分）。',
          '请勿上传你不希望被处理的敏感信息；我们也会在解析环节尽量剔除与招聘无关的敏感个人属性。',
        ],
      },
      {
        heading: '四、服务变更与终止',
        paragraphs: [
          '我们可能调整、暂停或终止部分功能，重大变更会在产品内提示。',
          '你可以随时在「账户设置」中删除账号与数据。',
        ],
      },
      {
        heading: '五、免责声明',
        paragraphs: [
          'AI 生成的内容可能存在不准确或不完整之处，请自行判断并核对。',
          '在法律允许的范围内，我们不对因使用本服务产生的求职结果承担责任。',
        ],
      },
    ],
  },

  privacy: {
    type: 'privacy',
    slug: LEGAL_SLUGS.privacy,
    title: '隐私政策',
    version: LEGAL_VERSION,
    effectiveDate: '2026-01-01',
    summary: '我们收集什么、用来做什么、保存多久，以及你如何导出和删除。',
    sections: [
      {
        heading: '一、我们收集的信息',
        paragraphs: [
          '账号信息：邮箱、密码的哈希值（我们不保存明文密码）、昵称。',
          '你主动提供的内容：简历文件与解析结果、岗位描述、面试作答（文字或语音转写文本）。',
          '必要的技术信息：登录会话、访问时间与来源 IP（用于安全审计）。',
        ],
      },
      {
        heading: '二、信息如何使用',
        paragraphs: [
          '用于提供核心功能：解析简历与岗位、生成面试计划、追问、评分与生成报告。',
          '用于账号与安全管理：登录鉴权、防止滥用、排查故障。',
          '我们**不会**将你的简历或作答内容用于对外招聘决策，也不会向第三方出售你的个人信息。',
        ],
      },
      {
        heading: '三、AI 处理说明',
        paragraphs: [
          '简历与岗位描述的部分内容会发送给第三方大语言模型服务用于解析与出题；作答内容会用于评分与生成反馈。',
          '我们在发送前尽量减少无关的个人敏感信息。',
          'AI 输出可能存在偏差，生成内容均标注为 AI 生成，仅供参考。',
        ],
      },
      {
        heading: '四、保存期限',
        paragraphs: [
          '账号存续期间保留上述数据；你删除账号后，我们会立即停止提供访问并删除简历原件，'
            + '并按法律与对账要求保留不含简历内容的必要记录，到期后彻底清除。',
        ],
      },
      {
        heading: '五、你的权利',
        paragraphs: [
          '**导出**：在「账户设置」中一键导出你的数据副本（JSON）。',
          '**删除**：在「账户设置」中删除账号，删除后所有登录会话立即失效，简历原件从对象存储中删除。',
          '如对数据处理有疑问，可通过产品内渠道联系我们。',
        ],
      },
      {
        heading: '六、数据安全',
        paragraphs: [
          '密码使用加盐慢哈希存储；会话令牌在数据库中仅保存哈希值。',
          '传输层使用 HTTPS；对象存储中的简历原件由服务端加密保存。',
        ],
      },
    ],
  },

  ai_disclosure: {
    type: 'ai_disclosure',
    slug: LEGAL_SLUGS.ai_disclosure,
    title: 'AI 生成内容说明',
    version: LEGAL_VERSION,
    effectiveDate: '2026-01-01',
    summary: '哪些内容由 AI 生成、它可以用来做什么、不能用来做什么。',
    sections: [
      {
        heading: '一、哪些内容是 AI 生成的',
        paragraphs: [
          '简历与岗位描述的结构化解析结果、面试计划与题目、追问、提示、逐题评分、参考回答与报告文字，均由 AI 生成。',
          '这些内容会在界面上明确标注为「AI 生成内容」。',
        ],
      },
      {
        heading: '二、可以怎么用',
        paragraphs: [
          '作为**练习与自查工具**：发现表达上的薄弱点、补充量化结果、熟悉可能被追问的方向。',
          '作为准备面试的参考资料，由你自己判断取舍。',
        ],
      },
      {
        heading: '三、不能怎么用',
        paragraphs: [
          'AI 的评分与建议**不构成**对任何人的能力评价，也**不得**作为招聘、录用、淘汰或任何人事决定的依据。',
          '本产品不会仅凭 AI 结果自动拒绝或淘汰任何候选人。',
          '请勿将 AI 生成的「参考回答」当作真实经历陈述 —— 参考回答只提供组织与补充思路，不会替你编造经历。',
        ],
      },
      {
        heading: '四、局限与偏差',
        paragraphs: [
          'AI 可能给出不准确、不完整或带有偏见的判断，请结合自身情况核对。',
          '评分基于你的表达内容，无法反映真实工作能力、性格或潜力。',
          '如果你发现明显不当的输出（例如涉及敏感个人属性的问题），请通过产品内渠道反馈，我们会持续改进。',
        ],
      },
    ],
  },
}

export const LEGAL_TYPES_LABELS: Record<LegalType, string> = {
  terms: '用户协议',
  privacy: '隐私政策',
  ai_disclosure: 'AI 生成内容说明',
}

export function isLegalType(value: string): value is LegalType {
  return (LEGAL_TYPES as readonly string[]).includes(value)
}

/** 按 **slug** 取文档（页面路由用，slug 为连字符形式） */
export function getLegalDocumentBySlug(slug: string): LegalDocument | null {
  const type = LEGAL_TYPES.find((item) => LEGAL_SLUGS[item] === slug)
  return type ? LEGAL_DOCUMENTS[type] : null
}

/** 按 **type** 取文档（业务逻辑用，与 consents 枚举值一致） */
export function getLegalDocument(type: string): LegalDocument | null {
  return isLegalType(type) ? LEGAL_DOCUMENTS[type] : null
}

/** 文档的可访问路径 */
export function legalPath(type: LegalType): string {
  return `/legal/${LEGAL_SLUGS[type]}`
}

export function listLegalDocuments(): LegalDocument[] {
  return LEGAL_TYPES.map((type) => LEGAL_DOCUMENTS[type])
}
