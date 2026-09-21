import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'

// Vitest 不会像 Next.js 那样自动加载 .env*，这里手动加载，
// 使集成测试能拿到 DATABASE_URL 与 AUTH_SECRET。
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // 只收 tests/ 下的测试；e2e/ 由 Playwright 负责
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e', 'runtimes'],
    // 集成测试共享同一个数据库，串行执行避免相互污染
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      exclude: ['**/*.config.*', '**/*.d.ts', '.next/**', 'tests/**', 'e2e/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
})
