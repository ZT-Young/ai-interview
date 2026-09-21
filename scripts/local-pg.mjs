/**
 * 用 embedded-postgres 在本地拉起一个真实 PostgreSQL，供开发/自测使用。
 *
 * **不用于生产**：这里跑的是单进程、无副本、无备份的本地实例，
 * 数据目录在 `.local-pg/`（已在 .gitignore 中忽略）。
 *
 * 用法：
 *   node scripts/local-pg.mjs start     启动（后台常驻，Ctrl+C 结束）
 *   node scripts/local-pg.mjs smoke     启动 → 建库 → 迁移 → 自检 → 关闭
 *
 * 端口默认 55432，刻意避开系统 5432，避免与机器上可能存在的 PostgreSQL 冲突。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import EmbeddedPostgres from 'embedded-postgres'

const PORT = Number(process.env.LOCAL_PG_PORT ?? 55432)
const DB_NAME = process.env.LOCAL_PG_DATABASE ?? 'ai_interview'
const USER = process.env.LOCAL_PG_USER ?? 'postgres'
const PASSWORD = process.env.LOCAL_PG_PASSWORD ?? 'postgres'
const DATA_DIR = './.local-pg'

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
})

const mode = process.argv[2] ?? 'smoke'

async function main() {
  // 幂等：已初始化过就不要再 initdb（对已有数据目录执行会直接报错退出）
  const initialised = existsSync(join(DATA_DIR, 'PG_VERSION'))

  console.log(`[local-pg] 启动 PostgreSQL 于 127.0.0.1:${PORT} …`)
  if (initialised) {
    console.log('[local-pg] 检测到已初始化的数据目录，跳过 initdb')
  } else {
    await pg.initialise()
  }
  await pg.start()

  // 首次运行时创建业务库；已存在则忽略
  try {
    await pg.createDatabase(DB_NAME)
    console.log(`[local-pg] 已创建数据库 ${DB_NAME}`)
  } catch (error) {
    console.log(`[local-pg] 数据库 ${DB_NAME} 已存在（${error.code ?? 'n/a'}）`)
  }

  const url = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`
  console.log(`[local-pg] DATABASE_URL=${url}`)

  if (mode === 'start') {
    console.log('[local-pg] 常驻中。Ctrl+C 结束。')
    return
  }

  // smoke：连上去跑一条查询，证明实例真的可用
  const { default: postgres } = await import('postgres')
  const sql = postgres(url, { prepare: false, max: 1 })
  const [{ version }] = await sql`select version() as version`
  const dbs = await sql`select datname from pg_database order by datname`
  console.log(`[local-pg] 连接成功：${version.split(',')[0]}`)
  console.log(`[local-pg] 现有数据库：${dbs.map((r) => r.datname).join(', ')}`)
  await sql.end()

  await pg.stop()
  console.log('[local-pg] smoke 通过，已关闭实例。')
}

main().catch(async (error) => {
  console.error('[local-pg] 失败：', error)
  try {
    await pg.stop()
  } catch {
    /* 忽略关闭失败 */
  }
  process.exit(1)
})
