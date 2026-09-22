# lib/services —— 业务用例层

服务层夹在「路由」与「底层能力」之间，是**唯一**允许编排数据库、AI、存储、支付的层。

```
app/api/**/route.ts        ← 只做：解析入参 → 调服务 → 返回 envelope
        ↓
lib/services/handlers/     ← 你在这里：业务用例（鉴权、校验归属、事务、编排）
        ↓
lib/services/state/        ← 纯函数状态机（无 I/O，可单测）
lib/ai · lib/parsing · lib/storage · lib/payments · db/
```

## 两个子目录的分工

### `handlers/` —— 业务用例，有副作用

每个文件对应一个业务领域，导出若干**动词命名的函数**（`createSession`、`generateReport`…）。
它们可以访问数据库、调 LLM、发支付请求，并负责：

- **归属校验**：`requireOwnedResume` / `requireOwnedJobJd` 等，防止越权读到别人的数据
- **状态迁移合法性**：调用 `state/` 的 `assertTransition`，非法迁移直接抛错
- **幂等**：重复提交同一份作答不会产生第二条记录
- **外部依赖失败的可读错误**：LLM 额度不足、超时、存储不可用等要转成带 code 的响应

命名约定：`<领域>-service.ts`。后缀 `-service` 是**有意的冗余**——它让全局搜索
`services/handlers/*-service` 能一次性列出所有业务用例，与 `state/` 的纯函数区分开。

| 文件 | 职责 |
| --- | --- |
| `admin-service.ts` | 管理后台：用户/面试/订单查询、额度调整、审计日志 |
| `auth-service.ts` | 注册、登录、登出、会话签发与校验 |
| `data-rights-service.ts` | 合规：数据导出、账号删除（覆盖数据库与对象存储） |
| `entitlement-service.ts` | 权益：免费次数、会员、单次解锁的判定 |
| `evaluation-service.ts` | 逐题评分：调 LLM 评分、校验 schema、落库、生成参考答案 |
| `job-jd-service.ts` | JD 的增删改查与解析 |
| `match-service.ts` | 简历 × JD 匹配分析 |
| `membership-service.ts` | 会员状态、订单列表 |
| `orchestration-service.ts` | **面试编排**：作答提交、追问深度判定、下一题、结束 |
| `parse-service.ts` | 解析通用流程：重试、降级、错误分类 |
| `payment-service.ts` | 下单、回调验签、发放权益（三层防重复） |
| `plan-service.ts` | 面试计划生成（出题）与 token 预算控制 |
| `redemption-service.ts` | 兑换码核销 |
| `report-service.ts` | 报告生成：聚合维度分、亮点/问题/建议、参考答案 |
| `resume-service.ts` | 简历的增删改查与解析 |
| `session-service.ts` | 会话 CRUD、状态查询 |
| `upload-service.ts` | 文件上传：存储写入、大小与类型校验、失败清理 |

### `state/` —— 纯函数状态机，无副作用

不碰数据库、不调网络，输入输出都是普通值，因此可以脱离环境单测。

| 文件 | 职责 |
| --- | --- |
| `orchestration.ts` | 面试编排阶段机：9 个阶段（IDLE → … → REPORTING）的合法迁移与追问深度上限 |
| `session.ts` | 会话状态机：6 个 `session_status` 取值的合法迁移 |

> 命名注意：`state/` 下**不加** `-state` 后缀（否则出现 `state/orchestration-state.ts` 这种重复）。
> 测试文件与之对齐：`tests/unit/orchestration.test.ts`、`tests/unit/session.test.ts`。

## 新增一个业务用例时

1. 在 `handlers/` 新建 `<领域>-service.ts`，从 `db/client` 取库、从其他 handler 复用归属校验
2. 需要状态判断就调用 `state/` 里的纯函数，**不要在 handler 里手写 if-else 判断状态合法性**
3. 在 `app/api/**/route.ts` 里只做「解析入参 → 调 handler → `ok()/fail()`」
4. 补 `tests/integration/<领域>.test.ts`，并把路由登记进 [../../README.md](../../README.md) 的 API 一览

## 禁止事项

- ❌ 在 `handlers/` 里直接写 prompt 或评分公式 —— 那属于 `lib/ai/`
- ❌ 在 `state/` 里引入 `db`、`fetch`、`lib/ai` —— 它会立刻失去「可离线单测」的性质
- ❌ 在路由里绕过 handler 直接操作数据库 —— 归属校验会被跳过
