import { createHash } from 'node:crypto'

/**
 * 兑换码工具。
 *
 * **明文不入库**：库中只保存 SHA-256 哈希，因此即使数据库被读取，
 * 也无法直接得到可用的兑换码明文。
 *
 * 说明：兑换码是**高熵随机串**（由运营批量生成），
 * 因此不需要像密码那样加盐 + 慢哈希；SHA-256 足够，
 * 且能保证「同一个码哈希稳定」以便唯一索引查找。
 */

/** 去除空格与连字符、转大写，容忍用户从各处复制来的格式差异 */
export function normalizeRedemptionCode(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '').toUpperCase()
}

export function hashRedemptionCode(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode, 'utf8').digest('hex')
}

/** 生成一个可读性较好的兑换码（仅供运营/测试批量生成使用） */
export function generateRedemptionCode(groups = 4, groupLength = 4): string {
  // 去掉易混淆字符（0/O、1/I/L）
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const parts: string[] = []
  for (let group = 0; group < groups; group += 1) {
    let part = ''
    for (let index = 0; index < groupLength; index += 1) {
      part += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    parts.push(part)
  }
  return parts.join('-')
}
