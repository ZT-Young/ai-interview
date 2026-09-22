# docs/engineering —— 工程侧文档

回答「**怎么实现的、契约是什么**」。这三份文档是代码的配套说明书：代码改了这里必须同步改。

| 文件 | 作用 | 什么情况下要改它 |
| --- | --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构。四层分层约定、目录结构、6 条核心数据流、面试编排状态机（§3.6）、环境变量清单（§5）、第三方服务选型状态、测试策略 | 新增目录、改分层、改状态机、加环境变量、换第三方服务 |
| [DATA_MODEL.md](./DATA_MODEL.md) | 数据模型。9 个核心实体的字段级定义、索引与唯一约束、枚举取值、**分数换算公式的唯一真源**（§5） | 改 `db/schema/**`、加字段、改枚举、动分数公式 |
| [AI_PROMPTS.md](./AI_PROMPTS.md) | AI 契约。四类任务（解析 / 匹配 / 出题 / 评分报告）的 prompt 全文与配套 JSON Schema、版本号约定、重试与降级策略 | 改 `lib/ai/prompts/**` 或 `lib/ai/schemas/**` |

## 三者与代码的对应关系

```
ARCHITECTURE.md  ←→  整个仓库目录 + next.config / vitest / playwright 配置
DATA_MODEL.md    ←→  db/schema/**（Drizzle schema 是代码侧真源，本文件是解释）
AI_PROMPTS.md    ←→  lib/ai/prompts/** 与 lib/ai/schemas/**（成对出现，缺一不可）
```

## 改这些文档时的硬约束

- **prompt 与 schema 必须成对更新**：只改 prompt 不改 schema，模型输出会校验失败；
  只改 schema 不改 prompt，模型不知道该填新字段。两者都在 [AI_PROMPTS.md](./AI_PROMPTS.md) 中登记。
- **禁止项（`PROHIBITED_PATTERNS`）改动必须配回归测试**：见 [../../AGENTS.md](../../AGENTS.md) §6.1 的
  N1–N7 与 `lib/parsing/verify.ts`。过宽的禁止项会误杀正常问题，导致整场出题失败。
- **分数公式只能有一个实现**：`lib/ai/scoring.ts` 是唯一实现，[DATA_MODEL.md](./DATA_MODEL.md) §5 是唯一说明。
  任何地方都不允许在模板或组件里重算分数。

## 相关代码位置速查

| 想找… | 去哪 |
| --- | --- |
| AI 逻辑（prompt、schema、评分） | `lib/ai/` |
| 业务用例（被路由调用） | `lib/services/handlers/` |
| 纯函数状态机（无 I/O） | `lib/services/state/` |
| 路由层支撑（鉴权、错误、归属校验） | `lib/api/` |
| 简历/JD 解析链路 | `lib/parsing/` |
| 数据库 schema 与迁移 | `db/schema/`、`db/migrations/` |
| 数据模型（9 个实体） | [DATA_MODEL.md](./DATA_MODEL.md) |
| 测试怎么写 | [../../AGENTS.md](../../AGENTS.md) §9.4 验证命令 |
