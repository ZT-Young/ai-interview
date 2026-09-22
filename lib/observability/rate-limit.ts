import { ApiError } from '@/lib/api/errors'

/**
 * 限流（任务要求「配置限流」）。
 *
 * **实现说明（重要，必须如实告知）**：
 * 当前是**进程内内存固定窗口**实现 —— 零依赖、可单测，
 * 但在 Vercel 等**多实例/无状态**部署下每个实例各算一份，
 * 因此只能削弱暴力破解与滥用，**不是精确的全局配额**。
 * 需要精确限流时应把 `RateLimitStore` 换成 Redis/Upstash 实现
 * （见 docs/ops/DEPLOYMENT.md「已知限制」）。
 */

export interface RateLimitRule {
  /** 窗口长度（毫秒） */
  windowMs: number
  /** 窗口内允许的最大请求数 */
  max: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** 允许再次请求的时间戳（毫秒） */
  resetAt: number
  limit: number
}

export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule, now: number): RateLimitResult
  reset(): void
}

interface Bucket {
  count: number
  resetAt: number
}

/**
 * 内存固定窗口实现。
 *
 * 附带**容量上限与惰性清理**：避免被大量不同 key（如伪造 IP）撑爆内存。
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>()
  private readonly maxKeys: number

  constructor(maxKeys = 10_000) {
    this.maxKeys = maxKeys
  }

  hit(key: string, rule: RateLimitRule, now: number): RateLimitResult {
    const existing = this.buckets.get(key)

    if (!existing || existing.resetAt <= now) {
      // 惰性清理：容量达到上限时清掉已过期的桶
      if (!existing && this.buckets.size >= this.maxKeys) this.sweep(now)

      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs })
      return { allowed: true, remaining: rule.max - 1, resetAt: now + rule.windowMs, limit: rule.max }
    }

    existing.count += 1
    const allowed = existing.count <= rule.max

    return {
      allowed,
      remaining: Math.max(0, rule.max - existing.count),
      resetAt: existing.resetAt,
      limit: rule.max,
    }
  }

  /** 清掉已过期的桶；若仍超容量则清空（极端情况下宁可放宽也不 OOM） */
  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key)
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear()
  }

  reset(): void {
    this.buckets.clear()
  }

  /** 仅用于测试观测 */
  get size(): number {
    return this.buckets.size
  }
}

/** 默认存储（进程内单例） */
export const defaultRateLimitStore: RateLimitStore = new InMemoryRateLimitStore()

/**
 * 各端点的限流规则。
 *
 * 取值依据：
 * - 登录/注册：防暴力破解，窗口内次数少
 * - 兑换码：防枚举（码本身高熵，但仍限制尝试频率）
 * - 回调：渠道可能重试，给较宽额度
 * - AI 相关：成本敏感，按用户维度限制
 */
export const RATE_LIMIT_RULES = {
  'auth.login': { windowMs: 60_000, max: 10 },
  'auth.register': { windowMs: 60_000, max: 5 },
  'payments.redeem': { windowMs: 60_000, max: 10 },
  'payments.callback': { windowMs: 60_000, max: 120 },
  'ai.upload': { windowMs: 60_000, max: 20 },
  'ai.generate': { windowMs: 60_000, max: 30 },
} as const

export type RateLimitScope = keyof typeof RATE_LIMIT_RULES

/**
 * 检查并消耗一次配额。
 *
 * @param scope  端点标识（决定规则）
 * @param key    限流维度，通常为 `ip` 或 `user:<id>`
 */
export function checkRateLimit(
  scope: RateLimitScope,
  key: string,
  options: { store?: RateLimitStore; now?: number } = {},
): RateLimitResult {
  const store = options.store ?? defaultRateLimitStore
  const now = options.now ?? Date.now()
  return store.hit(`${scope}:${key}`, RATE_LIMIT_RULES[scope], now)
}

/** 超限时抛出 429（带 Retry-After 语义信息） */
export function assertRateLimit(
  scope: RateLimitScope,
  key: string,
  options: { store?: RateLimitStore; now?: number } = {},
): void {
  const result = checkRateLimit(scope, key, options)

  if (!result.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - (options.now ?? Date.now())) / 1000))
    const error = new ApiError(
      'rate_limited',
      `请求过于频繁，请在 ${retryAfterSec} 秒后重试`,
      { retryAfterSec, limit: result.limit },
    )
    throw error
  }
}

/** 从请求头解析客户端标识（用于未登录场景的限流维度） */
export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}
