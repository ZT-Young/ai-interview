/**
 * 短信验证码（**尚未接入短信服务商**）。
 *
 * 现状：验证码**固定为 8888**，任何手机号都能通过校验。
 * 这样设计的目的是让「手机号注册 / 登录」这条链路在**没有短信通道**时也能完整跑通
 * （本地开发、演示、E2E 都依赖它）。
 *
 * ⚠️ **上线前必须替换**：
 * 固定验证码等于「任何人都能登录任意手机号」，是**严重安全缺口**。
 * 接入真实服务商时需要：
 *   1. 本模块的 `verifySmsCode` 改为查库比对（code + 手机号 + 过期时间 + 尝试次数）；
 *   2. 删除 `SMS_DEV_CODE` 与 `devCodeHint()`；
 *   3. 同步移除前端「演示环境验证码固定为 8888」的提示文案。
 *
 * 已登记在 README「已知事项」。
 */

/** 演示环境固定验证码；可用 `SMS_DEV_CODE` 覆盖（例如 E2E 想换成别的固定值） */
export const SMS_DEV_CODE = process.env.SMS_DEV_CODE?.trim() || '8888'

/** 校验验证码（当前为固定值比对，接入真实短信后需改为查库） */
export function verifySmsCode(input: string): boolean {
  return input.trim() === SMS_DEV_CODE
}

/** 前端提示文案来源：让「这是演示环境」无法被误认为是正式功能 */
export function devCodeHint(): string {
  return `演示环境未接入短信服务，验证码固定为 ${SMS_DEV_CODE}`
}
