/**
 * 免费模式开关 —— 全功能无条件免费。
 *
 * **背景**：产品决策为「V1 全功能免费」。为避免删除支付代码（订单、回调、兑换码、
 * 会员服务与对应测试）造成不可逆的大范围重构，改为**保留代码、关闭门禁**：
 * 权益判定的唯一入口 `computeEntitlements()` 与 `hasReportUnlock()` 在免费模式下
 * 直接返回「全部可用」，其余链路一行不改。
 *
 * **为什么是环境变量而不是常量**：
 * - 定价/收款是产品决策，不是代码决策；将来要恢复收费只需部署时改 `FREE_MODE=false`
 * - 免费/付费两条路径都能被单测覆盖（见 tests/unit/free-mode.test.ts）
 *
 * 约定（同 lib/config 其他文件）：
 * - 只有本文件允许读 `process.env.FREE_MODE`
 * - 严格匹配字符串 `"false"` 才视为关闭（与 `ADMIN_VIEW_RESUME_CONTENT` 一致），
 *   不接受 `0` / `FALSE` / 空字符串以外的模糊写法
 */

/** 免费模式是否开启（默认开启） */
export function isFreeMode(): boolean {
  return process.env.FREE_MODE !== 'false'
}
