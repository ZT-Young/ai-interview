import { describe, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users, payments, interviewSessions, reports, resumes, jobJds } from '@/db/schema'

describe('dbg101', () => {
  it('seed account state', async () => {
    const db = getDb()
    const u = (await db.select().from(users).where(eq(users.email, 'e2e-seed-a2000857@example.test')))[0]
    console.log('USER:', JSON.stringify({ id: u?.id, membership: u?.membership, freeCredits: u?.freeCredits }))
    const pays = await db.select({ s: payments.status, t: payments.unlockType, c: payments.creditsGranted }).from(payments).where(eq(payments.userId, u!.id))
    console.log('PAYMENTS:', pays.length, JSON.stringify(pays))
    const sess = await db.select({ id: interviewSessions.id, status: interviewSessions.status, phase: interviewSessions.phase, r: interviewSessions.resumeId, j: interviewSessions.jobJdId }).from(interviewSessions).where(eq(interviewSessions.userId, u!.id))
    console.log('SESSIONS:', sess.length)
    sess.forEach((s) => console.log(`  ${s.id} ${s.status}/${s.phase} resume=${s.r ? 'y' : 'n'} jd=${s.j ? 'y' : 'n'}`))
    const reps = await db.select({ id: reports.id, sid: reports.sessionId }).from(reports).where(eq(reports.userId, u!.id))
    console.log('REPORTS:', reps.map((r) => r.sid).join(', '))
    const rs = await db.select({ id: resumes.id }).from(resumes).where(eq(resumes.userId, u!.id))
    const js = await db.select({ id: jobJds.id }).from(jobJds).where(eq(jobJds.userId, u!.id))
    console.log('RESUMES/JDS:', rs.length, js.length)
  })
})
