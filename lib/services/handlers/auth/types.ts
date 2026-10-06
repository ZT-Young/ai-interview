/**
 * 认证领域——共享类型与纯辅助（抽离自 auth-service.ts）。
 *
 * 本文件**不含任何数据库 / 副作用**：只做类型定义与纯函数转换
 * （规范化、用户名分配、IP 解析）。注册 / 登录 / 资料三领域模块都依赖这里，
 * 放在独立文件可避免循环依赖，并保证「规范化必须在查重/写库/登录查找三处一致」
 * 这一关键不变量集中在一处。
 */

import { randomInt } from 'node:crypto'

import type { User } from '@/db/schema'

/** 对外暴露的用户视图：**绝不包含 passwordHash** */
export interface PublicUser {
  id: string
  /** 纯手机号注册的用户没有邮箱，可能为 null */
  email: string | null
  phone: string | null
  /** 登录标识之一，也是展示用昵称的默认来源 */
  username: string | null
  name: string | null
  avatarUrl: string | null
  membership: User['membership']
  freeCredits: number
  emailVerified: boolean
  phoneVerified: boolean
  /**
   * 是否管理员 —— 前端据此决定是否显示后台入口。
   * **仅用于展示**：真正的访问控制在服务端 `requireAdmin()` 重新校验。
   */
  isAdmin: boolean
  /**
   * 当前身份：`candidate` 求职者 / `interviewer` 面试官（DATA_MODEL §2.10）。
   * 决定登录后落到哪一侧的工作台，以及导航展示哪一套入口。
   */
  role: 'candidate' | 'interviewer'
  createdAt: string
}

export interface RequestMeta {
  ip?: string | null
  userAgent?: string | null
}

export interface AuthResult {
  user: PublicUser
  /** 明文会话令牌，仅用于写入 Cookie */
  token: string
  expiresAt: Date
}

export function toPublicUser(row: User): PublicUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatarUrl,
    membership: row.membership,
    freeCredits: row.freeCredits,
    emailVerified: row.emailVerifiedAt !== null,
    phoneVerified: row.phoneVerifiedAt !== null,
    isAdmin: row.isAdmin,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 邮箱规范化：统一转小写并去首尾空白。
 *
 * **必须在「查重」与「写库」以及「登录查找」三处使用同一个函数**，
 * 否则会出现两个真实缺陷：
 * 1. `A@x.com` 与 `a@x.com` 被当成两个账号 —— 用户换个大小写就能重复注册；
 * 2. 注册时存原样大小写、登录时按输入查找，用户改一次大小写就登录不上。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 手机号规范化：去掉空格与短横线等常见分隔符，只留数字 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '')
}

/** 中国大陆手机号判定（与 lib/validators/auth.ts 的 phoneSchema 保持一致） */
const PHONE_PATTERN = /^1[3-9]\d{9}$/

export function isPhoneLike(value: string): boolean {
  return PHONE_PATTERN.test(value)
}

/**
 * 判定登录标识的类型。
 *
 * 顺序有意义：先手机号（纯 11 位数字），再邮箱（含 `@`），其余当用户名。
 * 用户名 schema 已**禁止纯数字**，因此不会与手机号判断冲突。
 */
export function resolveIdentifierKind(value: string): 'phone' | 'email' | 'username' {
  const trimmed = value.trim()
  if (isPhoneLike(trimmed)) return 'phone'
  if (trimmed.includes('@')) return 'email'
  return 'username'
}

/** 默认用户名前缀 */
const USERNAME_PREFIX = '用户'

function randomDigits(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10)
  return out
}

/** 手机号用户的默认用户名：`用户` + 尾号四位 */
export function defaultUsernameForPhone(phone: string): string {
  return `${USERNAME_PREFIX}${normalizePhone(phone).slice(-4)}`
}

/** 其余用户的默认用户名：`用户` + 随机四位 */
export function defaultUsername(): string {
  return `${USERNAME_PREFIX}${randomDigits(4)}`
}

/**
 * 分配一个未占用的用户名。
 *
 * `isTaken` 由调用方传入（闭包捕获事务句柄），这样本函数不必知道
 * 事务与连接池的具体类型，同时保证**唯一性判断发生在事务内**。
 * 冲突时退化为随机四位重试；极端情况用 8 位随机后缀兜底。
 */
export async function allocateUsername(
  isTaken: (candidate: string) => Promise<boolean>,
  preferred: string,
): Promise<string> {
  if (!(await isTaken(preferred))) return preferred
  for (let i = 0; i < 20; i += 1) {
    const candidate = defaultUsername()
    if (!(await isTaken(candidate))) return candidate
  }
  return `${USERNAME_PREFIX}${randomDigits(8)}`
}

/** inet 列不接受任意字符串；非法或缺失时存 NULL，不因此让注册失败 */
export function parseIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)
  const isIpv6 = ip.includes(':')
  if (!isIpv4 && !isIpv6) return null
  return ip
}
