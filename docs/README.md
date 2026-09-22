# 项目文档索引

本目录按**读者**分组。不知道从哪看起时，按下表选一行即可。

## 按角色找文档

| 你是 | 先看 | 再看 |
| --- | --- | --- |
| 新加入的开发者 | [../README.md](../README.md) —— 怎么跑起来 | [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) —— 分层与数据流 |
| 想知道要做什么产品 | [product/PRD.md](./product/PRD.md) | [product/METRICS.md](./product/METRICS.md) —— 怎么衡量做得好 |
| 要改数据库 / 加字段 | [engineering/DATA_MODEL.md](./engineering/DATA_MODEL.md) | [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) §2 目录结构 |
| 要改 AI 提问 / 打分 | [engineering/AI_PROMPTS.md](./engineering/AI_PROMPTS.md) | 仓库根目录 [AGENTS.md](../AGENTS.md) §6 —— AI 硬约束 |
| 要做界面 | [design/UI.md](./design/UI.md) | [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) §3.6 状态机 |
| 要部署上线 | [ops/DEPLOYMENT.md](./ops/DEPLOYMENT.md) | [engineering/ARCHITECTURE.md](./engineering/ARCHITECTURE.md) §5 环境变量 |
| 要安排下一批开发 | [product/ITERATION_PLAN.md](./product/ITERATION_PLAN.md) | [product/BETA_FEEDBACK.md](./product/BETA_FEEDBACK.md) —— 内测怎么做 |
| 是 AI 编码 Agent | 仓库根目录 [AGENTS.md](../AGENTS.md) —— 执行规约 | 本文件所在目录的全部文档 |

## 目录结构

```
docs/
├── README.md            ← 你在这里（文档索引）
├── product/             产品侧：做什么、为什么、怎么衡量
│   ├── PRD.md                 产品需求文档：定位、用户画像、10 步核心流程、页面清单、功能优先级
│   ├── METRICS.md             指标与埋点：5 个事件定义、完面率/报告打开率/付费率的 SQL 口径
│   ├── ITERATION_PLAN.md      迭代计划：V1 内测 → V1.1 的三批优先级
│   └── BETA_FEEDBACK.md       内测反馈问卷：7 个部分、投放方式、回收纪律
├── engineering/         工程侧：怎么实现、契约是什么
│   ├── ARCHITECTURE.md        技术架构：分层、目录结构、数据流、状态机、环境变量、测试策略
│   ├── DATA_MODEL.md          数据模型：9 个核心实体的字段级定义、索引、约束、分数公式
│   └── AI_PROMPTS.md          AI 契约：每类任务的 prompt 全文与配套 JSON Schema
├── design/              设计侧：长什么样、有哪些状态
│   └── UI.md                  UI 规格：页面与路由清单、组件清单、全站状态设计、逐页规格
├── ops/                 运维侧：怎么上线、出问题怎么办
│   └── DEPLOYMENT.md          部署：Neon/Supabase + R2/S3 + Vercel 全流程、迁移、回滚
└── samples/             仅本地保留的手工测试样本（**不入库**，见该目录 README）
```

## 文档维护约定

- **单一真源**：一条规则只写在一个地方，其他文档用链接指过去。例如分数公式只在
  [engineering/DATA_MODEL.md](./engineering/DATA_MODEL.md) §5 定义，[README](../README.md) 只链接不复制。
- **改代码必须同步改文档**：新增路由要更新 [../README.md](../README.md) 与
  [design/UI.md](./design/UI.md) §1；改 schema 要更新 [engineering/DATA_MODEL.md](./engineering/DATA_MODEL.md)；
  改 AI 行为要更新 [engineering/AI_PROMPTS.md](./engineering/AI_PROMPTS.md) 与
  [AGENTS.md](../AGENTS.md) §6。
- **链接必须是相对路径**，保证 GitHub 网页上可点、clone 到本地也能点。
- 新增文档请放进上面四个分组之一，**不要平铺在 `docs/` 根下**，并回到本文件登记一行。

## 已知缺口

- `docs/TASKS.md` 尚未建立：任务拆解目前只存在于开发过程的对话中，尚未落文档。
  相关待办见 [product/ITERATION_PLAN.md](./product/ITERATION_PLAN.md)。
- 待选型事项（支付渠道组合、ASR 供应商、免费次数规则）记录在 [AGENTS.md](../AGENTS.md) §9.2，
  **未定性结论不得由开发者或 Agent 单方面决定**。
