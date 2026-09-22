import { afterAll, describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/errors'
import {
  createResume,
  deleteResume,
  getResume,
  listResumes,
  updateResume,
} from '@/lib/services/handlers/resume-service'
import {
  createJobJd,
  deleteJobJd,
  getJobJd,
  listJobJds,
  updateJobJd,
} from '@/lib/services/handlers/job-jd-service'
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  transitionSession,
  updateSession,
} from '@/lib/services/handlers/session-service'

import {
  createTestUser,
  hasTestDatabase,
  hardDeleteUsers,
  missingTestEnvReason,
} from '../helpers/db'

const createdUserIds: string[] = []
const PAGE = { limit: 20, offset: 0 }

afterAll(async () => {
  if (hasTestDatabase()) await hardDeleteUsers(createdUserIds)
})

async function twoUsers(prefix: string) {
  const owner = await createTestUser(`${prefix}-owner`)
  const intruder = await createTestUser(`${prefix}-intruder`)
  createdUserIds.push(owner.id, intruder.id)
  return { owner, intruder }
}

async function seedResume(userId: string, name = 'owner-resume.pdf') {
  return createResume(userId, {
    fileName: name,
    fileType: 'pdf',
    fileSize: 2048,
    storageKey: `resumes/${userId}/${name}`,
  })
}

async function seedJobJd(userId: string) {
  return createJobJd(userId, {
    rawText: '岗位职责：负责 AI 应用后端开发，要求熟悉 TypeScript、PostgreSQL 与大模型接口集成。',
    title: 'AI 应用开发工程师',
    company: '示例公司',
  })
}

const expectNotFound = async (promise: Promise<unknown>) => {
  try {
    await promise
    throw new Error('应当抛出 not_found')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('not_found')
    // 刻意用 404 而非 403：不泄露「该 ID 存在」
    expect((error as ApiError).status).toBe(404)
  }
}

describe.skipIf(!hasTestDatabase())(
  `权限隔离集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    describe('简历', () => {
      it('他人无法读取', async () => {
        const { owner, intruder } = await twoUsers('resume-read')
        const resume = await seedResume(owner.id)

        // 本人可读
        await expect(getResume(owner.id, resume.id)).resolves.toMatchObject({ id: resume.id })
        // 他人不可读
        await expectNotFound(getResume(intruder.id, resume.id))
      })

      it('他人无法更新', async () => {
        const { owner, intruder } = await twoUsers('resume-update')
        const resume = await seedResume(owner.id)

        await expectNotFound(updateResume(intruder.id, resume.id, { fileName: 'hacked.pdf' }))

        // 确认数据未被改动
        const unchanged = await getResume(owner.id, resume.id)
        expect(unchanged.fileName).toBe('owner-resume.pdf')
      })

      it('他人无法删除，且不会造成软删除', async () => {
        const { owner, intruder } = await twoUsers('resume-delete')
        const resume = await seedResume(owner.id)

        await expectNotFound(deleteResume(intruder.id, resume.id))
        await expect(getResume(owner.id, resume.id)).resolves.toMatchObject({ id: resume.id })
      })

      it('列表只返回自己的数据', async () => {
        const { owner, intruder } = await twoUsers('resume-list')
        const ownerResume = await seedResume(owner.id)
        const intruderResume = await seedResume(intruder.id, 'intruder.pdf')

        const ownerList = await listResumes(owner.id, PAGE)
        const ids = ownerList.items.map((item) => item.id)

        expect(ids).toContain(ownerResume.id)
        expect(ids).not.toContain(intruderResume.id)
        expect(ownerList.total).toBe(1)
      })

      it('软删除后本人也读不到，且不再出现在列表', async () => {
        const { owner } = await twoUsers('resume-softdelete')
        const resume = await seedResume(owner.id)

        await deleteResume(owner.id, resume.id)

        await expectNotFound(getResume(owner.id, resume.id))
        const list = await listResumes(owner.id, PAGE)
        expect(list.items.map((item) => item.id)).not.toContain(resume.id)
      })
    })

    describe('岗位 JD', () => {
      it('他人无法读取/更新/删除', async () => {
        const { owner, intruder } = await twoUsers('jd')
        const jd = await seedJobJd(owner.id)

        await expect(getJobJd(owner.id, jd.id)).resolves.toMatchObject({ id: jd.id })
        await expectNotFound(getJobJd(intruder.id, jd.id))
        await expectNotFound(updateJobJd(intruder.id, jd.id, { title: '篡改' }))
        await expectNotFound(deleteJobJd(intruder.id, jd.id))
      })

      it('列表只返回自己的数据', async () => {
        const { owner, intruder } = await twoUsers('jd-list')
        const ownerJd = await seedJobJd(owner.id)
        const intruderJd = await seedJobJd(intruder.id)

        const list = await listJobJds(owner.id, PAGE)
        const ids = list.items.map((item) => item.id)

        expect(ids).toContain(ownerJd.id)
        expect(ids).not.toContain(intruderJd.id)
      })
    })

    describe('面试会话', () => {
      it('他人无法读取/更新/删除', async () => {
        const { owner, intruder } = await twoUsers('session')
        const resume = await seedResume(owner.id)
        const session = await createSession(owner.id, { resumeId: resume.id })

        await expect(getSession(owner.id, session.id)).resolves.toMatchObject({ id: session.id })
        await expectNotFound(getSession(intruder.id, session.id))
        await expectNotFound(updateSession(intruder.id, session.id, { resumeId: null }))
        await expectNotFound(deleteSession(intruder.id, session.id))
        await expectNotFound(transitionSession(intruder.id, session.id, 'planned'))
      })

      it('不能把自己会话关联到他人的简历（越权引用）', async () => {
        const { owner, intruder } = await twoUsers('session-ref')
        const ownerResume = await seedResume(owner.id)

        await expectNotFound(createSession(intruder.id, { resumeId: ownerResume.id }))
      })

      it('不能把自己会话关联到他人的 JD', async () => {
        const { owner, intruder } = await twoUsers('session-ref-jd')
        const ownerJd = await seedJobJd(owner.id)

        await expectNotFound(createSession(intruder.id, { jobJdId: ownerJd.id }))
      })

      it('列表只返回自己的会话', async () => {
        const { owner, intruder } = await twoUsers('session-list')
        const ownerResume = await seedResume(owner.id)
        const intruderResume = await seedResume(intruder.id)
        const ownerSession = await createSession(owner.id, { resumeId: ownerResume.id })
        await createSession(intruder.id, { resumeId: intruderResume.id })

        const list = await listSessions(owner.id, PAGE)
        const ids = list.items.map((item) => item.id)

        expect(ids).toContain(ownerSession.id)
        expect(ids).toHaveLength(1)
      })
    })
  },
)
