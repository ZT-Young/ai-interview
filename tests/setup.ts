/**
 * Vitest 全局 setup。
 *
 * 说明：
 * - 单元测试运行在 node 环境（服务层不依赖 DOM）。
 * - 集成测试需要 DATABASE_URL；缺失时由各测试文件自行 skip（见 tests/helpers/db.ts）。
 * - jest-dom 匹配器按需在组件测试中显式引入，避免污染 node 环境的类型。
 * - **测试默认关闭免费模式**（`FREE_MODE=false`）：这样原有的付费门禁断言（次数、
 *   报告解锁、额度消耗）仍然被真实执行，不会被免费模式的「全量放行」掩盖。
 *   免费模式自身的用例在 tests/unit/free-mode.test.ts 里单独开启验证。
 */
import { afterAll } from 'vitest'

process.env.FREE_MODE = 'false'

afterAll(async () => {
  // 关闭数据库连接，避免 Vitest 因连接句柄未释放而挂起
  const { closeDb } = await import('./helpers/db')
  await closeDb()
})
