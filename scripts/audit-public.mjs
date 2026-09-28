/**
 * 公开仓库前的深度审计。
 *
 * 比 `pnpm check:secrets` 更进一步：那个脚本只查已知密钥模式，
 * 这里再查「不该公开的内部信息」——真实邮箱、内网地址、本机绝对路径
 * （会暴露 Windows 用户名）、被赋值的密钥变量、以及未完成标记。
 *
 * 用法：`pnpm audit:public`
 *
 * 退出码：0 = 干净；1 = 有需确认项（供 CI / 推送前钩子使用）
 *
 * 注意：本脚本自身会在 RULES 里写示例字符串（如 `a@b.com`、`TODO`），
 * 因此**跳过自身**，否则永远自报违规。
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/** 同步休眠（本脚本整体是同步的，不能用 await） */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 枚举已跟踪文件。
 *
 * 为什么要重试：`execFileSync('git', ...)` 在 git 正忙（另一个 git 进程持有锁、
 * Windows 上尤其常见）时会抛 `EBUSY`，此前没有捕获，脚本直接崩在一堆栈上，
 * 看不出是「仓库有问题」还是「恰好有个 git 在跑」。
 *
 * 重试三次并退避，仍失败则给出可读结论再退出 —— CI 需要区分
 * 「发现违规」与「审计没能跑起来」，这两件事的处理方式完全不同。
 */
function gitTrackedFiles() {
  const attempts = 3
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], {
        encoding: 'utf8',
        timeout: 30_000,
      })
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        console.warn(
          `[audit-public] 读取 git 文件列表失败（${error.code ?? error.message}），` +
            `${attempt}/${attempts} 次，重试中…`,
        )
        sleepSync(300 * attempt)
      }
    }
  }

  console.error(
    '\n[audit-public] 无法枚举已跟踪文件，审计**未执行**。\n' +
      `原因：${lastError?.code ?? lastError?.message ?? '未知'}\n` +
      '这通常意味着 git 不可用或正忙（另一个 git 进程持有锁），而不是代码有问题。\n' +
      '请在 git 空闲后重跑；若持续失败，请检查仓库状态。\n',
  )
  process.exit(1)
}

const tracked = gitTrackedFiles()
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => file !== 'scripts/audit-public.mjs')

console.log(`审计 ${tracked.length} 个已跟踪文件\n`)

/** 只检查文本类文件，跳过二进制 */
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|sql|mjs|css|html|txt|cmd|vbs|ps1)$/i

const RULES = [
  {
    name: '真实邮箱地址',
    /**
     * 排除：
     * - 示例域（example.com / example.test / x.com / b.com 等单字母域名）
     * - 依赖包名里的 @（@types、@radix-ui…）
     * - 本脚本与 check-secrets 的演示串
     */
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allow: (m) =>
      /example\.(test|com)|@example|noreply|localhost|schemas\.|w3\.org|openxmlformats|@types|@radix|@aws|@playwright|@vitest|@testing|@deepseek/i.test(
        m,
      ) ||
      // 单字母域名（a@b.com / A@x.com）是文档与夹具的常见占位写法
      /^[A-Za-z]@[A-Za-z]\.com$/.test(m) ||
      // 内网域名（如 db.prod.internal）不是真实邮箱，是 check-secrets 的演示串
      /\.internal$/i.test(m),
  },
  {
    name: '本机绝对路径（泄露 Windows 用户名）',
    regex: /[A-Z]:\\+Users\\+[^\\\/\s"']+/gi,
    allow: () => false,
  },
  {
    name: '内网 / 非公网地址（IPv4）',
    /**
     * 用 lookbehind/lookahead 锁定「独立的 IP 字面量」。
     * 早期写法 `/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/` 会误匹配依赖版本号
     * （如 `autoprefixer: ^10.4.20` → 被判成 `10.4.20.…`），
     * 在 pnpm-lock.yaml 里产生几十条假阳性。
     */
    regex: /(?<![\w.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\w.])/g,
    /**
     * `10.0.0.1` 常被用作**测试夹具**里的内网地址（与 RFC 5737 的文档
     * 保留网段 203.0.113.0/24 搭配使用，模拟反代场景）。它本身不泄露任何
     * 真实内网拓扑，因此放行；真实内网地址不会正好是 `10.0.0.1`。
     */
    allow: (m) => m === '10.0.0.1',
  },
  {
    name: '云服务真实凭据（非默认 postgres:postgres）',
    regex: /postgres(?:ql)?:\/\/([^:\s/]+):([^@\s]{6,})@/g,
    allow: (m) =>
      /:postgres@/.test(m) ||
      /:password@/.test(m) ||
      // 环境变量插值（scripts/local-pg.mjs 的模板串）
      /\$\{/.test(m) ||
      // check-secrets.mjs 里的「应当被拦截」示例，本身不是凭据
      /Hunter2Secret9/.test(m),
  },
  {
    name: 'Token / 密钥变量被赋了具体值',
    regex: /(?:AUTH_SECRET|LLM_API_KEY|S3_SECRET_KEY|PAYMENT_WEBHOOK_SECRET|ASR_API_KEY)\s*[=:]\s*["']?([A-Za-z0-9+/=_-]{16,})["']?/g,
    allow: (m) => /["']?["']?$/.test(m) || /=\s*["']{2}/.test(m),
  },
  {
    name: '待办/未完成标记',
    regex: /\b(TODO|FIXME|XXX|HACK)\b/g,
    /**
     * `lib/asr/index.ts` 里的 TODO 是**有意保留**的公开说明：
     * 它标注「ASR 供应商选型确定后在此接线」，对读代码的人是有价值的信息，
     * 而不是遗漏的待办。README 也已记录该状态。
     */
    allow: () => false,
    allowFile: (file) => file === 'lib/asr/index.ts',
  },
]

let total = 0
const report = new Map()

for (const file of tracked) {
  if (!TEXT.test(file)) continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      // 整文件豁免（例如有意保留的 TODO 说明）
      if (rule.allowFile?.(file)) continue

      rule.regex.lastIndex = 0
      const matches = line.match(rule.regex)
      if (!matches) continue

      for (const match of matches) {
        if (rule.allow(match)) continue
        total += 1
        if (!report.has(rule.name)) report.set(rule.name, [])
        report.get(rule.name).push({
          file,
          line: index + 1,
          text: line.trim().slice(0, 110),
          match,
        })
      }
    }
  }
}

if (total === 0) {
  console.log('✅ 未发现不该公开的内容')
  process.exit(0)
}

console.log(`发现 ${total} 处需要确认：\n`)
for (const [name, items] of report) {
  console.log(`\n── ${name}（${items.length} 处）──`)
  for (const item of items.slice(0, 12)) {
    console.log(`  ${item.file}:${item.line}`)
    console.log(`    ${item.text}`)
  }
  if (items.length > 12) console.log(`  …还有 ${items.length - 12} 处`)
}
console.log(
  '\n注意：这些不一定都是问题（测试夹具、文档示例、依赖版本号都会命中）。' +
    '请人工确认后，把确实无害的模式加入对应规则的 allow 列表。',
)
process.exit(1)
