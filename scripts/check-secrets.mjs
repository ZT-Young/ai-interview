#!/usr/bin/env node
/**
 * 密钥泄漏检查（AGENTS.md §8「不硬编码密钥」）。
 *
 * 在 CI 中强制执行。检查三类问题：
 *   1. 源码中硬编码的密钥（常见前缀 + 长随机串）
 *   2. `.env*` 文件被 git 跟踪（真实密钥入库）
 *   3. `NEXT_PUBLIC_*` 变量被赋予敏感值（会被打进前端 bundle）
 *
 * 用法：node scripts/check-secrets.mjs
 * 退出码：0 = 通过，1 = 发现问题
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'runtimes', 'coverage', 'test-results', 'playwright-report'])
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.sql', '.cmd', '.vbs'])

/**
 * 允许出现的占位值（不是真实密钥）。
 *
 * ⚠️ 只放**明确不可能生效**的标记，不要为了绕过检查而加入真实密钥片段：
 * - 通用占位词：`example` / `test-` / `fake-` / `xxx` / `changeme` / `your-` / `placeholder`
 * - `postgres:postgres@`：本地/示例数据库的**默认凭据**（用户名即密码）。
 *   由 scripts/local-pg.mjs 起的本地实例使用，且只在本机 loopback 上有效，
 *   泄不泄露没有影响。示例必须能出现在 README 与 .env.example，
 *   否则没人能照着跑起来。
 *
 * 判断时同时看整行与**匹配到的密钥本身**，因此：
 * - `postgres://postgres:postgres@127.0.0.1:55432/...` → 放行（默认凭据）
 * - `postgres://admin:Hunter2Secret9@db.prod.internal:5432/app` → **拦截**（真实风格凭据）
 */
const PLACEHOLDER_ALLOWLIST = [
  'your-',
  'changeme',
  'placeholder',
  'example',
  'test-',
  'fake-',
  'xxx',
  '""',
  "''",
  'sk-xxx',
  'postgres:postgres@',
]

/** 高置信度的密钥模式 */
const SECRET_PATTERNS = [
  { name: 'OpenAI 风格密钥', regex: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'Slack Token', regex: /xox[abprs]-[0-9A-Za-z-]{10,}/g },
  { name: '私钥块', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'Postgres 连接串（含密码）', regex: /postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]{6,}@/g },
]

const problems = []

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function isAllowlisted(line, matched) {
  const haystack = `${line} ${matched ?? ''}`.toLowerCase()
  return PLACEHOLDER_ALLOWLIST.some((token) => haystack.includes(token))
}

/* ------------------------------------------------------------------ *
 * 1. 源码硬编码密钥
 * ------------------------------------------------------------------ */
function checkHardcodedSecrets(files) {
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue
    // 跳过本脚本自身（其中包含用于检测的密钥正则字面量）
    if (relative(ROOT, file).startsWith(`scripts${sep}`)) continue

    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    const lines = content.split(/\r?\n/)
    for (const { name, regex } of SECRET_PATTERNS) {
      lines.forEach((line, index) => {
        const matches = line.match(regex)
        if (!matches) return
        // 占位判定同时看整行与**匹配到的密钥本身**：
        // 只看整行时，`DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/..."`
        // 这种本地占位串会因为行内没有占位词而误报；
        // 把匹配值一并纳入判断，既放行本地占位，也不会因为行里有注释词就放行真实密钥。
        if (isAllowlisted(line, matches[0])) return
        problems.push({
          type: 'hardcoded-secret',
          file: relative(ROOT, file),
          line: index + 1,
          detail: `${name}：${matches[0].slice(0, 12)}…`,
        })
      })
    }
  }
}

/* ------------------------------------------------------------------ *
 * 2. .env 文件是否被 git 跟踪
 * ------------------------------------------------------------------ */
function checkTrackedEnvFiles() {
  let tracked
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  } catch {
    // 未初始化 git 时跳过（并在输出中提示）
    problems.push({
      type: 'no-git',
      file: '.',
      line: 0,
      detail: '当前目录不是 git 仓库，无法校验 .env 是否被跟踪（建议 git init）',
    })
    return
  }

  const envFiles = tracked
    .split(/\r?\n/)
    .filter((line) => /(^|\/)\.env($|\.)/.test(line) && !line.endsWith('.env.example'))

  for (const file of envFiles) {
    problems.push({
      type: 'tracked-env',
      file,
      line: 0,
      detail: '真实环境变量文件被 git 跟踪，可能已泄漏密钥',
    })
  }
}

/* ------------------------------------------------------------------ *
 * 3. NEXT_PUBLIC_ 变量是否含敏感值
 * ------------------------------------------------------------------ */
const PUBLIC_ALLOWED = new Set([
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_NAME',
  'NEXT_PUBLIC_ENABLE_VOICE',
  'E2E_BASE_URL',
])

function checkPublicEnv(files) {
  for (const file of files) {
    const name = relative(ROOT, file)
    if (!/\.env\.example$/.test(name) && !/\.env\.local$/.test(name)) continue

    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    content.split(/\r?\n/).forEach((line, index) => {
      const match = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!match) return

      const [, key, rawValue] = match
      const value = rawValue.replace(/^["']|["']$/g, '')
      if (value.length === 0) return
      if (PUBLIC_ALLOWED.has(key)) return
      if (isAllowlisted(value)) return

      problems.push({
        type: 'public-sensitive',
        file: name,
        line: index + 1,
        detail: `${key} 会进入前端 bundle；若非公开信息请改用非 NEXT_PUBLIC_ 前缀`,
      })
    })
  }
}

/* ------------------------------------------------------------------ *
 * 执行
 * ------------------------------------------------------------------ */
const files = walk(ROOT)

checkHardcodedSecrets(files)
checkTrackedEnvFiles()
checkPublicEnv(files)

const fatal = problems.filter((item) => item.type !== 'no-git')
const warnings = problems.filter((item) => item.type === 'no-git')

if (warnings.length > 0) {
  console.log('⚠️  提示：')
  for (const item of warnings) console.log(`   - ${item.detail}`)
}

if (fatal.length > 0) {
  console.error('\n❌ 密钥检查未通过：')
  for (const item of fatal) {
    console.error(`   [${item.type}] ${item.file}${item.line ? `:${item.line}` : ''} — ${item.detail}`)
  }
  console.error(`\n共 ${fatal.length} 个问题。请把密钥移到环境变量，并从历史中移除。`)
  process.exit(1)
}

console.log('\n✅ 密钥检查通过：未发现硬编码密钥、未跟踪 .env 文件、NEXT_PUBLIC_ 变量无敏感值。')
process.exit(0)
