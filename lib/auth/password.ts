import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/** promisify 对 scrypt 重载推断不准，这里显式包装 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

/**
 * 密码哈希 —— Node 内置 scrypt，无原生依赖（便于 Serverless 部署）。
 *
 * 存储格式：scrypt$N$r$p$saltBase64$hashBase64
 * 参数写入哈希串本身，便于未来提升强度后**逐步重算**，无需强制用户改密。
 */

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MAX_MEMORY = 64 * 1024 * 1024

/** 密码最短长度；前端仅作提示，服务端为准 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number) {
  return scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: n,
    r,
    p,
    maxmem: MAX_MEMORY,
  })
}

/** 生成密码哈希。绝不在日志或错误信息中输出明文密码。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$')
}

/**
 * 校验密码。
 *
 * 采用常数时间比较（timingSafeEqual），且哈希串格式非法时返回 false 而不抛错，
 * 避免把「格式异常」与「密码错误」区分开而泄露信息。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false

    const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts
    const n = Number(nRaw)
    const r = Number(rRaw)
    const p = Number(pRaw)
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

    const salt = Buffer.from(saltRaw, 'base64')
    const expected = Buffer.from(hashRaw, 'base64')
    const actual = await deriveKey(password, salt, n, r, p)

    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * 用户不存在时调用，用于抹平「账号存在与否」的响应时间差（防用户枚举）。
 * 丢弃返回值即可。
 */
export async function burnPasswordTime(password: string): Promise<void> {
  await deriveKey(password, Buffer.alloc(SALT_LENGTH, 0), SCRYPT_N, SCRYPT_R, SCRYPT_P)
}
