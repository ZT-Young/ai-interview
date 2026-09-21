/**
 * Vitest 全局 setup。
 *
 * 说明：
 * - 单元测试运行在 node 环境（服务层不依赖 DOM）。
 * - 集成测试需要 DATABASE_URL；缺失时由各测试文件自行 skip（见 tests/helpers/db.ts）。
 * - jest-dom 匹配器按需在组件测试中显式引入，避免污染 node 环境的类型。
 */
import { afterAll } from 'vitest'

afterAll(async () => {
  // 关闭数据库连接，避免 Vitest 因连接句柄未释放而挂起
  const { closeDb } = await import('./helpers/db')
  await closeDb()
})
