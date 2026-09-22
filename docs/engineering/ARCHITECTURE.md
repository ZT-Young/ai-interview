# 技术架构（V1）

> 上位依据：[AGENTS.md](../AGENTS.md) §4（技术栈）、§6（AI 规则）、§7（合规）、§9（工作流）。
> 字段与枚举以 [DATA_MODEL.md](./DATA_MODEL.md) 为单一真源，本文不重复定义。

---

## 1. 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│ ① 渲染层  app/**/page.tsx · app/**/layout.tsx · components/  │
│    职责：展示与交互。禁止直接访问数据库、禁止内联 prompt。    │
├──────────────────────────────────────────────────────────────┤
│ ② 接口层  app/api/**/route.ts · Server Actions               │
│    职责：HTTP 语义、zod 入参校验、调用 requireUser()、        │
│          错误→状态码映射。不含业务规则。                      │
├──────────────────────────────────────────────────────────────┤
│ ③ 领域服务层  lib/services/*                                 │
│    职责：业务规则与不变量（状态机、追问深度、评分公式、       │
│          归属校验、额度扣减、解锁判定）。事务边界在此。       │
├──────────────────────────────────────────────────────────────┤
│ ④ 能力层  lib/ai/*（LLM/ASR）· lib/storage/*（S3）·          │
│          lib/auth/*（密码/会话）· lib/payments/*             │
│    职责：对接外部能力，返回领域对象或抛 AiError 等类型化错误。│
├──────────────────────────────────────────────────────────────┤
│ ⑤ 数据访问层  db/client.ts · db/schema/*                     │
│    职责：Drizzle schema（单一真源）+ 惰性连接。               │
└──────────────────────────────────────────────────────────────┘
外部服务：PostgreSQL · LLM(OpenAI 兼容) · ASR · S3 兼容存储 · 支付渠道(TBD)
```

**依赖方向严格单向向下**：① → ② → ③ → ④ → ⑤。
上层可调用下层，**下层禁止反向 import 上层**（`lib/services` 不得 import `app/`）。

**硬性约束**
- 复杂 AI 逻辑**只允许**放 `lib/ai`（AGENTS.md §4）。
- 密钥只在 ④ 层读取，禁止出现在 ①②③ 层与前端 bundle。
- 所有跨表写入必须在 ③ 层用事务包裹（`db.transaction`）。

---

## 2. 目录结构

```
ai-interview/
├── app/
│   ├── (auth)/                      # 未登录可访问
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (app)/                       # 需登录（layout 内做重定向守卫）
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # 工作台：简历/JD 入口
│   │   ├── resumes/                 # 简历管理
│   │   ├── jd/                      # JD 管理
│   │   ├── sessions/
│   │   │   ├── new/page.tsx         # 解析结果确认 + 生成计划
│   │   │   └── [id]/page.tsx        # 面试进行中
│   │   └── reports/[id]/page.tsx    # 报告（含付费解锁）
│   ├── admin/                       # 管理后台最小版（P2）
│   ├── api/
│   │   ├── health/route.ts          # 健康检查（DB 连通性）
│   │   ├── auth/
│   │   │   ├── register/route.ts
│   │   │   ├── login/route.ts
│   │   │   ├── logout/route.ts
│   │   │   └── me/route.ts
│   │   ├── resumes/route.ts         # GET 列表 / POST 创建
│   │   ├── resumes/[id]/route.ts    # GET / PATCH / DELETE
│   │   ├── job-jds/route.ts
│   │   ├── job-jds/[id]/route.ts
│   │   ├── sessions/route.ts
│   │   └── sessions/[id]/route.ts
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── ui/                          # shadcn/ui 原子组件
│   └── features/                    # 业务组件（按域分子目录）
├── lib/
│   ├── ai/                          # ④ LLM + ASR + prompt + 编排
│   │   ├── client.ts                # OpenAI 兼容 /chat/completions
│   │   ├── errors.ts                # AiError 分类
│   │   ├── prompts/                 # 各环节 prompt 与 JSON Schema
│   │   ├── scoring.ts               # 评分公式（DATA_MODEL §5）
│   │   └── types.ts
│   ├── auth/                        # ④ 密码哈希、会话签发与校验
│   │   ├── password.ts
│   │   ├── session.ts
│   │   └── guard.ts                 # requireUser()
│   ├── services/                    # ③ 领域服务
│   │   ├── auth-service.ts
│   │   ├── resume-service.ts
│   │   ├── job-jd-service.ts
│   │   └── session-service.ts
│   ├── payments/                    # ④ 支付渠道抽象（TBD）
│   ├── storage/                     # ④ S3 兼容存储
│   ├── api/                         # ② 共用：错误映射、响应封装
│   │   ├── errors.ts                # ApiError → HTTP 状态码
│   │   └── respond.ts
│   ├── validators/                  # zod 入参 schema（与 DB 无关的输入契约）
│   ├── env.ts
│   └── utils.ts
├── db/
│   ├── schema/
│   │   ├── enums.ts                 # 枚举单一真源
│   │   ├── users.ts · sessions.ts · consents.ts · audit-logs.ts
│   │   ├── resumes.ts · job-jds.ts
│   │   ├── sessions-interview.ts    # interview_sessions + questions + answers + evaluations
│   │   ├── reports.ts · payments.ts
│   │   └── index.ts
│   ├── migrations/                  # drizzle-kit generate 产物
│   └── client.ts
├── tests/
│   ├── setup.ts
│   ├── unit/                        # 纯函数，无需 DB
│   ├── integration/                 # 需 DATABASE_URL，缺失时跳过
│   └── helpers/                     # 测试夹具（建用户、造会话）
├── e2e/                             # Playwright
├── docs/
├── drizzle.config.ts
├── vitest.config.ts
├── playwright.config.ts
└── .env.example
```

---

## 3. 数据流

### 3.1 注册 / 登录 / 会话校验

```
注册  POST /api/auth/register
  → zod 校验(email, password≥8)
  → auth-service.register()
      ├─ 邮箱规范化(小写) + 唯一性检查
      ├─ password.hash() → password_hash
      ├─ INSERT users（free_credits 默认 1）
      ├─ INSERT consents(terms, privacy, ai_disclosure, version)
      └─ 同一事务内 INSERT sessions + audit_logs
  → Set-Cookie: session=<明文token>; HttpOnly; SameSite=Lax; Secure(prod); Path=/
  → 201 { user }

登录  POST /api/auth/login
  → 按 email 查 user（含 deleted_at IS NULL）
  → password.verify()  ← 失败也执行一次哈希以抹平时间差
  → 新建 sessions 记录（token 只存 sha256 哈希）
  → audit_logs: auth.login
  → 200 { user } + Set-Cookie

校验  任意受保护请求
  → requireUser()
      ├─ 读 Cookie → sha256 → 查 sessions（revoked_at IS NULL AND expires_at > now()）
      ├─ JOIN users 校验 deleted_at IS NULL
      └─ 命中则返回 { user }，否则抛 ApiError(401)
```

**关键决策**：会话走**数据库会话表 + HttpOnly Cookie**，不使用 JWT。
理由：退出登录需**立即失效**（JWT 无法吊销），且 `sessions` 表天然承载审计所需的 IP/UA。

### 3.2 面试问答循环（含追问深度判定）

```
POST /api/sessions/:id/answer            （Phase 3，此处仅示数据流）
  → requireUser() → 会话归属校验 → 状态必须 in_progress
  → INSERT answers（question_id 唯一）
  → session-service.evaluate(questionId)
      ├─ lib/ai 评分 → evaluations（evidence_quotes 非空）
      └─ 决定下一步：
         ├─ 读取该题 root_id 下已有 depth 分布
         ├─ depth < 2 且 AI 判定值得追问 → INSERT questions(parent_id, root_id, depth+1)
         └─ 否则           → 取下一条主问题（depth=0）
  → 全部题目答完 → status: in_progress → completed
```

**追问上限的实现口径**：`questions.depth BETWEEN 0 AND 2` 由 CHECK 约束兜底；
服务层按 `root_id` 分组统计，**每道主问题**最多 2 层追问（对齐 AGENTS.md §2 第 7 步）。

### 3.3 评分与报告生成

```
status → completed
  → 聚合 evaluations（按 session_id）
  → lib/ai/scoring.ts 计算维度汇总分与总分（公式见 DATA_MODEL §5）
  → INSERT reports（highlights/issues/reference_answers/next_steps 四要素非空）
  → 免费可见：total_score、dimension_scores、highlights
  → 付费可见：issues、reference_answers、next_steps、逐题 evaluations
```

### 3.4 支付解锁（Phase 5）

```
创建订单 → payments(status=pending) → 跳转渠道（TBD）
渠道回调 → 验签 → UPDATE payments SET status='paid', paid_at=now()
            （幂等键：provider + provider_order_id 唯一索引）
         → unlock_type=report   → reports.is_unlocked=true
         → unlock_type=package  → users.free_credits += credits_granted
         → unlock_type=subscription → users.membership 升级
         → audit_logs: report.unlock / payment.paid
```

### 3.5 长任务与 Vercel 超时

简历/JD 解析、报告生成可能超过 Serverless 函数时限。**V1 对策**：
1. 接口立即返回 `202` + 资源 ID，`parse_status='processing'`；
2. 任务在 Route Handler 内以后台 Promise 触发（`waitUntil` 语义），或退化为**同步但限时**；
3. 前端按 `parse_status` 轮询（`GET /api/resumes/:id`），不做 WebSocket。

> 若实测频繁超时，升级为独立队列（TBD，超出 V1 范围，需先提问）。

### 3.6 面试编排状态机

面试过程由**服务端状态机**驱动，前端只负责展示与提交。实现：
`lib/services/orchestration-state.ts`（纯函数，可单测）+ `orchestration-service.ts`（编排与落库）。

#### 3.6.1 两个状态维度（不可混淆）

| 维度 | 列 | 取值 | 语义 |
|---|---|---|---|
| **生命周期** | `interview_sessions.status` | `draft` / `planned` / `in_progress` / `completed` / `cancelled` / `failed` | 会话整体处于哪个大阶段；失败与取消在此表达 |
| **编排阶段** | `interview_sessions.phase` | 见下 9 值 | 面试进行中的细粒度位置 |

映射关系：面试开始（`status: planned → in_progress`）时 `phase: READY`；
面试正常结束（`status → completed`）时 `phase: FINISHED`；
`status: cancelled/failed` 时 `phase` 保留最后值，供排查。

#### 3.6.2 九个编排阶段与流转

```
IDLE ──► PARSING ──► READY ──► ASKING ──► WAITING_ANSWER
  ▲                                ▲            │
  │                                │            ├──► FOLLOW_UP ──┐
  │                                │            │                │
  │                                └── NEXT_QUESTION ◄───────────┘
  │                                                 │
  └──────────────── FINISHED ◄──────────────────────┘
                        │
                        ▼
                    REPORTING
```

| 阶段 | 含义 | 允许的下一步 |
|---|---|---|
| `IDLE` | 会话已创建，尚未开始 | `PARSING`、`READY` |
| `PARSING` | 面试前置资料解析中（兼容保留） | `READY` |
| `READY` | 计划就绪，可开始作答 | `ASKING` |
| `ASKING` | 正在抛出一道题 | `WAITING_ANSWER` |
| `WAITING_ANSWER` | 等待用户回答 | `FOLLOW_UP`、`NEXT_QUESTION`、`FINISHED` |
| `FOLLOW_UP` | 正在生成追问 | `ASKING`、`NEXT_QUESTION` |
| `NEXT_QUESTION` | 正在推进到下一题 | `ASKING`、`FINISHED` |
| `FINISHED` | 面试结束（无可问题目或用户结束） | `REPORTING` |
| `REPORTING` | 报告生成中（Phase 4 落库） | — |

**不变量**
- 非法迁移由 `assertPhaseTransition` 拒绝（422）。
- `FINISHED` 为终态；`REPORTING` 由报告流程进入。
- 「一次只问一个问题」：任何响应最多返回 **1** 条 `question` / `follow_up` 消息。

#### 3.6.3 追问层数上限（服务端强制）

```
主问题 depth = 0
   └─ 追问 1 depth = 1  (parent_id = 主问题, root_id = 主问题)
        └─ 追问 2 depth = 2
             └─ 服务端强制转 NEXT_QUESTION（即使模型仍想追问）
```

- 上限常量：`MAX_QUESTION_DEPTH = 2`（`db/schema/enums.ts`），并有 CHECK 约束兜底。
- 服务端按 `root_id` 统计当前已有最大 `depth`；`depth >= 2` 时**忽略模型结果**，直接推进。
- `questions.follow_up_allowed = false` 时上限视为 0（自我介绍、反问不追问）。

#### 3.6.4 消息持久化

| 表 | 存什么 |
|---|---|
| `interview_messages` | **全部对话消息**：AI 提问/追问/提示/系统提示 + 用户回答/跳过 |
| `answers` | 用户回答的**权威表**（`question_id` 唯一），供评分与报告使用 |

`interview_messages.role ∈ {ai, user, system}`，`type ∈ {question, follow_up, hint, answer, skip, system}`；
追问消息额外记录 `follow_up_reason ∈ {vague, too_short, off_topic, good_enough}` 与 `focus`（模型依据的回答片段）。

---

## 4. 鉴权方案（已定：自建）

| 项 | 决策 |
|---|---|
| 凭证 | **邮箱 + 密码**（Phase 1 不发验证邮件，`email_verified_at` 留空表示待验证） |
| 密码哈希 | Node 内置 `crypto.scrypt`（无原生依赖，便于 Serverless 部署）；参数记录在哈希串内以便后续升级 |
| 会话载体 | `sessions` 表 + HttpOnly Cookie（**非 JWT**，理由见 §3.1） |
| 会话有效期 | 30 天滑动过期；退出登录置 `revoked_at` 立即失效 |
| 密码要求 | 最少 8 位；服务端校验，前端提示 |
| 权限模型 | 每请求 `requireUser()`；资源查询强制 `WHERE user_id = :currentUser` |
| 跨用户访问 | 返回 **404**（而非 403），避免泄露资源是否存在 |

**未纳入 Phase 1**（需二次确认后再做）：邮箱验证、找回密码、第三方登录、二次验证。

---

## 5. 环境变量清单

校验实现：`lib/env.ts`（分组校验，缺失时报出可读错误）。真实值只进 `.env.local` / 部署平台。

| 变量 | 分组 | 必填时机 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | database | **Phase 1 起必填** | PostgreSQL 连接串，含 `sslmode` |
| `AUTH_SECRET` | auth | **Phase 1 起必填**（≥16 字符） | Cookie 签名 / 令牌派生 |
| `LLM_API_KEY` | llm | Phase 3 起 | OpenAI 兼容接口密钥 |
| `LLM_BASE_URL` | llm | Phase 3 起 | 如 `https://api.deepseek.com/v1` |
| `LLM_MODEL` | llm | Phase 3 起 | 如 `deepseek-chat` |
| `ASR_API_KEY` | asr | Phase 3 起 | 语音转文字 |
| `ASR_BASE_URL` | asr | Phase 3 起 | — |
| `S3_ENDPOINT` | storage | Phase 2 起 | S3 兼容端点（R2/S3/MinIO） |
| `S3_ACCESS_KEY` | storage | Phase 2 起 | — |
| `S3_SECRET_KEY` | storage | Phase 2 起 | — |
| `S3_BUCKET` | storage | Phase 2 起 | — |
| `S3_REGION` | storage | 可选 | 默认 `auto` |
| `E2E_BASE_URL` | — | 可选 | Playwright 目标地址，默认 `http://127.0.0.1:3000` |

**禁止**：把密钥写入 `NEXT_PUBLIC_*`（会打进前端 bundle）。

---

## 6. 部署方案

| 组件 | 选型 | 备注 |
|---|---|---|
| 应用 | Vercel | Next.js 14 App Router |
| 数据库 | Neon / Supabase PostgreSQL | 连接池要求 `prepare: false`（`db/client.ts` 已设置） |
| 对象存储 | Cloudflare R2 / AWS S3 | S3 兼容 |
| 定时任务 | Vercel Cron | 清理过期会话、硬删软删数据 |

**构建期注意**：`next/font/google` 在 build 时访问 `fonts.gstatic.com`，受限网络下会重试或失败；如需完全离线构建，改为本地字体（`next/font/local`）。

**迁移**：在 CI/发布流程执行 `pnpm db:migrate`（**不可**在应用运行时自动迁移）。

**回滚策略**：迁移只允许「向前兼容」变更（先加列后删列）；破坏性变更需两步发布。

---

## 7. 第三方服务与选型状态

| 能力 | 状态 | 备选 |
|---|---|---|
| 鉴权 | ✅ **已定：自建**（邮箱+密码+DB 会话） | — |
| LLM | ✅ 已定：OpenAI 兼容接口 | DeepSeek / Qwen / GPT 由环境变量切换 |
| 数据库 | ✅ 已定：PostgreSQL + Drizzle | Neon / Supabase 待定 |
| ASR | ⏳ **TBD** | Whisper API / 国内 ASR |
| 对象存储 | ⏳ **TBD** | R2 / S3 / MinIO |
| 支付渠道 | ⏳ **TBD** | 微信支付 / 支付宝 / Stripe |
| 邮件 | ⏳ **TBD** | Phase 1 不需要 |

> TBD 项须在进入对应 Phase 前确认（AGENTS.md §9.2）。当前实现通过接口抽象隔离，
> 例如 `lib/storage` 只暴露 `putObject/getObject/deleteObject`，替换供应商不改调用方。

---

## 8. 测试策略

| 层级 | 工具 | 范围 | 是否需要数据库 |
|---|---|---|---|
| 单元 | Vitest | 密码哈希、会话令牌、评分公式、状态机迁移、权限判定纯逻辑 | 否 |
| 集成 | Vitest | 注册/登录/CRUD/权限隔离（真实 SQL） | **是** |
| E2E | Playwright | 注册→登录→建简历→建会话 | 是 |

**无 `DATABASE_URL` 时的行为**：集成测试**跳过并明确标注**，不得伪装通过。
本地与 CI 必须提供数据库以完成「迁移成功 / 能注册登录」的验收。

**测试夹具约定**：`tests/helpers/` 提供 `createTestUser()`、`createTestResume(userId)`；
每个集成测试用例使用独立事务或在 `afterEach` 清理，避免用例间污染。

---

## 9. 与 `AGENTS.md` 的对应关系

| AGENTS.md 条款 | 架构落点 |
|---|---|
| §3.2 V1 非目标（不做视频/表情/自动淘汰） | 本文无任何摄像头、媒体流、录用决策模块 |
| §4 复杂 AI 逻辑只在 `lib/ai` | §2 目录结构 + §1 依赖方向 |
| §5 数据模型 | `db/schema/*`，见 DATA_MODEL.md |
| §6 N1–N7 AI 规则 | `lib/ai/prompts` + `lib/ai/scoring.ts` + DB 层 CHECK 兜底 |
| §7 C1–C6 合规 | `consents`/`audit_logs` 表 + §4 权限模型 + §3.4 审计 |
| §7 C5 不得自动拒绝候选人 | **无任何自动淘汰/拒绝流程**；报告仅供用户自查 |
| §8 不硬编码密钥 | `lib/env.ts` + `.env.example` |
| §9.3 验证命令 | README「常用命令」+ §8 测试策略 |
