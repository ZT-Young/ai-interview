import { describe, expect, it } from 'vitest'

import { parseJdFile, parseJdText, parseResumeFile } from '@/lib/services/handlers/parse-service'
import type { JdData, ResumeData } from '@/lib/ai/schemas/parse'

import { buildDocx, buildPdf, buildPng } from '../fixtures/documents'
import { envelope, FakeLlm, FakeStorage, llmUnavailableError } from '../helpers/fakes'

/**
 * 解析服务端到端测试（fake S3 + fake LLM）。
 *
 * 覆盖任务要求的三个场景：
 *   1. 正常解析
 *   2. 解析失败（文件损坏 / AI 不可用 / 输出不合规）
 *   3. Schema 校验失败
 * 外加「不编造简历中没有的信息」的专项验证。
 */

const RESUME_TEXT = [
  'Zhang Wei Backend Engineer',
  'Skills: TypeScript, PostgreSQL, Docker',
  'Project: AI Interview Platform - built the scoring service with TypeScript and PostgreSQL.',
  'Result: P95 latency reduced from 800ms to 220ms, covering 300 automated test cases.',
].join('\n')

const JD_TEXT =
  'Responsibilities: build backend services for the AI interview product using TypeScript. ' +
  'Requirements: 3+ years Node.js experience, familiar with PostgreSQL and distributed systems. ' +
  'Nice to have: experience shipping LLM applications.'

function resumeData(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    name: 'Zhang Wei',
    years: 3,
    skills: ['TypeScript', 'PostgreSQL'],
    projects: [
      {
        name: 'AI Interview Platform',
        role: 'Backend Engineer',
        actions: ['built the scoring service'],
        results: ['P95 latency reduced from 800ms to 220ms'],
        evidence: ['built the scoring service with TypeScript and PostgreSQL'],
      },
    ],
    education: [],
    risks: [],
    ...overrides,
  }
}

function jdData(overrides: Partial<JdData> = {}): JdData {
  return {
    title: 'AI Backend Engineer',
    company: 'Example Tech',
    must_have: ['3+ years Node.js experience'],
    nice_to_have: ['experience shipping LLM applications'],
    responsibilities: ['build backend services'],
    keywords: ['TypeScript', 'PostgreSQL'],
    ...overrides,
  }
}

/** 预置一个简历 PDF 到 fake 存储 */
async function storageWithResumePdf(): Promise<{ storage: FakeStorage; key: string }> {
  const storage = new FakeStorage()
  const key = 'resumes/user-1/resume.pdf'
  await storage.putObject({
    key,
    body: buildPdf(RESUME_TEXT.replace(/\n/g, ' ')),
    contentType: 'application/pdf',
  })
  return { storage, key }
}

describe('简历解析：正常路径', () => {
  it('从 PDF 抽取文本并返回结构化结果', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = FakeLlm.always({ schema_version: '1.0', data: resumeData() })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('Zhang Wei')
      expect(result.data.skills).toContain('TypeScript')
      expect(result.meta.source).toBe('pdf')
      expect(result.meta.vision_used).toBe(false)
      expect(result.meta.attempts).toBe(1)
      expect(result.meta.prompt_version).toBe('1.0')
      expect(result.model).toBe('fake-model')
    }
  })

  it('从 DOCX 抽取文本并解析', async () => {
    const storage = new FakeStorage()
    const key = 'resumes/user-1/resume.docx'
    await storage.putObject({
      key,
      body: buildDocx(RESUME_TEXT.split('\n')),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const llm = FakeLlm.always({ schema_version: '1.0', data: resumeData() })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.docx' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meta.source).toBe('docx')
  })

  it('图片走视觉模型直读（vision_used = true，且图片随请求发送）', async () => {
    const storage = new FakeStorage()
    const key = 'resumes/user-1/resume.png'
    await storage.putObject({ key, body: buildPng(), contentType: 'image/png' })
    const llm = FakeLlm.always({ schema_version: '1.0', data: resumeData() })

    const result = await parseResumeFile(
      { llm, storage },
      { storageKey: key, fileName: 'resume.png', mimeType: 'image/png' },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meta.vision_used).toBe(true)
      expect(result.meta.source).toBe('image')
    }
    // 图片必须真的随请求传给了模型
    expect(llm.requests[0]!.images).toHaveLength(1)
    expect(llm.requests[0]!.images![0]!.mimeType).toBe('image/png')
  })

  it('剔除编造内容并记录低置信字段', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: resumeData({ skills: ['TypeScript', 'Kubernetes', 'Rust'] }),
    })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // 原文中不存在的技能被剔除（不编造）
      expect(result.data.skills).toEqual(['TypeScript'])
      expect(result.dropped.map((item) => item.value)).toEqual(
        expect.arrayContaining(['Kubernetes', 'Rust']),
      )
      // 被剔除的字段进入 meta，供前端提示用户核对
      expect(result.meta.low_confidence_fields).toContain('skills')
    }
  })
})

describe('简历解析：解析失败', () => {
  it('对象不存在（如 S3 无此 key）→ failed，可读提示', async () => {
    const storage = new FakeStorage()
    const llm = FakeLlm.always({ schema_version: '1.0', data: resumeData() })

    const result = await parseResumeFile(
      { llm, storage },
      { storageKey: 'missing.pdf', fileName: 'missing.pdf' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('corrupted_file')
      expect(result.error.userMessage).toBe('文件无法读取，可能已损坏或加密，请重新导出后上传')
    }
    expect(llm.callCount).toBe(0)
  })

  it('损坏的 PDF → failed', async () => {
    const storage = new FakeStorage()
    const key = 'resumes/user-1/broken.pdf'
    await storage.putObject({ key, body: Buffer.from('not a pdf'), contentType: 'application/pdf' })
    const llm = FakeLlm.always({ schema_version: '1.0', data: resumeData() })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'broken.pdf' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('corrupted_file')
  })

  it('扫描件无文字层 → failed 且提示上传更清晰的图片', async () => {
    const storage = new FakeStorage()
    const key = 'resumes/user-1/scan.pdf'
    await storage.putObject({ key, body: buildPdf('X'), contentType: 'application/pdf' })
    const llm = FakeLlm.always({ schema_version: '1.0', data: resumeData() })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'scan.pdf' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('no_text_layer')
      expect(result.error.userMessage).toContain('更清晰的图片')
    }
  })

  it('LLM 未配置 → failed，且提示指向配置问题（不是「稍后重试」）', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = new FakeLlm([{ type: 'error', error: llmUnavailableError() }])

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // 「未配置」与「服务暂时不可用」必须区分：前者重试无用，需改配置
      expect(result.code).toBe('ai_misconfigured')
      expect(result.error.userMessage).toContain('未正确配置')
      // 内容已保留，用户仍可手动填写
      expect(result.error.userMessage).toContain('手动填写')
    }
  })

  it('返回内容全空 → failed', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: { name: '', years: 0, skills: [], projects: [], education: [], risks: [] },
    })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('ai_invalid_output')
  })
})

describe('简历解析：Schema 校验失败', () => {
  it('非 JSON 输出 → 重试后 failed', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = new FakeLlm([{ type: 'malformed', content: '抱歉，我无法解析这个文件' }])

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('ai_invalid_output')
      expect(result.meta.attempts).toBe(2)
    }
    expect(llm.callCount).toBe(2)
  })

  it('缺少必填字段 → failed', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = FakeLlm.always({ schema_version: '1.0', data: { name: 'Zhang Wei' } })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })
    expect(result.ok).toBe(false)
  })

  it('years 越界 → failed', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: resumeData({ years: 999 }),
    })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })
    expect(result.ok).toBe(false)
  })

  it('projects 缺少 role 字段 → failed', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: {
        ...resumeData(),
        projects: [{ name: 'AI Interview Platform', actions: [], results: [], evidence: [] }],
      },
    })

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })
    expect(result.ok).toBe(false)
  })

  it('第一次校验失败、降温重试后成功', async () => {
    const { storage, key } = await storageWithResumePdf()
    const llm = new FakeLlm([
      { type: 'malformed', content: 'not json at all' },
      { type: 'content', content: envelope(resumeData()) },
    ])

    const result = await parseResumeFile({ llm, storage }, { storageKey: key, fileName: 'resume.pdf' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meta.attempts).toBe(2)
  })
})

describe('JD 解析', () => {
  it('文本粘贴可直接解析（无需上传）', async () => {
    const storage = new FakeStorage()
    const llm = FakeLlm.always({ schema_version: '1.0', data: jdData() })

    const result = await parseJdText({ llm, storage }, JD_TEXT)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.must_have).toContain('3+ years Node.js experience')
      expect(result.meta.source).toBe('text')
    }
  })

  it('过短文本被拒绝且不调用模型', async () => {
    const storage = new FakeStorage()
    const llm = FakeLlm.always({ schema_version: '1.0', data: jdData() })

    const result = await parseJdText({ llm, storage }, '太短')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('text_too_short')
    expect(llm.callCount).toBe(0)
  })

  it('JD 图片走视觉直读', async () => {
    const storage = new FakeStorage()
    const key = 'jd-images/user-1/jd.png'
    await storage.putObject({ key, body: buildPng(), contentType: 'image/png' })
    const llm = FakeLlm.always({ schema_version: '1.0', data: jdData() })

    const result = await parseJdFile(
      { llm, storage },
      { storageKey: key, fileName: 'jd.png', mimeType: 'image/png' },
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meta.vision_used).toBe(true)
    expect(llm.requests[0]!.images).toHaveLength(1)
  })

  it('全部字段为空 → failed', async () => {
    const storage = new FakeStorage()
    const llm = FakeLlm.always({
      schema_version: '1.0',
      data: {
        title: '',
        company: '',
        must_have: [],
        nice_to_have: [],
        responsibilities: [],
        keywords: [],
      },
    })

    const result = await parseJdText({ llm, storage }, JD_TEXT)
    expect(result.ok).toBe(false)
  })
})

/* 匹配分析的测试已移至 tests/unit/match-service.test.ts
   —— 该能力拆到 lib/services/match-service.ts，避免路由间接引入 pdfjs。 */
