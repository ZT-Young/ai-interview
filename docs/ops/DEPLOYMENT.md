# 部署文档（Vercel + Neon/Supabase + R2/S3）

> 目标：**新环境照本文档可以从零部署成功**。
> 上位依据：[AGENTS.md](../AGENTS.md) §4（技术栈）、§7（合规）、§8（密钥）。

---

## 0. 架构与前置条件

```
浏览器 (PC / H5)
      │  HTTPS
      ▼
Vercel（Next.js 14 App Router，Route Handlers 作为后端）
      ├──► PostgreSQL（Neon 或 Supabase）—— 业务数据
      ├──► S3 兼容对象存储（Cloudflare R2 / AWS S3 / MinIO）—— 简历原件
      ├──► LLM（OpenAI 兼容：DeepSeek / Qwen / GPT）—— 解析、出题、评分、报告
      └──► ASR（Whisper 或国内方案）—— 语音转文字（**选型仍为 TBD**）
```

**前置**：一个 Vercel 账号、一个 PostgreSQL 实例、一个 S3 兼容存储桶、一个 LLM API Key。
Node.js ≥ 20.9 与 pnpm 9 用于本地与 CI。

---

## 1. 创建数据库

### 方案 A：Neon（推荐）

1. 在 Neon 创建项目与数据库
2. 复制 **Pooled connection string**（含 `?sslmode=require`）
3. 该字符串即 `DATABASE_URL`

> Neon 连接池基于 PgBouncer，**不支持 prepared statement**。
> 本项目 `db/client.ts` 已设置 `prepare: false`，无需额外配置。

### 方案 B：Supabase

1. 创建项目 → Settings → Database → Connection string → **Connection pooling**
2. 使用 **Transaction** 模式的连接串作为 `DATABASE_URL`

---

## 2. 创建对象存储

### Cloudflare R2

1. 创建存储桶（如 `ai-interview-resumes`）
2. 生成 R2 API Token（Object Read & Write），得到 Access Key 与 Secret
3. 配置：

```
S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
S3_ACCESS_KEY="<R2 Access Key>"
S3_SECRET_KEY="<R2 Secret Key>"
S3_BUCKET="ai-interview-resumes"
S3_REGION="auto"
```

> R2 / MinIO 需要 **path-style** 寻址。项目已在 `lib/storage/s3.ts` 固定
> `forcePathStyle: true`，无需额外配置。
>
> **加密**：请在存储桶侧开启服务端加密（R2 默认加密；S3 可设 SSE-S3/SSE-KMS），
> 以满足 AGENTS.md §7 C3「数据加密存储」。

### AWS S3 / MinIO

把 `S3_ENDPOINT` 换为对应端点，`S3_REGION` 填真实区域（S3 用 `us-east-1` 等，MinIO 用 `us-east-1` 占位）。

---

## 3. 生成密钥

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # PAYMENT_WEBHOOK_SECRET
```

| 变量 | 必填时机 | 说明 |
|---|---|---|
| `DATABASE_URL` | **部署必填** | 见 §1 |
| `AUTH_SECRET` | **部署必填** | 会话令牌 HMAC 密钥，≥16 字符。**更换会使所有登录失效** |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 解析/出题/评分/报告必填 | 图片解析要求模型支持图片输入 |
| `S3_*` | 简历上传必填 | 见 §2 |
| `PAYMENT_WEBHOOK_SECRET` | 支付回调必填 | 未配置时下单接口返回 503，兑换码仍可用 |
| `ASR_API_KEY` / `ASR_BASE_URL` | 语音面试必填 | ASR 选型未定，当前语音转文字返回「暂不可用」 |
| `LOG_LEVEL` | 可选 | `debug`/`info`/`warn`/`error`，默认 `info` |
| `SENTRY_DSN` | 可选 | 配置后启用外部错误上报；未配置则降级为结构化日志 |
| `ADMIN_VIEW_RESUME_CONTENT` | 可选 | 严格 `"true"` 才让管理员看到简历原文，每次查看写审计日志 |

⚠️ **不要**把任何密钥放进 `NEXT_PUBLIC_*` —— 那会打进前端 bundle。
`node scripts/check-secrets.mjs` 会在 CI 中拦截这类问题。

---

## 4. 部署到 Vercel

1. 把仓库推到 GitHub
2. Vercel → New Project → 导入仓库（Framework 自动识别为 Next.js）
3. **Build Command / Output 保持默认**（`pnpm build`）
4. 在 Settings → Environment Variables 中按 §3 逐个添加（Production 与 Preview 都要）
5. Deploy

### 执行数据库迁移

迁移**不在应用启动时执行**（避免多实例并发迁移）。两种方式：

**方式 A：本地对生产库执行（推荐用于小团队）**

```bash
# .env.local 指向生产 DATABASE_URL
pnpm db:migrate
```

**方式 B：Vercel 构建钩子**（谨慎）

在 Build Command 追加 `&& pnpm db:migrate` —— 只有单实例构建时才安全；
Vercel 并发构建可能同时迁移。更稳的做法是用 GitHub Action 在部署前执行。

### 首次管理员提权

系统**不提供任何自我提权接口**，必须手动改库：

```sql
update users set is_admin = true where email = 'you@example.com';
```

之后登录，首页会出现「管理后台」入口。

---

## 5. 部署后验收清单

| # | 检查项 | 期望 |
|---|---|---|
| 1 | 访问首页 | 200，展示产品标题 |
| 2 | 访问 `/legal/privacy`、`/legal/terms`、`/legal/ai-disclosure` | 200，内容完整 |
| 3 | 注册新账号 | 成功，自动登录 |
| 4 | 未登录访问 `/sessions`、`/settings`、`/admin` | 307 跳登录；`/admin` 为 **404** |
| 5 | 上传简历 | 成功解析（或给出可读的失败提示） |
| 6 | 生成计划 → 面试 → 报告 | 全流程可用 |
| 7 | `/settings` 导出数据 | 下载 JSON，**不含 passwordHash** |
| 8 | `/settings` 删除账号 | 成功，随即无法登录 |
| 9 | `GET /api/health` | `{"status":"ok","database":{"ok":true}}` |

---

## 6. 已知限制（务必知情）

### 6.1 限流是进程内的，多实例下不精确

`lib/observability/rate-limit.ts` 使用**进程内内存固定窗口**。

- ✅ 单实例部署（如自建 Node 容器）：行为符合预期
- ⚠️ **Vercel 多实例**：每个实例各算一份配额，实际允许量约为 `限额 × 实例数`
- 影响：能显著削弱暴力破解与滥用，但**不是精确的全局配额**
- 缓解：接入 Redis/Upstash 后把 `RateLimitStore` 换成分布式实现，调用点无需改动

### 6.2 部分功能仍为占位

| 功能 | 现状 |
|---|---|
| 语音面试 | 录音与上传链路完整，**ASR 供应商未选型** → 服务端返回「暂不可用」，不伪造转写 |
| 真实支付 | 渠道未定 → 下单接口 503；**兑换码可用**；`lib/payments/provider.ts` 已隔离渠道差异 |
| 错误监控 | 未配置 `SENTRY_DSN` → 降级为结构化 JSON 日志 |
| 软删除数据硬清除 | 账号软删除后，非简历类记录由后续清理任务硬删（尚未实现定时任务） |

### 6.3 其他

- **`next/font/google` 需要外网**：Vercel 构建环境可正常访问；完全离线环境请改为 `next/font/local`
- **`pdfjs-dist` 必须保持外置**：见 `next.config.mjs` 的 `serverComponentsExternalPackages`，
  删除会导致简历上传接口整体 500
- **迁移只允许向前兼容**：先加列后删列，破坏性变更需两步发布

---

## 7. 回滚

| 场景 | 做法 |
|---|---|
| 应用代码故障 | Vercel → Deployments → 选择上一个正常版本 → Promote to Production |
| 数据库结构问题 | 迁移**不自动回滚**；写一条反向迁移并人工评审后执行 |
| 密钥泄漏 | 轮换 `AUTH_SECRET`（会使全部会话失效）与相关 API Key；在渠道侧吊销旧 Key |

---

## 8. 本地复现生产环境

```bash
pnpm install
cp .env.example .env.local     # 填 DATABASE_URL 与 AUTH_SECRET
pnpm db:migrate
pnpm dev                        # http://localhost:3000
```

**四道门禁 + 密钥检查**（与 CI 一致）：

```bash
pnpm verify
```

**E2E**：

```bash
pnpm exec playwright install chromium
pnpm e2e                        # 自动以 pnpm dev 拉起服务
```
