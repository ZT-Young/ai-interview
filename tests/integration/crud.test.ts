import { afterAll, describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/errors'
import { createResume, getResume, listResumes, updateResume } from '@/lib/services/handlers/resume-service'
import { createJobJd, getJobJd, updateJobJd } from '@/lib/services/handlers/job-jd-service'
import {
  createSession,
  getSession,
  listSessions,
  transitionSession,
  updateSession,
} from '@/lib/services/handlers/session-service'
import { DEFAULT_SESSION_CONFIG } from '@/lib/validators/session'

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

async function newUser(prefix: string) {
  const user = await createTestUser(prefix)
  createdUserIds.push(user.id)
  return user
}

describe.skipIf(!hasTestDatabase())(
  `资源 CRUD 集成测试（${hasTestDatabase() ? '已连接数据库' : missingTestEnvReason()}）`,
  () => {
    describe('简历 CRUD', () => {
      it('创建并读取', async () => {
        const user = await newUser('crud-resume')
        const created = await createResume(user.id, {
          fileName: 'my.pdf',
          fileType: 'pdf',
          fileSize: 1024,
          storageKey: `resumes/${user.id}/my.pdf`,
        })

        expect(created.parseStatus).toBe('pending')
        expect(created.isPrimary).toBe(false)

        const fetched = await getResume(user.id, created.id)
        expect(fetched.fileName).toBe('my.pdf')
      })

      it('更新解析结果（用户可修改 AI 解析，AGENTS.md §2 第 4 步）', async () => {
        const user = await newUser('crud-resume-update')
        const created = await createResume(user.id, {
          fileName: 'a.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/a.pdf`,
        })

        const updated = await updateResume(user.id, created.id, {
          rawText: '原始文本',
          parsedData: { skills: ['TypeScript'] },
        })

        expect(updated.rawText).toBe('原始文本')
        expect(updated.parsedData).toEqual({ skills: ['TypeScript'] })
      })

      it('设为默认简历时，其他简历自动取消默认（每用户至多一份）', async () => {
        const user = await newUser('crud-resume-primary')
        const first = await createResume(user.id, {
          fileName: 'first.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/first.pdf`,
          isPrimary: true,
        })
        expect(first.isPrimary).toBe(true)

        await createResume(user.id, {
          fileName: 'second.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/second.pdf`,
          isPrimary: true,
        })

        const list = await listResumes(user.id, PAGE)
        const primaries = list.items.filter((item) => item.isPrimary)
        expect(primaries).toHaveLength(1)
        expect(primaries[0]!.fileName).toBe('second.pdf')
      })

      it('分页生效', async () => {
        const user = await newUser('crud-resume-page')
        for (let index = 0; index < 3; index += 1) {
          await createResume(user.id, {
            fileName: `r${index}.pdf`,
            fileType: 'pdf',
            fileSize: 100,
            storageKey: `resumes/${user.id}/r${index}.pdf`,
          })
        }

        const page = await listResumes(user.id, { limit: 2, offset: 0 })
        expect(page.items).toHaveLength(2)
        expect(page.total).toBe(3)
      })
    })

    describe('JD CRUD', () => {
      it('创建、读取、更新', async () => {
        const user = await newUser('crud-jd')
        const created = await createJobJd(user.id, {
          rawText: '岗位职责：负责大模型应用开发，熟悉 Python 与向量数据库，具备工程化落地经验。',
          title: '算法工程师',
        })
        expect(created.parseStatus).toBe('pending')

        const updated = await updateJobJd(user.id, created.id, {
          title: '高级算法工程师',
          parsedData: { mustHave: ['Python'] },
        })
        expect(updated.title).toBe('高级算法工程师')
        expect(updated.parsedData).toEqual({ mustHave: ['Python'] })

        const fetched = await getJobJd(user.id, created.id)
        expect(fetched.title).toBe('高级算法工程师')
      })
    })

    describe('面试会话 CRUD 与状态机', () => {
      it('创建时写入默认配置', async () => {
        const user = await newUser('crud-session')
        const resume = await createResume(user.id, {
          fileName: 's.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/s.pdf`,
        })

        const session = await createSession(user.id, { resumeId: resume.id })

        expect(session.status).toBe('draft')
        expect(session.config).toEqual(DEFAULT_SESSION_CONFIG)
        expect(session.startedAt).toBeNull()
      })

      it('自定义配置覆盖默认值', async () => {
        const user = await newUser('crud-session-config')
        const resume = await createResume(user.id, {
          fileName: 's.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/s.pdf`,
        })

        const session = await createSession(user.id, {
          resumeId: resume.id,
          config: { durationMin: 45, maxQuestions: 6, difficulty: 'hard' },
        })

        expect(session.config).toEqual({
          durationMin: 45,
          maxQuestions: 6,
          difficulty: 'hard',
        })
      })

      it('没有简历也没有 JD 时拒绝创建（无法生成基于背景的题目）', async () => {
        const user = await newUser('crud-session-empty')

        try {
          await createSession(user.id, {})
          throw new Error('应当抛错')
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError)
          expect((error as ApiError).status).toBe(422)
        }
      })

      it('合法状态迁移 draft → planned → in_progress → completed', async () => {
        const user = await newUser('crud-session-flow')
        const resume = await createResume(user.id, {
          fileName: 's.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/s.pdf`,
        })
        const session = await createSession(user.id, { resumeId: resume.id })

        const planned = await transitionSession(user.id, session.id, 'planned')
        expect(planned.status).toBe('planned')

        const inProgress = await transitionSession(user.id, session.id, 'in_progress')
        expect(inProgress.status).toBe('in_progress')
        expect(inProgress.startedAt).not.toBeNull()

        const completed = await transitionSession(user.id, session.id, 'completed')
        expect(completed.status).toBe('completed')
        // completed 必须带 finishedAt（数据库 CHECK 约束）
        expect(completed.finishedAt).not.toBeNull()
      })

      it('非法迁移被拒绝（draft → completed）', async () => {
        const user = await newUser('crud-session-invalid')
        const resume = await createResume(user.id, {
          fileName: 's.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/s.pdf`,
        })
        const session = await createSession(user.id, { resumeId: resume.id })

        try {
          await transitionSession(user.id, session.id, 'completed')
          throw new Error('应当抛错')
        } catch (error) {
          expect((error as ApiError).status).toBe(422)
        }

        // 状态未被改动
        const unchanged = await getSession(user.id, session.id)
        expect(unchanged.status).toBe('draft')
      })

      it('终态不可再迁移', async () => {
        const user = await newUser('crud-session-terminal')
        const resume = await createResume(user.id, {
          fileName: 's.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/s.pdf`,
        })
        const session = await createSession(user.id, { resumeId: resume.id })
        await transitionSession(user.id, session.id, 'planned')
        await transitionSession(user.id, session.id, 'in_progress')
        await transitionSession(user.id, session.id, 'completed')

        await expect(
          transitionSession(user.id, session.id, 'in_progress'),
        ).rejects.toBeInstanceOf(ApiError)
      })

      it('更新关联与配置', async () => {
        const user = await newUser('crud-session-update')
        const resume = await createResume(user.id, {
          fileName: 's.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/s.pdf`,
        })
        const jd = await createJobJd(user.id, {
          rawText: '岗位职责：负责后端服务开发与性能优化，熟悉分布式系统与数据库调优。',
        })
        const session = await createSession(user.id, { resumeId: resume.id })

        const updated = await updateSession(user.id, session.id, {
          jobJdId: jd.id,
          config: { difficulty: 'easy' },
        })

        expect(updated.jobJdId).toBe(jd.id)
        expect(updated.config.difficulty).toBe('easy')
        // 未指定的配置项保留默认值
        expect(updated.config.durationMin).toBe(DEFAULT_SESSION_CONFIG.durationMin)
      })

      it('历史列表按创建时间倒序', async () => {
        const user = await newUser('crud-session-history')
        const resume = await createResume(user.id, {
          fileName: 's.pdf',
          fileType: 'pdf',
          fileSize: 100,
          storageKey: `resumes/${user.id}/s.pdf`,
        })
        const first = await createSession(user.id, { resumeId: resume.id })
        const second = await createSession(user.id, { resumeId: resume.id })

        const list = await listSessions(user.id, PAGE)
        expect(list.items[0]!.id).toBe(second.id)
        expect(list.items[1]!.id).toBe(first.id)
      })
    })
  },
)
