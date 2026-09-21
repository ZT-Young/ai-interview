/**
 * 一次性拉起本地开发环境：PostgreSQL → 迁移 → dev server。
 *
 * 用法：
 *   pnpm dev:all
 *
 * 为什么需要它：本项目跑通需要「本地 PostgreSQL + 已应用迁移 + dev server」三件事，
 * 分开手工启动容易漏步骤（漏迁移会得到一堆看不懂的 5xx，
 * 漏数据库会让所有接口返回 503）。这里按正确顺序编排并给出明确日志。
 *
 * 特点：
 * - 启动前检查并复用已在运行的实例（重复执行不会冲突）
 * - 自动执行 `pnpm db:migrate`（幂等：已应用的迁移会跳过）
 * - 当前进程序退出时（Ctrl+C）一并停掉它启动的 PostgreSQL
 *
 * **仅用于本地开发**：PostgreSQL 由 embedded-postgres 提供，
 * 单进程、无副本、无备份，数据目录为 `.local-pg/`（已在 .gitignore 中忽略）。
 */
import { spawn } from 'node:child_process'
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

/** 端口是否已被监听（据此判断实例是否已在运行） */
async function portInUse(port) {
  const { createConnection } = await import('node:net')
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`[dev:all] ${label} …`)
    const child = spawn(command, args, { stdio: 'inherit', shell: true })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} 失败（exit ${code}）`))
    })
    child.on('error', reject)
  })
}

let startedPg = false

async function main() {
  // ① PostgreSQL
  if (await portInUse(PORT)) {
    console.log(`[dev:all] 端口 ${PORT} 已在监听，复用现有 PostgreSQL`)
  } else {
    if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
      console.log('[dev:all] 未发现数据目录，首次初始化（需要几十秒）…')
      await pg.initialise()
    }
    console.log(`[dev:all] 启动 PostgreSQL 于 127.0.0.1:${PORT} …`)
    await pg.start()
    startedPg = true
    try {
      await pg.createDatabase(DB_NAME)
      console.log(`[dev:all] 已创建数据库 ${DB_NAME}`)
    } catch {
      // 已存在即可
    }
  }

  // ② 迁移（幂等）
  await run('pnpm', ['db:migrate'], '应用数据库迁移')

  // ③ dev server（前台运行，Ctrl+C 结束）
  console.log('')
  console.log('[dev:all] 启动 dev server：http://localhost:3000')
  console.log('[dev:all] Ctrl+C 结束（会一并停掉由本命令启动的 PostgreSQL）')
  console.log('')
  await run('pnpm', ['dev'], '启动 dev server')
}

async function shutdown() {
  if (startedPg) {
    console.log('\n[dev:all] 停止 PostgreSQL …')
    await pg.stop().catch(() => {})
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch(async (error) => {
  console.error('[dev:all] 失败：', error instanceof Error ? error.message : error)
  if (startedPg) await pg.stop().catch(() => {})
  process.exit(1)
})
