import type { APIRequestContext } from '@playwright/test'

/**
 * E2E 辅助：把 seed 会话重置到确定状态，并清理本用例新建的会话。
 *
 * 面试房间的用例会推进同一个会话的状态机，彼此污染（先跑的结束了面试，
 * 后面的用例再点「请求提示」就会超时）。每个用例开始前重置一次，
 * 才能让每条用例都独立可重复。
 *
 * 重置接口见 `app/api/test/reset-session/route.ts`（生产环境不存在）。
 */

/** 已登录用例统一的「用例开始时间」标记，用于事后清理本次运行新建的数据 */
export interface SessionResetOptions {
  /**
   * 删除该账号在此时刻之后新建的**其它**会话。
   *
   * 「再次训练」用例每次会新建一个会话且无法从 UI 删除，长期累积会把
   * 真正的报告会话挤出 `/sessions` 首页（上限 50 条），
   * 导致「从历史记录进入旧报告」找不到入口——实测就是这样失败的。
   * 传 `new Date().toISOString()` 即可只清理本次运行产生的数据。
   */
  cleanupCreatedAfter?: string
}

/**
 * 每个已登录用例开始前，统一清理本次运行新建的 draft 会话。
 *
 * 只清理、**不重置**目标会话状态（`cleanupOnly: true`）：历史记录类用例依赖
 * 「报告会话保持 completed」才有「查看报告」入口。
 */
export async function cleanupDraftSessions(
  request: APIRequestContext,
  sessionId: string,
): Promise<{ cleanedSessions: number }> {
  return post(request, {
    sessionId,
    cleanupCreatedAfter: new Date().toISOString(),
    cleanupOnly: true,
  })
}

/** 重置会话到「计划已生成、尚未开始」并顺带清理 draft 会话 */
export async function resetSession(
  request: APIRequestContext,
  sessionId: string,
  options: SessionResetOptions = {},
): Promise<{ cleanedSessions: number }> {
  return post(request, { sessionId, ...options })
}

async function post(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<{ cleanedSessions: number }> {
  const token = process.env.E2E_RESET_TOKEN
  if (!token) {
    throw new Error(
      'E2E_RESET_TOKEN 未配置：请在 .env.local 中设置（同时供 dev server 读取），' +
        '例如 E2E_RESET_TOKEN="local-e2e-reset-token"。缺失时无法重置会话状态。',
    )
  }

  const response = await request.post('/api/test/reset-session', {
    headers: { 'x-e2e-reset-token': token },
    data,
  })

  if (!response.ok()) {
    const body = await response.text().catch(() => '')
    throw new Error(`重置会话失败（${response.status()}）：${body}`)
  }

  const payload = (await response.json().catch(() => null)) as
    | { cleanedSessions?: number }
    | null
  return { cleanedSessions: payload?.cleanedSessions ?? 0 }
}
