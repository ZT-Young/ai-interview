# AI 模拟面试（AI Mock Interview）

面向 C 端求职者的 AI 模拟面试 Web 应用：粘贴目标岗位 JD、上传简历，AI 扮演面试官进行模拟面试，
最后生成评分报告与提升建议。

> 开发规范与 V1 范围见 [AGENTS.md](./AGENTS.md)。
> 数据模型见 [docs/DATA_MODEL.md](./docs/DATA_MODEL.md)，技术架构见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 当前进度

| Phase | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | 项目初始化（Next.js 14 + Tailwind + shadcn/ui + 工具链） | ✅ 完成 |
| Phase 1 | 数据库 schema + 用户鉴权 + 基础 CRUD | ✅ 完成（集成测试待连接数据库后执行） |
| Phase 2 | 简历/JD 上传解析、S3 存储、解析确认页 | ✅ 完成（真实 S3/LLM 端到端待凭证） |
| Phase 3 | 匹配分析、面试计划生成（出题）、计划 UI | ✅ 完成（真实 LLM 端到端待凭证） |
| Phase 4 | 面试编排状态机（作答/追问/跳过/结束） | ✅ 完成（真实 LLM 端到端待凭证） |
| Phase 4b | 面试房间 UI（气泡/计时/进度/语音/断线重连） | ✅ 完成（语音转文字待 ASR 选型） |
| Phase 5 | 逐题评分与报告生成、报告页 | ✅ 完成（真实 LLM 端到端待凭证） |
| Phase 6 | 报告页增强、历史记录页、会员页 | ✅ 完成（支付渠道待定，仅做展示） |
| Phase 7 | 支付与会员最小闭环（兑换码 + 回调幂等） | ✅ 完成（真实渠道待接入） |
| Phase 8 | 管理后台最小版 + AI 调用日志 | ✅ 完成 |
| Phase 9 | 测试补全、合规页面、数据导出/删除、可观测性、部署文档、CI | ✅ 完成 |
| Phase 10 | 接入真实支付渠道与 ASR 供应商 | ⬜ 待选型 |

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| 后端 | Next.js Route Handlers，业务规则在 `lib/services`，AI 逻辑在 `lib/ai` |
| 数据库 | PostgreSQL + Drizzle ORM |
| 鉴权 | **自建**：邮箱 + 密码（scrypt）+ 数据库会话 + HttpOnly Cookie |
| LLM | OpenAI 兼容接口（DeepSeek / Qwen / GPT） |
| ASR | Whisper API 或国内 ASR（选型 TBD） |
| 文件存储 | S3 兼容对象存储（选型 TBD） |
| 测试 | Vitest（单元 + 集成）+ Playwright（E2E） |
| 包管理 | pnpm 9 |

---

## 环境要求

- Node.js **>= 20.9**（开发环境实测 v24）
- pnpm **9.x**
- PostgreSQL 14+（本地或云托管 Neon / Supabase）

```bash
node -v && pnpm -v
# 未安装 pnpm：npm i -g pnpm@9
```

---

## 本地启动步骤

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
```

Phase 1 起必需：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串，线上务必带 `sslmode=require` |
| `AUTH_SECRET` | 会话令牌 HMAC 密钥，≥16 字符。生成：`openssl rand -base64 32` |

Phase 2（简历/JD 解析）起必需：

| 变量 | 说明 |
| --- | --- |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` / `S3_REGION` | S3 兼容对象存储（R2 / S3 / MinIO） |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | OpenAI 兼容接口；**图片解析要求模型支持图片输入** |

其余变量（ASR）在 Phase 3 才需要，清单见 `.env.example` 与 [docs/ARCHITECTURE.md §5](./docs/ARCHITECTURE.md)。

> `AUTH_SECRET` 一旦更换，所有已登录会话立即失效。

> **没配 `DATABASE_URL` 会怎样？** 应用仍能启动，但所有依赖数据库的接口
> （注册、登录、简历/JD 列表…）会返回
> `503 service_unavailable` + 「请在 .env.local 中设置 DATABASE_URL」。
> `/api/health` 会返回 `{"status":"degraded"}`。这是**刻意设计的行为**：
> 让「数据库没配好」一眼可见，而不是伪装成 `500 服务器内部错误`。
> 详见「已知事项」第 13 条。

### 3. 执行数据库迁移

```bash
pnpm db:migrate     # 应用 db/migrations 下的迁移
pnpm db:studio      # 可选：可视化查看数据
```

迁移文件由 `pnpm db:generate` 从 `db/schema/*` 生成，**不要手工编辑**。

#### 没有 PostgreSQL？一条命令起本地库

机器上没有 PostgreSQL / Docker 时，可用仓库自带的嵌入式实例（**仅本地开发**）：

```bash
pnpm dev:all        # 启动本地 PostgreSQL(:55432) → 自动迁移 → 启动 dev server
```

它会按顺序做三件事并打印清晰日志：起库 → 跑 `pnpm db:migrate` → 起 dev server；
Ctrl+C 结束时会一并停掉由它启动的 PostgreSQL。数据目录 `.local-pg/`（已忽略，不会入库）。

也可单独使用：

```bash
pnpm local:db        # 只起本地 PostgreSQL（常驻）
pnpm local:db:smoke  # 起库 → 建库 → 自检 → 关闭（验证链路是否通）
```

对应 `.env.local`（本地开发占位值，完整清单见 `.env.example`）：

```bash
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/ai_interview"
```

> ⚠️ 端口用 **55432** 而非 5432，避免与机器上可能已存在的 PostgreSQL 冲突。
> ⚠️ 该实例是单进程、无副本、无备份，**不可用于生产或内测环境**；线上请用 Neon / Supabase 等托管库。

### 4. 启动开发服务器

```bash
pnpm dev            # 已有数据库时
# 或
pnpm dev:all        # 数据库 + 迁移 + dev server 一条命令
```

打开 <http://localhost:3000> → 注册 → 自动登录进入工作台。

> 开发模式产物目录是 `.next-dev`（生产构建用 `.next`），两者互不干扰，
> 因此可以在 dev server 运行时执行 `pnpm build` / `pnpm verify`，不会打断 dev。

### 5. 验收：注册与登录

1. 访问 `/register`，填写邮箱与密码（≥8 位），勾选同意条款 → 应跳转首页并显示「欢迎回来」
2. 点击「退出登录」→ 跳到 `/login`
3. 用同一账号登录 → 应重新进入工作台
4. 访问 `/api/auth/me` → 返回当前用户 JSON；退出后访问应返回 `401`

### 6. 验收：简历与 JD 解析（Phase 2）

前置：`S3_*` 与 `LLM_*` 已配置（或本地开发设 `STORAGE_DRIVER=local` 免 S3）。

1. 访问 `/resumes/new` → 选择 PDF / DOCX / 图片 → 上传
2. 应跳转到 `/resumes/<id>/review`，展示结构化结果（姓名、年限、技能、项目、教育、疑点）
3. 修改任意字段 → 点「保存修改」→ 刷新后修改应保留
4. 访问 `/jd/new` → 粘贴 JD 原文 → 解析 → 在 `/jd/<id>/review` 校正后保存
5. 失败路径：上传一个损坏的 PDF（如把 .txt 改名成 .pdf）→ 应显示中文错误提示，**且仍可手动填写并保存**

> **关于「解析失败」的行为**：解析失败只表示**自动结构化**没成功，资料本身（文件/原文）
> 一定已保存，`parse_status='failed'` + `parse_error` 会带上可读原因，
> 用户在 review 页手动填写后即可继续。**不会因为解析失败就丢弃用户上传的内容**。
>
> **关于没有 LLM 时**：会在 review 页提示「解析服务暂时不可用…或手动填写」。
> 本地文字抽取（PDF/DOCX 的文字层）不需要 LLM，因此原文一定拿得到；
> 只有「技能/项目/学历」这类结构化字段必须调用模型。

### 7. 验收：面试计划生成（Phase 3）

前置：`LLM_*` 已配置。

**新建面试页支持三种资料来源，可混用**（`/sessions/new`）：

| | 选择已有 | 上传文件 | 粘贴文本 |
| --- | --- | --- | --- |
| 简历 | 已解析的简历下拉 | PDF / Word / 图片 | 粘贴简历内容 |
| 岗位 JD | 已解析的 JD 下拉 | 图片（走视觉模型） | 粘贴 JD 原文 |

1. 访问 `/sessions/new`，在简历与 JD 区各选一种来源
2. 上传/粘贴后**立即解析并落库**，成功后该区显示「已就绪」
3. 两项就绪后点「创建并进入面试计划」→ 跳到 `/sessions/<id>`
4. 在 `/sessions/<id>` 点「生成匹配分析」→ 应显示匹配度、优势、待补充项
5. 点「生成面试计划」→ 应展示 **8–12 道题**，按自我介绍/项目深挖/专业题/行为题/反问分组
6. 逐题确认展示了：问题文本、来源（JD/简历/两者/通用）、考察维度、期望要点、是否可追问
7. 再次点「生成面试计划」→ **应被拒绝**（提示需显式重新生成），已有计划不被清除
8. 点「重新生成计划」→ 旧计划被替换（题量可能与之前不同）

> 上传/粘贴**不需要先离开本页**：早期版本只能下拉选择，用户必须先跑去
> `/resumes/new`、`/jd/new` 各走一遍流程再回来，门槛过高。
> 解析失败也不阻断创建，资料已保存，可稍后在对应 review 页补充要点。

### 8. 验收：面试房间（Phase 4b）

前置：已完成第 7 步（面试计划已生成），且配置了 `LLM_*`。

1. 在 `/sessions/<id>` 点「开始面试」→ 进入 `/sessions/<id>/interview`
2. 页面应展示：AI 面试官头像与气泡、当前问题、计时（mm:ss）、进度 `n/总`
3. 输入回答 → 「提交回答」→ 出现「你」的气泡；随后出现**追问**（最多 2 层）或下一道主问题
4. 点「请求提示」→ 出现提示气泡，**进度不变、题目不变**
5. 点「跳过此题」→ 二次确认后推进；**被跳过的题不会再次出现**
6. 按住「按住说话」→ 松开 → 因 ASR 未选型，应提示「语音识别暂不可用，请手动输入」（**不会伪造文字**）
7. 点「结束面试」→ 二次确认 → 展示「面试已结束」与完成度
8. 移动端：在 375px 宽度下不应出现横向滚动，底部操作栏贴底且不被安全区遮挡
9. 断线：断网后应出现顶部横幅且提交被禁用；恢复网络后横幅提示已恢复并自动同步

### 9. 验收：评分与报告（Phase 5）

前置：面试至少有一道题已回答。

1. 结束面试后进入 `/sessions/<id>/report`（或从面试房间点「查看评分与报告」）
2. 点「逐题评分」→ 应提示已完成 n/n 道题的评分
3. 展开「逐题反馈」→ 每题应展示：折算分、你的回答、反馈、**评分依据（引用你的回答原文）**
4. 点「生成报告」→ 应展示总分（0–100）与六维得分（各 0–5），以及优势
5. 未解锁时，「待改进 / 参考回答 / 下一步建议 / 简历疑点 / 逐题反馈」应显示解锁遮罩，
   且**用浏览器开发者工具查看 `/api/sessions/<id>/report` 响应时，付费字段内容为空**（不是前端隐藏）
6. 低分题的反馈中应包含可执行的改进建议，而不是「回答不好」这类空话

### 10. E2E 测试

```bash
pnpm exec playwright install chromium   # 首次需下载浏览器
pnpm e2e:seed --write                    # 造 E2E 数据并写入 .env.local（只需一次）
pnpm e2e                                 # 自动以 pnpm dev 拉起服务
pnpm e2e --project=mobile-h5             # 仅跑移动端项目
```

**E2E 需要三个前置条件**（缺任一则相关用例显式 skip，不伪装通过）：

| 变量 | 作用 |
| --- | --- |
| `DATABASE_URL` / `AUTH_SECRET` | 会话、题目、报告都要真实数据库 |
| `E2E_INTERVIEW_SEED` | `邮箱:密码:会话ID`，指向「**计划已生成、尚未开始**」的会话 |
| `E2E_REPORT_SEED` | `邮箱:密码:会话ID`，指向「**已完成并已生成报告**」的会话 |
| `E2E_RESET_TOKEN` | 与 dev server 同值；用例前用 `/api/test/reset-session` 把会话复位 |

两个 seed **必须是不同会话**：同一个会话不可能既「尚未开始」又「已完成」。
`pnpm e2e:seed --write` 会一次性造好并写回 `.env.local`。

按**是否需要登录**与**共享资源**分 project 运行（见 `playwright.config.ts`）：

| project | 覆盖 | 登录态 |
| --- | --- | --- |
| `chromium-serial` | 面试房间 / 报告 / 历史 / 会员 / 合规页 | 已登录 |
| `mobile-h5` | 同上（iPhone 13 视口） | 已登录 |
| `chromium-public` | 冒烟、未登录访问控制、注册页知情同意 | **未登录** |
| `chromium-authz` | 登录限流、回调签名 | **未登录** |

> ⚠️ 全局 `workers: 1`：多个 project 共用**同一个 seed 会话**与**同一个按 IP 的登录限流**，
> 并行必然互相打断（实测表现为 `/answers` 撞唯一约束 500、`/finish` 撞状态机 422）。
> 登录态由 `e2e/global-setup.ts` 统一准备（storageState），**用例内不要各自登录**。

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | 开发 / 构建 / 生产运行 |
| `pnpm dev:all` | **本地全栈一条命令**：起本地 PostgreSQL → 迁移 → dev server |
| `pnpm local:db` / `local:db:smoke` | 只起本地 PostgreSQL / 起库自检后关闭 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm check:secrets` | **密钥泄漏检查**（硬编码密钥 / 被跟踪的 .env / NEXT_PUBLIC 敏感值） |
| `pnpm audit:public` | **公开信息审计**（真实邮箱 / 内网地址 / 本机绝对路径 / 被赋值的密钥变量） |
| `pnpm verify` | **一键跑完 CI 全部门禁**（secrets → audit:public → lint → typecheck → test → build） |
| `pnpm test` | Vitest（单元 + 集成） |
| `pnpm test:watch` | Vitest 监听模式 |
| `pnpm e2e` | Playwright E2E（自动用 `pnpm dev` 拉起服务） |
| `pnpm e2e:seed` | 造 E2E 数据；`--write` 直接写回 `.env.local` |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle |

提交前自检（AGENTS.md §10）：

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

---

## API 一览（Phase 1）

所有受保护接口都要求有效会话 Cookie，且**只能访问自己的数据**；
访问他人资源统一返回 **404**（而非 403，避免泄露资源是否存在）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册（自动登录，需 `acceptTerms: true`） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出（会话立即失效，幂等） |
| GET | `/api/auth/me` | 当前用户 |
| GET/POST | `/api/resumes` | 简历列表 / 创建 |
| POST | `/api/resumes/upload` | 上传简历文件（multipart）并立即解析 |
| GET/PATCH/DELETE | `/api/resumes/:id` | 简历读取 / 更新（可改解析结果）/ 软删除 |
| POST | `/api/resumes/:id/parse` | 对已上传简历重新解析 |
| GET/POST | `/api/job-jds` | 岗位 JD 列表 / 创建 |
| POST | `/api/job-jds/parse` | 粘贴 JD 文本并解析 |
| POST | `/api/job-jds/upload` | 上传 JD 图片并解析 |
| GET/PATCH/DELETE | `/api/job-jds/:id` | JD 读取 / 更新 / 软删除 |
| GET/POST | `/api/sessions` | 面试会话列表 / 创建 |
| GET/PATCH/DELETE | `/api/sessions/:id` | 会话读取 / 更新；`DELETE` 带 `?status=` 时执行状态迁移 |
| POST | `/api/sessions/:id/match` | 生成简历与 JD 的匹配分析（出题的前置步骤） |
| GET | `/api/sessions/:id/plan` | 获取面试计划（按 `order_index` 返回） |
| POST | `/api/sessions/:id/plan` | 生成面试计划；`{"regenerate": true}` 覆盖已有计划 |
| POST | `/api/sessions/:id/start` | 开始面试（phase → READY，抛出第一题） |
| GET | `/api/sessions/:id/next` | 获取下一题（刷新后恢复进度） |
| POST | `/api/sessions/:id/answers` | 提交回答 / 跳过 / 请求提示 |
| POST | `/api/sessions/:id/answers/audio` | 语音转文字（**不落库**，转写文本交由用户确认后提交） |
| POST | `/api/sessions/:id/finish` | 结束面试（phase → FINISHED，status → completed） |
| POST | `/api/sessions/:id/evaluate` | 逐题评分（指定 `questionId` 或批量评「已作答未评分」的题） |
| GET | `/api/sessions/:id/report` | 读取报告（**未解锁时付费字段不会出现在响应中**） |
| POST | `/api/sessions/:id/report` | 生成报告（phase → REPORTING；**生成时消耗免费额度**） |
| POST | `/api/payments/redeem` | 兑换码兑换（**请求体只传兑换码**） |
| GET | `/api/payments/orders` | 我的订单 + 权益摘要 |
| POST | `/api/payments/orders` | 创建订单（**只传 productId**；渠道未配置时 503） |
| POST | `/api/payments/callback` | 渠道回调（**验签 + 幂等**，无需登录） |
| GET | `/api/admin/overview` · `/users` · `/users/:id` · `/sessions` · `/orders` · `/logs` · `/audit-logs` | 管理后台（**非管理员一律 404**） |
| POST | `/api/admin/users/:id/credits` | 手动调整免费次数（**写审计日志**） |
| GET | `/api/health` | 健康检查（含数据库连通性） |

错误响应统一为：

```json
{ "error": { "code": "not_found", "message": "简历不存在" } }
```

`code` 取值：`unauthorized`(401) / `forbidden`(403) / `not_found`(404) / `validation_error`(422) / `conflict`(409) / `rate_limited`(429) / `internal_error`(500)

---

## 目录结构

```
├── app/
│   ├── (auth)/                 # login / register（未登录可访问）
│   ├── api/                    # Route Handlers
│   │   ├── auth/{register,login,logout,me}/
│   │   ├── resumes/ · job-jds/ · sessions/
│   │   └── health/
│   ├── layout.tsx · page.tsx · globals.css
├── components/
│   ├── ui/                     # shadcn/ui 原子组件
│   └── features/auth/          # 登录/注册/退出表单
├── lib/
│   ├── ai/                     # LLM 客户端、prompt 模板、JSON Schema
│   │   ├── client.ts           # OpenAI 兼容接口（含视觉图片直读）
│   │   ├── prompts/parse.ts    # JD / 简历 / 匹配三类 prompt
│   │   └── schemas/parse.ts    # 对应 zod schema（strict）
│   ├── parsing/                # 文档抽取与后置校验
│   │   ├── extract.ts          # PDF(pdf-parse) / DOCX(mammoth) / 图片
│   │   ├── run.ts              # schema 校验 + 降温重试
│   │   ├── verify.ts           # 防编造、敏感信息与禁止项过滤
│   │   ├── llm-port.ts         # 可注入的 LLM 端口（测试用 fake）
│   │   └── errors.ts           # 面向用户的中文错误文案
│   ├── storage/s3.ts           # S3 兼容存储端口与实现
│   ├── api/                    # errors · respond · guard · ownership
│   ├── auth/                   # password(scrypt) · session · verify-session
│   ├── services/               # auth / resume / job-jd / session / parse / upload
│   ├── validators/             # zod 入参契约
│   ├── api-client.ts · env.ts · utils.ts
├── db/
│   ├── schema/                 # 12 张表（enums 为单一真源）
│   ├── migrations/             # 0000 初始 + 0001 extraction_meta
│   └── client.ts               # 惰性连接（导入不建连，缺 DATABASE_URL 也能 build）
├── tests/
│   ├── unit/                   # 纯逻辑，无需数据库（含 fake LLM/S3）
│   ├── integration/            # 需 DATABASE_URL，缺失时显式跳过
│   ├── fixtures/documents.ts   # 真实 PDF / DOCX / PNG 字节构造器
│   └── helpers/                # fakes.ts · db.ts
├── e2e/ · docs/
└── drizzle.config.ts · vitest.config.ts · playwright.config.ts · .env.example
```

---

## 解析流程（Phase 2）

```
上传文件 ──► 校验类型/大小 ──► 存 S3 ──► 建记录(pending)
                                          │
              ┌───────────────────────────┘
              ▼
   PDF → pdf-parse 抽文字层      DOCX → mammoth 抽文
   图片 → 不本地 OCR，交给视觉 LLM 直读
              │
              ▼
   LLM 结构化输出（json_object + 严格 schema）
              │ 校验失败 → 降温 0.2 重试 1 次
              ▼
   后置校验：剔除编造内容 / 敏感信息 / 录用建议
              │
              ▼
   success → parsed_data + extraction_meta
   failed  → parse_error（中文提示）+ 保留原文，用户可手动填写
```

**关键设计**

| 决策 | 说明 |
|---|---|
| 图片不做本地 OCR | 走视觉 LLM 直读（模型需支持图片输入，如 `qwen-vl-max` / `gpt-4o`）。传统 OCR 对中文简历质量差、需下载语言模型、Serverless 不友好 |
| 失败不是 HTTP 错误 | 解析失败返回 200 + `parse_status='failed'` + 中文 `parse_error`，前端据此提示「可手动修改」 |
| 环境级失败返回 503 | S3 或 LLM 未配置时返回 503 并**删除已建记录**，不留脏数据 |
| 防编造 | 简历 `skills`/`projects[].name` 必须能在原文中找到，否则剔除；`role` 缺失时留 `""` 而非推断 |
| Schema 严格 | 所有对象 `additionalProperties: false` + 必填全列，多余或缺失字段一律判失败 |
| 可测性 | LLM 与 S3 通过端口注入，测试用 fake 覆盖正常/失败/校验失败三类场景，不调用真实服务 |

解析契约（prompt 与 JSON Schema）见 [docs/AI_PROMPTS.md](./docs/AI_PROMPTS.md)。

---

## 面试计划生成（Phase 3）

```
简历(已解析) + JD(已解析)
        │
        ▼
   POST /api/sessions/:id/match        匹配分析 → interview_sessions.match_analysis
        │                               （静态匹配度，0-100，非能力评价）
        ▼
   POST /api/sessions/:id/plan         出题
        │
        ├─ LLM 返回 → zod schema 校验（信封 + 8-12 题 + 每题 6 字段）
        ├─ 配额与合规后置校验（analyzePlan）
        │    · 五种题型齐全；self_intro / reverse 恰好 1 道
        │    · project_dig ≤ 4、technical ≤ 4、behavioral ≤ 3
        │    · source=generic 仅允许自我介绍与反问（防编造）
        │    · 敏感词与录用建议扫描
        ├─ 不达标 → 降温 0.2 重试 1 次 → 仍不达标则 502，不写库
        ▼
   事务写入 questions（12 行）+ 会话 draft → planned
```

**每道题落库的字段**

| 字段 | 列 | 说明 |
|---|---|---|
| 问题文本 | `content` | 单个问题（一次只问一个） |
| 类型 | `type` | `self_intro` / `project_dig` / `technical` / `behavioral` / `reverse` |
| 来源 | `source` | `jd` / `resume` / `both` / `generic` |
| 考察维度 | `dimension` | 复用六维枚举，与 Phase 4 评分对齐 |
| 期望要点 | `expected_points` | jsonb 数组，2–5 条 |
| 是否可追问 | `follow_up_allowed` | false 时追问链深度上限为 0 |

**设计要点**

| 决策 | 说明 |
|---|---|
| 配额不达标即**整体判失败** | 若改为「删掉多余题目」会破坏题型配额，重试才是正确降级 |
| 已有计划默认拒绝重生成 | 需显式传 `regenerate: true`，避免清除用户已答题记录 |
| `source=generic` 白名单 | 仅自我介绍与反问可标通用；专业题标通用即判失败（防编造） |
| 六维枚举复用 | `dimension` 直接用 `score_dimension`，Phase 4 评分无需二次映射 |
| 生成前置条件校验 | 简历/JD 必须已解析、匹配分析必须已产出，否则 422 |

---

## 面试编排状态机（Phase 4）

面试过程由**服务端状态机**驱动，前端只负责展示与提交。契约见 [docs/ARCHITECTURE.md §3.6](./docs/ARCHITECTURE.md)。

### 两个状态维度（不可混淆）

| 维度 | 列 | 取值 | 语义 |
|---|---|---|---|
| 生命周期 | `interview_sessions.status` | `draft` / `planned` / `in_progress` / `completed` / `cancelled` / `failed` | 会话整体阶段（取消与异常终止在此表达） |
| 编排阶段 | `interview_sessions.phase` | 9 值（见下） | 面试进行中的细粒度位置 |

```
IDLE → PARSING → READY → ASKING → WAITING_ANSWER
                            ▲            │
                            │            ├─→ FOLLOW_UP ─┐
                            └─ NEXT_QUESTION ◄──────────┘
                                          │
                                    FINISHED → REPORTING
```

### 服务端强制的规则（不信模型自觉）

| 规则 | 实现 |
|---|---|
| 一次只问一个问题 | 任何响应最多返回 **1** 条 `question` / `follow_up` 消息 |
| **每主问题最多 2 层追问** | 服务端按 `root_id` 统计 `depth`；`depth >= 2` 时**忽略模型结果**强制推进 |
| 回答太短 → 追问细节 | 去空白后 **< 30 字符**直接判 `too_short`，**不调用模型**（确定性、可单测） |
| 跑题 → 拉回岗位要求 | 模型判 `off_topic`，prompt 中注入 JD `must_have` |
| 追问基于模糊点 | 模型必须输出 `focus`（逐字摘录所依据的回答片段） |
| `follow_up_allowed=false` | 自我介绍与反问不追问（上限视为 0） |

### 消息持久化

| 表 | 存什么 |
|---|---|
| `interview_messages` | **全部对话消息**：AI 提问/追问/提示/系统提示 + 用户回答/跳过，含 `follow_up_reason` 与 `focus` |
| `answers` | 用户回答的**权威表**（`question_id` 唯一），供评分与报告使用 |

**跳过语义**：`action: "skip"` 不写 `answers`，但写入 `interview_messages` 的 `skip` 记录；
下一题判定同时排除「已回答」与「已跳过」，**被跳过的题不会被重问**。

### 容错行为

| 场景 | 行为 |
|---|---|
| 模型不可用 + 回答过短 | 本地兜底生成 `too_short` 追问（不阻塞用户） |
| 模型不可用 + 回答正常 | 跳过追问，直接推进到下一题 |
| 模型输出追问命中敏感词/禁止项 | 归一化时降级为 `next_question` |
| 提示生成失败 | 用固定文案兜底（提示是辅助功能，不报错） |

---

## 面试房间 UI（Phase 4b）

页面 `/sessions/[id]/interview`，完整规格见 [docs/UI.md §4](./docs/UI.md)。

| 元素 | 实现 |
|---|---|
| AI 面试官头像 / 文字气泡 | 纯 CSS 头像 + 三种气泡（AI 左、用户右、系统居中）；**角色以文本前缀表达**（面试官/你/系统），不只靠对齐 |
| 当前问题 | 当前题在气泡内放大字号展示，附来源与考察维度标签 |
| 计时 | 本题计时 `mm:ss`，提交时作为 `durationMs` 写入 `answers.duration_ms`；**不强制限时** |
| 进度 | `进度 n/总`，追问不计入主问题进度 |
| 文字输入 | 多行自适应、`Ctrl/Cmd + Enter` 提交、失败时**不清空内容** |
| 语音输入 | 按住说话（Pointer Events）：录音 → 松开上传 → 转写文本**填入输入框**（不自动提交） |
| 跳过 / 提示 / 结束 | 跳过与结束均有二次确认；提示停留当前题 |
| 断线重连 | 顶部横幅；离线时禁用提交；恢复后自动 `GET /api/sessions/:id/next` 同步进度 |

### 语音输入与 ASR 的边界

**当前状态**：录音与上传链路**完整可用**，但 ASR 供应商未定（AGENTS.md §9.2），因此服务端返回
`503 语音识别暂不可用，请手动输入`，前端以提示条展示并引导手动输入——**绝不伪造转写文字**。

选型确定后只需在 `lib/asr/index.ts` 的 `createAsrPort()` 中返回具体实现，**路由与前端无需改动**。

**安全**：音频只上传到本站服务端，ASR 调用在服务端完成，**前端不持有任何 API Key**。
音频在转写后**立即从对象存储删除**；转写结果不落库（用户确认后作为文字答案提交），符合数据最小化。

---

## 评分与报告（Phase 5）

契约见 [docs/AI_PROMPTS.md §6/§7](./docs/AI_PROMPTS.md)，分数公式的唯一真源是 [docs/DATA_MODEL.md §5](./docs/DATA_MODEL.md)。

### 数据分工

| 表 | 存什么 |
|---|---|
| `evaluations` | **逐题评分**（一题一行）：六维分、折算分、反馈、**证据引用**、模型与 prompt 版本 |
| `reports` | **报告聚合**（一场面试一份）：总分、六维汇总、优势、问题、参考回答、下一步建议、简历疑点 |

需求里的「逐题数组」按此拆开：逐题数据在 `evaluations`，报告在 `reports`。
**维度证据挂在逐题评分上**——维度分是聚合值，无法对应到单条回答。

### 分数由服务端计算，模型不算分

```
question_score     = (Σ 六维 / 30) × 100
dimension_score(d) = mean(该会话所有题的 d 维)
total_score        = (Σ 六维汇总 / 30) × 100      # 六维等权
```

实现于 `lib/ai/scoring.ts`（可单测）。模型只负责文字：总评、优势、问题、参考回答、
下一步建议、简历疑点归纳。**报告任一分数都能回溯到具体回答**。

### 三条硬约束（都有测试）

| 约束 | 实现 |
|---|---|
| **每条评分必须引用回答原文证据** | `evidence_quotes` 至少 1 条；DB 层有 `jsonb_array_length > 0` 的 CHECK |
| **证据必须是回答原文的子串** | `verifyEvidenceQuotes()` 归一化后比对；不匹配的引用被剔除，**全部被剔除则判失败并重试**（防编造引用） |
| **参考回答不编造经历** | prompt 明确要求「改进要点」；后置校验剔除「不在本次面试题目中」的参考回答与「不在简历解析结果中」的疑点 |

低分（任一维 < 3）时若反馈过短，服务端自动补一条可执行建议（`GENERIC_IMPROVEMENT_HINT`）。

### 免费 / 付费边界

| 免费可见 | 付费解锁 |
|---|---|
| 总分、六维分、优势、总评 | 问题、参考回答、下一步建议、简历疑点、逐题反馈与证据 |

**未解锁时服务端不返回付费字段的内容**，只返回 `lockedSections`（被锁字段名），
UI 据此渲染遮罩 —— 否则把付费内容一并发给前端，解锁形同虚设。

### 报告页增强（Phase 6）

规格见 [docs/UI.md §5](./docs/UI.md)。

| 分区 | 内容 |
|---|---|
| 总分 / 岗位匹配度 | 两者**语义不同、不可合并**：总分来自实际回答，匹配度来自简历与 JD 的静态比对（标注「不代表录用判断」） |
| 六维雷达图 | **自绘 SVG**（`dimension-radar.tsx`）：无图表库依赖、可服务端渲染；同时渲染六维数值列表，**颜色不是唯一信息载体** |
| 逐题反馈 | 默认折叠（`<details>`），不展开则不渲染内容 —— 长页性能优化 |
| 训练建议 | 模型 `next_steps` + **服务端按低分维度（< 3）自动生成的基础建议**，后者**免费可见** |

**基础建议免费可见**是有意设计：避免未解锁时报告页出现「什么都没有」的体验。

### 历史记录页 `/sessions`

- 展示会话状态、题量、难度、创建时间
- 已完成 → 「查看报告」直达报告页
- **再次训练** → 复用同一简历与 JD 新建会话（`POST /api/sessions`）并跳到计划页
- 空状态引导准备简历与 JD

### 会员页 `/membership` 与订单页 `/orders`

> **范围限制**：支付渠道与免费次数规则仍是 TBD（AGENTS.md §9.2），
> 因此这两页**只做展示与入口**，不含下单、渠道跳转与回调。

- 会员页：免费次数（`users.free_credits`）、等级、**权益对照表**（与报告页免费/付费边界一致）、订单入口
- **升级按钮禁用**并标注「支付渠道开发中」—— 不给出无法完成的购买路径
- 订单页：列出 `payments`（金额/状态/解锁类型/时间），渠道订单号**脱敏**展示；无订单时说明原因

---

## 支付与会员最小闭环（Phase 7）

> **V1 用兑换码 + mock 回调跑通闭环**，真实渠道（Stripe / 微信 / 支付宝）后续接入。
> 渠道选型仍是 TBD（AGENTS.md §9.2），因此**未配置渠道时不给出可完成的购买路径**。

### 免费 / 付费边界

| 能力 | 免费 | 付费 |
|---|---|---|
| 完整面试次数 | 1 次（`users.free_credits`，**生成报告时消耗**） | 无限 |
| 报告 | 简版（总分 / 六维 / 优势 / 基础建议） | 详细（逐题反馈 + 证据 / 参考回答 / 风险点 / 完整建议） |
| 语音面试 | ✗ | ✓ |

**免费额度在生成报告时消耗**：用户可以先走完整场面试，门槛落在「拿到报告」处。
同一报告重复生成**不会重复消耗**（凭证按 `report_id` 幂等）。

### 服务端权威（不信任前端）

| 项目 | 实现 |
|---|---|
| 定价 | `lib/payments/products.ts` 是**唯一价格真源**；请求体只传 `productId` |
| 权益 | `lib/services/entitlement-service.ts` 是**唯一判定真源**；每个 API 内重新计算 |
| 发放 | 按 `payments.unlock_type` 发放，内容与金额取自服务端订单记录 |

### 回调防重复发放（三层防线）

1. **验签**：HMAC-SHA256，密钥只在服务端；验签失败返回 401
2. **状态闸门**：`payments.status = 'paid'` 时直接返回 `granted: false`，**不再发放**
3. **数据库唯一索引**：`(provider, provider_order_id)` 唯一 + 发放时以 `status='pending'` 作为更新条件的乐观锁，
   并发回调只有一个能成功

另外两条防御：
- **金额比对**：回调金额必须与服务端订单一致，否则拒绝并置为 `failed`（防止改价）
- **未知订单忽略**：本地查不到订单时返回 `granted: false, reason: order_not_found`，
  **不凭空创建订单或发放权益**（防止伪造回调造权益）

### 兑换码

- 明文**不入库**，只存 SHA-256 哈希
- `product_id` 决定金额与权益；核销用 `used_count < max_usages` 乐观锁防并发超发
- 支持一码多用（`max_usages`）、过期时间与停用开关
- 发放走与回调**同一条** `grantEntitlement` 路径，因此同样幂等

### 本地生成试用兑换码

`redemption_codes` 只存哈希，因此需要用脚本写入。可在 `pnpm db:studio` 中插入，
或用 Node 计算哈希后插入：

```bash
node -e "const{createHash}=require('crypto');const c='TEST-CODE-0001'.replace(/[\s-]/g,'').toUpperCase();console.log(c, createHash('sha256').update(c).digest('hex'))"
# 把输出的 hash 以 product_id=package_10 插入 redemption_codes 即可
```

---

## 管理后台（Phase 8）

规格见 [docs/UI.md §8](./docs/UI.md)。页面：`/admin`（概览）、`/admin/users`、`/admin/sessions`、`/admin/orders`、`/admin/logs`、`/admin/audit-logs`。

### 如何成为管理员

`users.is_admin` **只能手动改库**，系统不提供任何自我提权接口（注册接口会忽略该字段，有测试断言）：

```sql
update users set is_admin = true where email = 'you@example.com';
```

登录后首页与导航会出现「管理后台」入口。**该入口仅用于展示** —— 真正的访问控制在服务端 `requireAdmin()` 重新校验。

### 权限隔离

| 场景 | 结果 |
|---|---|
| 未登录访问 `/admin/**` 或 `/api/admin/**` | **401** |
| 已登录但非管理员 | **404**（不是 403） |

> 为什么用 404：403 等于告诉攻击者「这个入口存在，只是你没权限」，便于针对性探测。
> 全项目的越权场景统一返回 404（见 `lib/api/errors.ts`）。

后台使用**独立布局** `app/admin/layout.tsx`，不复用 `(app)` 导航，普通用户的界面里不会出现后台入口。

### 简历原文保护（PII 边界）

**默认不返回、不渲染** `resumes.raw_text` 与 `parsed_data`，后台只显示文件名、大小、解析状态与会话/简历**数量**。

需要排障时显式开启（`.env`）：

```
ADMIN_VIEW_RESUME_CONTENT="true"   # 必须严格为 "true"，不接受 1/TRUE
```

开启后每次查看详情**都会写入审计日志**（`admin.resume_content_viewed`，含操作者与目标）。

**永不返回**：`users.passwordHash`、会话令牌、渠道订单号（后台订单页不展示 `provider_order_id`）。

### 审计日志（只增不改）

| 操作 | action |
|---|---|
| 调整免费次数 | `admin.credits_adjusted`（含调整前后值、增量、原因） |
| 查看简历原文 | `admin.resume_content_viewed` |
| 支付发放 | `payment.granted` / `payment.redeemed` |
| 免费额度消耗 | `credit.free_trial_consumed` |
| 注册/登录/退出/删号 | `auth.*` / `user.delete` |

系统**不提供任何删除或修改审计日志的接口**（AGENTS.md §7 C6）。

### AI 调用日志

`lib/ai/logger.ts` 在每次 LLM 调用后记录元数据：操作类型、模型、耗时、token 用量、状态、错误码与错误摘要。

- **不阻断主流程**：写日志失败只 `console.error`
- **PII 最小化**：只记元数据，**不记提示词与模型响应全文**
- `sanitizeLogText()` 会去除换行并把超长内容截断到 500 字符 —— 防止上游把整段 prompt 或简历原文塞进错误信息写进日志
- 操作类型由各服务显式标注：`parse_jd` / `parse_resume` / `match` / `plan` / `follow_up` / `hint` / `evaluate` / `report`

---

## 合规、可观测性与部署（Phase 9）

### 合规文本（AGENTS.md §7 C1/C2/C4）

| 页面 | 内容 |
|---|---|
| `/legal/terms` | 用户协议：服务为练习工具、账号规则、内容授权、免责 |
| `/legal/privacy` | 隐私政策：收集什么、如何使用、AI 处理说明、保存期限、**导出与删除权利** |
| `/legal/ai-disclosure` | AI 生成内容说明：哪些由 AI 生成、能用/不能怎么用、局限 |

- 正文的真源是 `lib/legal/documents.ts`（代码内版本化，便于评审与部署原子性）
- 注册页的同意文字是**可点击链接**（此前是纯文本，用户无法查看自己同意了什么）
- 登录后的页脚固定展示三个合规入口
- AI 内容标识出现在：首页、面试房间、面试计划页、报告页

### 数据权利（§7 C3）

在 `/settings` 自助完成：

| 操作 | 端点 | 说明 |
|---|---|---|
| 导出 | `GET /api/auth/me/data-export` | 下载 JSON；**不含** passwordHash 与会话令牌；写审计日志 |
| 删除 | `DELETE /api/auth/me` | 软删除 + **吊销全部会话** + 清理 S3 简历原件 |

**删除顺序是有意设计的**：先软删除并吊销会话（用户能立即感知「已不可访问」），
再清理对象存储；**清理失败不回滚删除** —— 宁可对象晚删，不可删除失败。

### 可观测性

| 能力 | 实现 | 限制 |
|---|---|---|
| 结构化日志 | `lib/observability/logger.ts`：单行 JSON，`LOG_LEVEL` 可配；字段经 `redactFields` **强制脱敏**（密码/令牌/简历原文/作答/邮箱） | — |
| 错误监控 | `lib/observability/error-monitor.ts`：`SENTRY_DSN` 配置后 HTTP 上报；未配置**降级为结构化日志**并明确提示 | **未接入外部监控服务** |
| 限流 | `lib/observability/rate-limit.ts`：登录 / 注册 / 兑换 / 回调 各自规则；超限返回 **429** | **进程内内存实现，Vercel 多实例下不精确**（见部署文档 §6.1） |

### 部署与 CI

- 部署文档：**[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** —— Vercel + Neon/Supabase + R2/S3 全流程、迁移执行、首次管理员提权、验收清单、回滚
- CI：`.github/workflows/ci.yml` —— 密钥检查 + lint + typecheck + test + build；
  另有一个**手动触发**的集成测试 job（需配置 `secrets.DATABASE_URL` 等）
- 密钥检查：`scripts/check-secrets.mjs` —— 扫描硬编码密钥（含 `sk-`、`AKIA`、私钥块、含密码的 PG 连接串）、被 git 跟踪的 `.env`、`NEXT_PUBLIC_*` 敏感值

---

## 数据模型（12 张表）

业务表 9 张（`users`、`resumes`、`job_jds`、`interview_sessions`、`questions`、`answers`、`evaluations`、`reports`、`payments`）
\+ 支撑表 3 张（`sessions` 登录会话、`audit_logs` 审计日志、`consents` 同意记录）。

字段级定义与索引见 [docs/DATA_MODEL.md](./docs/DATA_MODEL.md)。关键约束直接落在数据库层：

- `questions.depth BETWEEN 0 AND 2` —— 追问最多 2 层
- `evaluations.evidence_quotes` 必须为非空数组 —— 评分必须引用证据
- `reports` 四要素（亮点/问题/参考回答/下一步建议）NOT NULL
- `sessions.status = 'completed'` 时 `finished_at` 必填
- 支付回调幂等、同一报告不重复解锁（部分唯一索引）

---

## 安全与合规要点

| 项 | 实现 |
| --- | --- |
| 密码存储 | Node 内置 `scrypt`，参数写入哈希串以便后续升级 |
| 会话 | Cookie 存明文令牌，数据库只存 HMAC-SHA256 哈希；退出立即失效（非 JWT） |
| 防账号枚举 | 账号不存在时也执行一次哈希；错误提示与密码错误完全一致 |
| 权限隔离 | 查询条件由 `ownedBy()` 统一生成，**同时包含** `id` 与 `user_id` |
| 知情同意 | 注册时写入 `consents`（terms / privacy / ai_disclosure）+ `users.terms_accepted_at` |
| 审计日志 | `audit_logs` 记录注册、登录、退出、删除账号 |
| 数据删除 | 软删除 + 吊销全部会话；S3 对象清理在后续 Phase 的清理任务完成 |

---

## 已知事项

1. **工作目录混合**：仓库根目录同时存放 DSH harness 运行时（`DshWeb.exe`、`runtimes/`、`*.cmd`、`*.vbs`）。
   这些文件**不属于本项目**，已在 `.gitignore` / `.eslintignore` / `.prettierignore` / `tsconfig.json` 中排除。
2. **集成测试需数据库**：`tests/integration/*` 在缺少 `DATABASE_URL` 或 `AUTH_SECRET` 时**显式跳过**（不会伪装通过）。
3. **未定选型**：ASR 供应商、支付渠道仍为 TBD（见 AGENTS.md §9.2）；
   对象存储与 LLM 已通过端口抽象隔离，可随时替换供应商。
4. **`e2e` 会自动拉起服务**：`playwright.config.ts` 已启用 `webServer`（用 `pnpm dev`）。
   首次运行需先 `pnpm exec playwright install chromium` 下载浏览器。
5. **`next/font/google` 需外网**：构建时访问 `fonts.gstatic.com`，受限网络下会重试或失败，可改为 `next/font/local`。
6. **Phase 1 未包含**：邮箱验证、找回密码、第三方登录、二次验证。
7. **文档现状**：`docs/` 现有 9 份 ——
   `PRD.md`、`DATA_MODEL.md`、`ARCHITECTURE.md`、`AI_PROMPTS.md`、`UI.md`、
   `METRICS.md`、`BETA_FEEDBACK.md`、`ITERATION_PLAN.md`、`DEPLOYMENT.md`。
   仅 `docs/TASKS.md` 仍缺（任务拆解目前只存在于开发过程中的对话里）。
   另：`AI_PROMPTS.md` 已覆盖 JD/简历/匹配/出题/追问/评分/报告全部七类；
   `evaluations.*` 与 `reports.*` **不再是「不稳定契约」**。
8. **旧版 `.doc` 不支持**：明确提示用户另存为 `.docx`，而不是解析出乱码。
9. **ASR 未接入（仅端口就绪）**：录音与上传链路完整，但 `lib/asr` 目前返回「未配置」实现，
   语音转文字返回 503 提示而非伪造文字。供应商选型确定后只需接线，前后端无需改动。
10. **报告页已实现（本条为历史记录）**：`/sessions/[id]/report`（Phase 5）与 `/admin/*`（Phase 8）
    均已落地，`docs/UI.md` 对应章节不再是待补规格。
11. **`pdfjs-dist` 必须保持外置**：`pdf-parse` 的依赖 `pdfjs-dist` 一旦被 webpack
    打包进 server bundle，加载即抛 `TypeError: Object.defineProperty called on non-object`，
    导致 `/api/resumes/upload`、`/api/job-jds/upload` 等路由**整体 500**。
    已在 `next.config.mjs` 的 `serverComponentsExternalPackages` 中声明
    `pdf-parse` / `pdfjs-dist` / `mammoth` / `@aws-sdk/client-s3` / `postgres`。
    **删除该配置会静默破坏简历上传**，且单元测试无法发现（只有真实 HTTP 请求才暴露）。
12. **单测通过 ≠ 路由可用**：上述缺陷是在对每个 API 逐一发真实请求时才发现。
    修改路由或新增原生/CJS 依赖后，务必实测 `curl`/`Invoke-WebRequest`，不能只跑 `pnpm test`。
13. **缺少 `DATABASE_URL` 时返回 503，而不是 500**：所有依赖数据库的接口（注册、登录、
    简历/JD 列表等）在数据库不可用时统一返回
    `503 service_unavailable` + 「请在 .env.local 中设置 DATABASE_URL」。
    实现见 `db/client.ts` 的 `DatabaseUnavailableError` 与 `lib/api/errors.ts` 的
    `isDatabaseUnavailable()`。
    *为什么重要*：早期版本抛的是裸 `Error`，会被兜底成 `500 服务器内部错误`，
    用户与开发者都看不到真实原因，只能翻服务端日志——这正是「服务器内部错误」
    排查成本高的根因。
14. **dev 与 build 使用不同的产物目录**：`next.config.mjs` 中 `distDir` 在
    `NODE_ENV=development` 时为 `.next-dev`，生产构建仍为 `.next`。
    *为什么需要*：两者默认共用 `.next`，在 `pnpm dev` 运行期间执行 `pnpm build`
    （CI 的 `pnpm verify` 就会）会造成 chunk 清单互相覆盖，dev server 随后对
    已编译路由抛出 `Error: Cannot find module './6328.js'` 并返回 500 ——
    看起来像业务 Bug，实际只是产物目录冲突。分开后两者可安全并行。
    两个目录均已在 `.gitignore` 中忽略。
15. **页面守卫必须用 `requirePageUser()`**：`requireUser()` 抛的是 API 层 401，
    在页面渲染中会被 Next.js 当作未知渲染错误打印整段堆栈，把真正的错误淹没。
    另注意 **layout 与 page 并行渲染**，`layout.tsx` 里的 `notFound()`
    **拦不住** page 组件取数；后台各页因此都在自身最早处重复守卫
    （`getAdminOrNull()` 已用 React `cache()` 包裹，同一请求内不产生额外查询）。
16. **E2E 只能单 worker 跑**：多个 project 共用同一个 seed 会话 + 同一个按 IP 的登录限流，
    并行会让 `/answers` 撞唯一约束返回 500、`/finish` 撞状态机返回 422。
    这类失败单独跑必过，极难定位——已在 `playwright.config.ts` 用 `workers: 1` 固定。
17. **重复提交同一题必须幂等**：`answers_question_unique` 唯一约束在重复提交时
    会抛 Postgres 23505，早期实现被兜底成 **500 服务器内部错误**。
    真实触发场景很多（双击提交、超时重试、返回再提交、刷新重发），
    现已在 `submitAnswer` 中先查后写，重复提交直接返回当前进度。
18. **`/api/test/reset-session` 是 E2E 专用入口**：仅 `NODE_ENV !== 'production'`
    且配置了 `E2E_RESET_TOKEN` 时存在，需带 `x-e2e-reset-token` 头（定长时间比较）。
    它只清理**该会话自己**的答题/评分/消息并把阶段复位，不触碰权益与他人数据。
    **生产环境该路由直接 404**，因此不必担心暴露面。
19. **E2E 断言要等真实响应，不要只看 DOM**：点击若发生在 hydration 完成前会被静默忽略，
    只断言最终 DOM 会得到含糊的「元素未找到」。`interview.spec.ts` 的提交/结束用例
    均改为 `waitForResponse` 后再断言状态码，既防竞态也能直接暴露接口错误。
20. **存储必须走 `createStorage()` 工厂，不要 `new S3Storage()`**：
    后者在缺少 `S3_*` 时**构造即抛错**。历史缺陷是 `upload-service.ts` 把它写在
    `try` 外面，于是专为它准备的 `storage_unavailable → 503` 分支永远不执行，
    异常冒泡成 **500「服务器内部错误」**——用户看到「解析简历服务器错误」，
    真正原因只是没配对象存储。工厂在开发环境回退本地文件系统，
    并把「未配置」抛成可识别的 `StorageUnavailableError`。
21. **本地存储（`.local-storage/`）仅限开发**：`STORAGE_DRIVER=local` 或
    非生产环境未配 S3 时自动启用，让上传链路开箱可用。
    **生产环境不会静默回退**——Serverless 文件系统只读且临时，
    回退会导致「上传成功但文件随即消失」，因此直接抛错返回 503。
22. **解析失败 ≠ 上传失败，不要删记录**：`upload-service.finish()` 早期在
    `ai_unavailable` 时删除记录与对象并返回 503，导致用户上传的简历**凭空消失**，
    而该错误的文案本身就写着「…或手动填写」，自相矛盾。
    现在只有 `not_in_scope` 会清理；其余失败一律保留记录 + 原文 + `parse_error`。
23. **JD 的「重新解析」曾只 `router.refresh()`**：那只是重新读取已有数据，
    根本不会重新调用模型，用户点了没变化以为功能坏了。
    现已真正调用 `POST /api/job-jds/:id/parse`；
    并且**任何**解析失败都会先写 `parse_error` 再返回，
    避免出现「待确认」但没有任何失败原因的状态。
24. **数据库连接池必须挂在 `globalThis` 上**：`db/client.ts` 原先用模块级变量缓存，
    而 Next.js dev 会把同一模块打进**多个 server bundle**（RSC / route handler / …），
    每份副本各自建一个 `max: 10` 的连接池。
    表现为：跑几轮 E2E 后 Postgres 报
    `sorry, too many clients already`（实测连接数从 1 涨到 29，每轮 +28，
    `max_connections=100` 时 3~4 轮即耗尽），随后**所有页面因查库失败而空白**，
    24 个 E2E 用例同时失败——看起来像 UI 改动引发的回归，实际是连接泄漏。
    现已用 `Symbol.for()` 挂到 `globalThis`，多份 bundle 共用同一个池；
    并把 `idle_timeout` 设为 20 秒让空闲连接及时归还。
    **改这个文件时不要退回模块级变量。**
25. **`/api/test/reset-session` 的「重置」与「清理」必须分开**：
    E2E 里历史记录类用例只需要**清理** draft 会话，却调用了同一个端点，
    而该端点会**无条件**把会话重置成 `planned/READY`。
    结果是「报告会话」被改成未完成态，列表只在 `status='completed'` 时渲染
    「查看报告」入口，于是「从历史记录进入旧报告」永久失败
    （现象像 seed 数据损坏，实为一个清理调用做成了重置调用）。
    现已支持 `cleanupOnly: true`：只清理、不动目标会话状态。
26. **本地嵌入式 Postgres 在 Windows 上会因强制终止而僵死**：`Stop-Process` 杀掉
    dev server 后若留下 postgres 子进程，端口仍 `LISTENING` 但新连接全部失败
    （`CONNECT_TIMEOUT`，`/api/health` 恒为 degraded）。
    此时需**终止所有 postgres 进程**再重新 `pnpm dev:all`，
    数据目录 `.local-pg/` 不会丢。

---

## 下一步

**当前阶段：内测准备**。计划见 [docs/ITERATION_PLAN.md](./docs/ITERATION_PLAN.md)，指标口径见 [docs/METRICS.md](./docs/METRICS.md)。

内测前必须先完成三项（详见迭代计划 §2），它们都不是新功能，而是**让产品能被真实测量与验证**：

1. **埋点落地 + 隐私政策同步提版**（行为采集属处理目的变更，须重新征得同意）
2. **接入真实支付渠道**（当前仅兑换码，**付费率恒为 0**）
3. **`git init` + 让 CI 真正执行**（CI 与密钥检查已写好但从未跑过）

Phase 5：逐题评分与报告生成。
开始前必须先把**逐题评分、报告生成两类 prompt 与 JSON Schema** 补进 `docs/AI_PROMPTS.md`
（`evaluations.dimension_scores`、`reports.*` 目前仍是不稳定契约），
并确认 ASR 供应商选型（语音作答依赖它）。
