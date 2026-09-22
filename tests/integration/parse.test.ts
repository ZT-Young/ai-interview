import { afterAll, describe, expect, it } from 'vitest'

import { getResume, listResumes } from '@/lib/services/handlers/resume-service'
import { getJobJd, listJobJds } from '@/lib/services/handlers/job-jd-service'
import { parseJdText, parseResumeFile } from '@/lib/services/handlers/parse-service'
import type { ResumeData } from '@/lib/ai/schemas/parse'

import { buildPdf } from '../fixtures/documents'
import { FakeLlm, FakeStorage } from '../helpers/fakes'
import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
} from '../helpers/db'

/**
 * 解析模块集成测试：验证「解析结果 → 落库」链路与跨用户隔离。
 *
 * 需要 DATABASE_URL + AUTH_SECRET；缺失时显式跳过（不伪装通过）。
 * LLM 与 S3 仍用 fake —— 这些断言验证的是**数据库写入**，不是外部服务。
 */

const createdUserIds: string[] = []
const PAGE = { limit: 20, offset: 0 }

const RESUME_TEXT = [
  'Zhang Wei Backend Engineer',
  'Skills: TypeScript, PostgreSQL, Docker',
  'Project: AI Interview Platform - built the scoring service with TypeScript.',
  'Result: P95 latency reduced from 800ms to 220ms.',
].join('\n')

const JD_TEXT =
  'Responsibilities: build backend services using TypeScript. ' +
  'Requirements: 3+ years Node.js experience, familiar with PostgreSQL. ' +
  'Nice to have: LLM application experience.'

function resumeData(): ResumeData {
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
        evidence: ['built the scoring service with TypeScript'],
      },
    ],
    education: [],
    risks: [],
  }
}

async function newUser(prefix: string) {
  const user = await createTestUser(prefix)
  createdUserIds.push(user.id)
  return user
}

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

describe.skipIf(!hasTestDatabase())(
  `解析落库集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    it('简历解析结果可写入并读回（parsed_data / parse_status / extraction_meta）', async () => {
      const user = await newUser('parse-resume')
      const storage = new FakeStorage()
      const key = `resumes/${user.id}/resume.pdf`
      await storage.putObject({
        key,
        body: buildPdf(RESUME_TEXT.replace(/\n/g, ' ')),
        contentType: 'application/pdf',
      })

      const { createResume, updateParseState } = await import('@/lib/services/handlers/resume-service')
      const record = await createResume(user.id, {
        fileName: 'resume.pdf',
        fileType: 'pdf',
        fileSize: 1024,
        storageKey: key,
      })

      const parsed = await parseResumeFile(
        { llm: FakeLlm.always({ schema_version: '1.0', data: resumeData() }), storage },
        { storageKey: key, fileName: 'resume.pdf' },
      )
      expect(parsed.ok).toBe(true)

      const updated = await updateParseState(user.id, record.id, {
        parseStatus: 'success',
        parsedData: parsed.ok ? parsed.data : null,
        parseError: null,
        extractionMeta: parsed.ok ? parsed.meta : null,
      })

      expect(updated.parseStatus).toBe('success')
      expect((updated.parsedData as ResumeData).name).toBe('Zhang Wei')

      // 读回校验
      const fetched = await getResume(user.id, record.id)
      expect((fetched.parsedData as ResumeData).skills).toEqual(['TypeScript', 'PostgreSQL'])
      expect((fetched.extractionMeta as { source: string }).source).toBe('pdf')
    })

    it('解析失败时写入 parse_error 且保留可编辑内容', async () => {
      const user = await newUser('parse-fail')
      const storage = new FakeStorage()
      const key = `resumes/${user.id}/broken.pdf`
      await storage.putObject({ key, body: Buffer.from('not a pdf'), contentType: 'application/pdf' })

      const { createResume, updateParseState } = await import('@/lib/services/handlers/resume-service')
      const record = await createResume(user.id, {
        fileName: 'broken.pdf',
        fileType: 'pdf',
        fileSize: 100,
        storageKey: key,
      })

      const parsed = await parseResumeFile(
        { llm: FakeLlm.always({ schema_version: '1.0', data: resumeData() }), storage },
        { storageKey: key, fileName: 'broken.pdf' },
      )
      expect(parsed.ok).toBe(false)

      const updated = await updateParseState(user.id, record.id, {
        parseStatus: 'failed',
        parsedData: null,
        parseError: parsed.ok ? null : parsed.error.userMessage,
      })

      expect(updated.parseStatus).toBe('failed')
      expect(updated.parseError).toContain('无法读取')
      // 失败后用户仍可手动保存解析结果（AGENTS.md §2 第 4 步）
      const manual = await updateParseState(user.id, record.id, {
        parseStatus: 'success',
        parsedData: resumeData(),
      })
      expect(manual.parseStatus).toBe('success')
    })

    it('JD 文本解析结果写入 title / company / parsed_data', async () => {
      const user = await newUser('parse-jd')
      const { createJobJd, updateParseState } = await import('@/lib/services/handlers/job-jd-service')

      const record = await createJobJd(user.id, { rawText: JD_TEXT })
      const parsed = await parseJdText(
        {
          llm: FakeLlm.always({
            schema_version: '1.0',
            data: {
              title: 'AI Backend Engineer',
              company: 'Example Tech',
              must_have: ['3+ years Node.js experience'],
              nice_to_have: [],
              responsibilities: ['build backend services'],
              keywords: ['TypeScript'],
            },
          }),
          storage: new FakeStorage(),
        },
        JD_TEXT,
      )
      expect(parsed.ok).toBe(true)

      const updated = await updateParseState(user.id, record.id, {
        parseStatus: 'success',
        parsedData: parsed.ok ? parsed.data : null,
        title: parsed.ok ? parsed.data.title : null,
        company: parsed.ok ? parsed.data.company : null,
      })

      expect(updated.title).toBe('AI Backend Engineer')
      expect(updated.company).toBe('Example Tech')

      const fetched = await getJobJd(user.id, record.id)
      expect((fetched.parsedData as { must_have: string[] }).must_have).toHaveLength(1)
    })

    it('解析结果同样受权限隔离保护（他人读不到）', async () => {
      const owner = await newUser('parse-owner')
      const intruder = await newUser('parse-intruder')

      const { createResume } = await import('@/lib/services/handlers/resume-service')
      const record = await createResume(owner.id, {
        fileName: 'private.pdf',
        fileType: 'pdf',
        fileSize: 100,
        storageKey: `resumes/${owner.id}/private.pdf`,
        isPrimary: false,
      })

      await expect(getResume(intruder.id, record.id)).rejects.toMatchObject({ code: 'not_found' })

      const ownerList = await listResumes(owner.id, PAGE)
      const intruderList = await listResumes(intruder.id, PAGE)
      expect(ownerList.items.map((item) => item.id)).toContain(record.id)
      expect(intruderList.items.map((item) => item.id)).not.toContain(record.id)

      const jdList = await listJobJds(intruder.id, PAGE)
      expect(jdList.items).toHaveLength(0)
    })
  },
)
