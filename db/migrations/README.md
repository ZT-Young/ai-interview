# db/migrations —— 数据库迁移

**这个目录的文件由 `drizzle-kit generate` 自动生成，不要手改、不要改名。**

## 为什么文件名是随机的

`0000_famous_absorbing_man.sql`、`0007_clumsy_stature.sql` 这类名字是 drizzle-kit 随机生成的
（与 Prisma 的风格一致）。它们**不是**描述性的，所以本文件提供对照表。

## 迁移对照表

| 文件 | 改了什么 |
| --- | --- |
| `0000_famous_absorbing_man.sql` | 初始 schema：users · sessions · consents · audit_logs · resumes · job_jds · interview_sessions · questions · answers · evaluations · reports · payments |
| `0001_add_extraction_meta.sql` | 解析元信息：抽取方式、耗时、原始文本长度等便于排障的字段 |
| `0002_questions_plan_fields.sql` | 出题相关：题型、来源（JD/简历/通用）、序号、追问层级 `depth` |
| `0003_orchestration.sql` | 编排：会话阶段字段、消息持久化 |
| `0004_report_resume_risks.sql` | 报告：简历风险点与结构化建议字段 |
| `0005_payments_and_redemption.sql` | 支付与兑换码：订单、权益发放、兑换码表 |
| `0006_admin_and_ai_logs.sql` | 管理后台支撑：审计日志扩展与 `ai_call_logs` |
| `0007_clumsy_stature.sql` | 给 `evaluations` 加 `reference_answer`（逐题参考答案） |

## 三条铁律

1. **不要手写 SQL 文件放进来**。Drizzle 靠 [`meta/_journal.json`](./meta/_journal.json) 与
   `meta/*_snapshot.json` 追踪已应用的迁移；手工新增的文件**不会被执行**，只会造成
   「schema 与数据库不一致」且本地看起来一切正常。要加字段必须走：

   ```bash
   # 1. 改 db/schema/**（如 db/schema/evaluations.ts）
   # 2. 生成迁移
   pnpm db:generate
   # 3. 应用
   pnpm db:migrate
   ```

2. **不要重命名已提交的迁移文件**。文件名记录在 `meta/_journal.json` 里，改名会让
   Drizzle 认为该迁移没应用过，从而重复执行或直接报错。

3. **不要修改已应用的迁移内容**。已经在生产跑过的 SQL 再改，本地能过、生产对不上。
   改错了就新加一个迁移去修正。

## `meta/` 子目录

| 文件 | 作用 |
| --- | --- |
| `_journal.json` | 迁移清单：按顺序记录每个迁移的 tag 与时间戳，Drizzle 靠它判断「哪些已应用」 |
| `000N_snapshot.json` | 每个迁移执行后的 schema 快照，`generate` 靠它做 diff 决定下一个迁移该写什么 |

这两个都由工具维护，**视作二进制产物，不要手改**。

## 本地怎么跑

```bash
pnpm db:migrate    # 对 DATABASE_URL 指向的库执行迁移
```

本地开发用的是 `pnpm dev:all` 启动的内嵌 PostgreSQL（端口 55432，数据目录 `.local-pg/`），
它会先自动建库再执行迁移，所以正常情况下你不需要单独跑这条命令。
