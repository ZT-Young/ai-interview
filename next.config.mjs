/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * 开发模式使用独立的产物目录 `.next-dev`。
   *
   * 原因：`pnpm dev` 与 `pnpm build` 默认共用 `.next`。若在 dev server 运行时
   * 执行 `pnpm build`（CI 的 `pnpm verify` 就会），生产构建会覆盖 dev 的
   * chunk 清单，dev server 随后对已编译路由抛出
   * `Error: Cannot find module './6328.js'` 并返回 500 —— 看起来像业务 Bug，
   * 实际只是产物目录被互相破坏。分开目录后两者可安全并行。
   *
   * 注意：`.gitignore` 需同时忽略 `.next` 与 `.next-dev`。
   */
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  eslint: {
    // Lint 通过独立的 `pnpm lint` 执行，避免 build 重复跑
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Server Actions 体积限制，用于后续简历/JD 提交
    serverActions: {
      bodySizeLimit: '4mb',
    },
    /**
     * 这些包必须作为 Node 依赖在运行时 require，**不能**被 webpack 打包进
     * server bundle：
     *
     * - pdfjs-dist（pdf-parse 的依赖）：被打包后加载即抛
     *   `TypeError: Object.defineProperty called on non-object`，
     *   导致 /api/resumes/upload 等路由整体 500。
     * - mammoth / @aws-sdk：CJS 依赖与动态 require，同理需要外置。
     *
     * 详细复现与说明见 README「已知事项」。
     */
    serverComponentsExternalPackages: [
      'pdf-parse',
      'pdfjs-dist',
      'mammoth',
      '@aws-sdk/client-s3',
      'postgres',
    ],
  },
}

export default nextConfig
