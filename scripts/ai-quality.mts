/**
 * AI 质量看板 —— 从 `ai_call_logs` 聚合真实运行指标。
 *
 * 用法：
 *   pnpm ai:quality                       # 控制台输出（近 30 天）
 *   pnpm ai:quality --days 7              # 只看近 7 天
 *   pnpm ai:quality --json .local/ai-quality.json   # 同时写出 JSON
 *   pnpm ai:quality --price-in 2 --price-out 8      # 覆盖单价（元 / 百万 token）
 *
 * 为什么要这个脚本：
 * `ai_call_logs` 一直在记录 operation / status / durationMs / tokens / promptVersion，
 * 但此前没有任何东西去读它 —— 「模型到底稳不稳、慢不慢、多少钱」只能靠体感。
 * 这个脚本把它变成可以贴在简历上的数字，也是后续每次改 prompt / 换模型的**基线**。
 *
 * 注意：
 * - 只做**只读聚合**，不写任何表
 * - 不输出任何 prompt / 简历原文（ai_call_logs 本身也不存这些）
 * - 单价默认按 DeepSeek 公开价（元 / 百万 token）估算，仅供趋势对比，
 *   实际以供应商账单为准，务必用 --price-in / --price-out 校正
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { sql } from 'drizzle-orm'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { getDb, hasDatabaseUrl } from '@/db/client'

/** 默认单价（元 / 百万 token），可用命令行覆盖 */
const DEFAULT_PRICE_IN = 2
const DEFAULT_PRICE_OUT = 8

interface Row {
  operation: string
  calls: number
  ok: number
  errors: number
  p50: number | null
  p95: number | null
  p99: number | null
  promptTokens: number
  completionTokens: number
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function numberArg(flag: string, fallback: number): number {
  const raw = argValue(flag)
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * 归一 `db.execute()` 的返回。
 *
 * drizzle + postgres.js 直接返回**行数组**，而 pg 驱动返回 `{ rows }`；
 * 这里两种都兼容，换驱动时不会静默变成 undefined。
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  const nested = (result as { rows?: unknown })?.rows
  return Array.isArray(nested) ? (nested as T[]) : []
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

async function main(): Promise<void> {
  if (!hasDatabaseUrl()) {
    console.error('[ai-quality] 缺少 DATABASE_URL，无法读取调用日志（先 pnpm local:db 起库）')
    process.exitCode = 1
    return
  }

  const days = numberArg('--days', 30)
  const priceIn = numberArg('--price-in', DEFAULT_PRICE_IN)
  const priceOut = numberArg('--price-out', DEFAULT_PRICE_OUT)
  const jsonPath = argValue('--json')

  const db = getDb()
  const since = sql`now() - make_interval(days => ${days})`

  const opResult = await db.execute(
    sql`
      select
        operation,
        count(*)::int                                                        as calls,
        count(*) filter (where status = 'success')::int                      as ok,
        count(*) filter (where status = 'error')::int                        as errors,
        percentile_cont(0.5)  within group (order by duration_ms)::int        as p50,
        percentile_cont(0.95) within group (order by duration_ms)::int        as p95,
        percentile_cont(0.99) within group (order by duration_ms)::int        as p99,
        coalesce(sum(prompt_tokens), 0)::int                                  as "promptTokens",
        coalesce(sum(completion_tokens), 0)::int                              as "completionTokens"
      from ai_call_logs
      where created_at >= ${since} and duration_ms is not null
      group by operation
      order by calls desc
    `,
  )
  const rows = { rows: rowsOf<Row>(opResult) }

  const errorResult = await db.execute(
    sql`
      select coalesce(error_code, 'unknown') as code, count(*)::int as n
      from ai_call_logs
      where created_at >= ${since} and status = 'error'
      group by 1
      order by n desc
      limit 10
    `,
  )
  const errorRows = { rows: rowsOf<{ code: string; n: number }>(errorResult) }

  const versionResult = await db.execute(
    sql`
      select coalesce(prompt_version, 'unknown') as version,
             coalesce(model, 'unknown')          as model,
             count(*)::int                       as n
      from ai_call_logs
      where created_at >= ${since}
      group by 1, 2
      order by n desc
      limit 10
    `,
  )
  const versionRows = { rows: rowsOf<{ version: string; model: string; n: number }>(versionResult) }

  const totals = rows.rows.reduce(
    (acc, row) => ({
      calls: acc.calls + row.calls,
      ok: acc.ok + row.ok,
      errors: acc.errors + row.errors,
      promptTokens: acc.promptTokens + Number(row.promptTokens ?? 0),
      completionTokens: acc.completionTokens + Number(row.completionTokens ?? 0),
    }),
    { calls: 0, ok: 0, errors: 0, promptTokens: 0, completionTokens: 0 },
  )

  const cost =
    (totals.promptTokens / 1_000_000) * priceIn + (totals.completionTokens / 1_000_000) * priceOut

  console.log(`\nAI 调用质量看板（近 ${days} 天，单价 输入 ¥${priceIn} / 输出 ¥${priceOut} 每百万 token）`)
  console.log('='.repeat(96))

  if (totals.calls === 0) {
    console.log('\n近 %s 天没有 AI 调用日志 —— 先跑几场真实面试或执行 pnpm eval:scoring 产生数据。', days)
    return
  }

  const successRate = ((totals.ok / totals.calls) * 100).toFixed(1)
  console.log(
    `\n总调用 ${totals.calls} 次 · 成功 ${totals.ok} · 失败 ${totals.errors} · 成功率 ${successRate}%`,
  )
  console.log(
    `token 用量：输入 ${totals.promptTokens.toLocaleString()} / 输出 ${totals.completionTokens.toLocaleString()} · 估算成本 ¥${cost.toFixed(2)}`,
  )
  console.log(`平均单次成本 ¥${(cost / totals.calls).toFixed(4)}\n`)

  const header = [
    pad('operation', 14),
    padLeft('calls', 7),
    padLeft('成功率', 9),
    padLeft('P50 ms', 9),
    padLeft('P95 ms', 9),
    padLeft('P99 ms', 9),
    padLeft('输出 tok', 10),
  ].join(' ')
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const row of rows.rows) {
    const rate = `${((row.ok / row.calls) * 100).toFixed(0)}%`
    console.log(
      [
        pad(row.operation, 14),
        padLeft(String(row.calls), 7),
        padLeft(rate, 9),
        padLeft(String(row.p50 ?? '-'), 9),
        padLeft(String(row.p95 ?? '-'), 9),
        padLeft(String(row.p99 ?? '-'), 9),
        padLeft(Number(row.completionTokens ?? 0).toLocaleString(), 10),
      ].join(' '),
    )
  }

  if (errorRows.rows.length > 0) {
    console.log('\n失败原因分布')
    for (const row of errorRows.rows) console.log(`  ${pad(row.code, 24)} ${row.n}`)
  }

  if (versionRows.rows.length > 0) {
    console.log('\nprompt 版本 / 模型分布')
    for (const row of versionRows.rows) {
      console.log(`  ${pad(row.version, 16)} ${pad(row.model, 24)} ${row.n}`)
    }
  }

  if (jsonPath) {
    const target = resolve(process.cwd(), jsonPath)
    writeFileSync(
      target,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          days,
          price: { inputPerMillion: priceIn, outputPerMillion: priceOut },
          totals: { ...totals, successRate: Number(successRate), estimatedCostCny: Number(cost.toFixed(2)) },
          byOperation: rows.rows,
          errors: errorRows.rows,
          versions: versionRows.rows,
        },
        null,
        2,
      ),
      'utf8',
    )
    console.log(`\n已写出 JSON：${target}`)
  }

  console.log('')
  process.exit(0)
}

main().catch((error) => {
  console.error('[ai-quality] 执行失败', error)
  process.exit(1)
})
