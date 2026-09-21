import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'

import * as schema from './schema'

export type Database = ReturnType<typeof drizzle<typeof schema>>

/**
 * 数据库不可用（未配置 `DATABASE_URL`）。
 *
 * **为什么要有专门的错误类型**：早期版本这里抛的是裸 `Error`，
 * 导致「未配置数据库」被 `apiHandler` 的兜底分支当成未知异常，
 * 返回 **500「服务器内部错误」** —— 用户完全不知道要去配环境变量。
 *
 * 有了可识别类型后，`lib/api/errors.ts` 会把它映射为 **503 + 可执行提示**。
 */
export class DatabaseUnavailableError extends Error {
  readonly code = 'database_unavailable' as const

  constructor(
    message = '[db] 缺少 DATABASE_URL。请在 .env.local 中配置 PostgreSQL 连接串（参考 .env.example）。',
  ) {
    super(message)
    this.name = 'DatabaseUnavailableError'
  }
}

/**
 * 连接池缓存的落点：**必须是 globalThis，不能只用模块级变量**。
 *
 * 原因（实测踩过，代价是整库连接被占满）：
 * Next.js dev 会把同一模块打进**多个 server bundle**（RSC 渲染、
 * route handler、middleware 等各自一份），每份模块副本都有自己的作用域，
 * 于是「模块级单例」实际变成**每份 bundle 一个连接池**，各占 `max: 10`。
 * 表现为：跑几轮 E2E 后 Postgres 报
 * `sorry, too many clients already`（实测从 1 涨到 29，每轮 +28，
 * max_connections=100 时 3~4 轮即耗尽），随后所有页面因查库失败而空白。
 *
 * 挂到 globalThis 后，无论多少份 bundle 副本都共用同一个池。
 * 生产环境每进程只有一份模块，行为不变。
 */
const GLOBAL_KEY = Symbol.for('ai-interview.db-singleton')

interface DbSingleton {
  db?: Database
  client?: Sql
}

function singleton(): DbSingleton {
  const holder = globalThis as unknown as Record<symbol, DbSingleton | undefined>
  if (!holder[GLOBAL_KEY]) holder[GLOBAL_KEY] = {}
  return holder[GLOBAL_KEY]!
}

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new DatabaseUnavailableError()
  return url
}

/** 是否已配置数据库。用于测试与健康检查在缺配置时优雅降级。 */
export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/**
 * 获取 Drizzle 实例（全局缓存，避免 dev 多 bundle 与热更新重复建池）。
 *
 * 采用惰性连接：**导入本模块不会触发任何网络请求**，
 * 因此在没有 DATABASE_URL 的环境下 `pnpm build` 依然可以成功。
 * 真正查询时才需要有效连接串。
 */
export function getDb(): Database {
  const store = singleton()
  if (!store.db) {
    store.client = postgres(connectionString(), {
      max: 10,
      // 兼容 Neon / Supabase 连接池（PgBouncer 不支持 prepared statement）
      prepare: false,
      // 空闲连接及时归还，避免 dev 期间长时间占位
      idle_timeout: 20,
    })
    store.db = drizzle(store.client, { schema })
  }
  return store.db
}

/** 关闭连接（测试收尾 / 优雅停机）。 */
export async function closeDb(): Promise<void> {
  const store = singleton()
  if (store.client) {
    await store.client.end({ timeout: 5 })
    store.client = undefined
    store.db = undefined
  }
}

/** 健康检查：返回是否可连通，不抛异常，供 /api/health 与运维脚本使用。 */
export async function checkDatabase(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasDatabaseUrl()) {
    return { ok: false, error: '未配置 DATABASE_URL' }
  }

  let client: Sql | undefined
  try {
    client = postgres(connectionString(), { max: 1, prepare: false })
    await client`select 1`
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await client?.end({ timeout: 5 })
  }
}

export { schema }
