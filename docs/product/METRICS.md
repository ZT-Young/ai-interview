# 指标与埋点设计（V1）

> 本文档定义**埋点事件契约**与**指标口径**，是 [PRD.md §6](./PRD.md) 的可执行实现说明。
> ⚠️ **当前没有任何真实数据**：埋点尚未实现、产品尚未上线。
> 本文所有 SQL 都是**口径定义**，可执行但结果为空 —— 任何数字必须等内测后填入。

---

## 1. 埋点原则

| 原则 | 说明 |
|---|---|
| **PII 最小化** | 事件只记**行为与元数据**，绝不记简历原文、作答内容、邮箱、令牌（沿用 `lib/observability/logger.ts` 的脱敏约定） |
| **服务端权威** | 关键事件（尤其 `payment_succeeded`）**只在服务端记录**，不接受前端上报 —— 否则付费率可被伪造 |
| **可回溯** | 事件带 `user_id` 与 `session_id`，可与业务表 JOIN，验证漏斗顺序 |
| **只增不改** | 事件不可更新或删除（与审计日志同策略） |
| **合规告知** | 新增此类行为数据采集属于隐私政策范围变更，**必须更新 `/legal/privacy` 并重新征得同意**（AGENTS.md §7 C1） |

---

## 2. 事件定义

### 2.1 事件表结构（待实现）

```
analytics_events
├─ id            uuid    PK
├─ user_id       uuid    FK → users（软删除用户的记录保留，用于统计口径一致）
├─ session_id    uuid    可空，关联 interview_sessions
├─ event_name    varchar(40)  见 §2.2
├─ occurred_at   timestamptz  服务端时间（**不用前端时间**，防篡改）
├─ properties    jsonb   事件属性（见 §2.2，禁止放 PII）
└─ created_at    timestamptz

索引：(event_name, occurred_at)、(user_id, occurred_at)、(session_id)
```

### 2.2 五个事件

| 事件 | 触发点 | 记录方 | 必填属性 | 用途 |
|---|---|---|---|---|
| `interview_started` | `POST /api/sessions/:id/start` 成功后 | 服务端 | `question_count`、`is_member`、`resume_id` 是否存在、`job_jd_id` 是否存在 | 漏斗分母 |
| `interview_completed` | 会话 `status → completed` 时（自然结束或用户主动结束都算） | 服务端 | `total_main_questions`、`answered`、`skipped`、`follow_up_count`、`duration_sec`、`ended_by`(`natural`/`user`) | 完面率分子 |
| `report_viewed` | 报告页服务端渲染成功时 | 服务端 | `report_id`、`is_unlocked`、`total_score_bucket`（分段而非精确分，见下） | 报告打开率分子 |
| `pay_checkout_clicked` | 点击购买按钮或兑换提交 | 前端上报 + 服务端校验 | `product_id`、`source_page`（`report`/`membership`/`orders`） | 付费意愿 |
| `payment_succeeded` | **权益发放成功后**（`grantEntitlement` 返回 `granted: true`） | **仅服务端** | `product_id`、`amount_cents`、`unlock_type`、`provider`、`report_id` | 付费率分子、营收 |

**属性设计说明**：

- `total_score_bucket` 用分段（`0-59` / `60-74` / `75-89` / `90-100`）而不是精确分数，
  避免事件表成为「用户能力画像」而带来额外的隐私面
- `ended_by` 区分自然结束与主动结束，用于判断「用户是不是被题目耗尽而结束」
- `pay_checkout_clicked` 是**唯一前端上报事件**，因为「点击」只发生在浏览器；
  但它只用于分析意愿，**不作为任何权益依据**（权益只看 `payment_succeeded`）

---

## 3. 指标口径与 SQL

> 所有查询假设 `analytics_events` 已按 §2.1 建立。执行前请先确认表存在。

### 3.1 完面率

**口径**：`有 interview_started 的会话` 中，`也有 interview_completed` 的比例。
**按会话统计，不按用户** —— 同一用户开两场、只完一场，应如实反映为 50%。

```sql
-- 完面率（含样本量）
WITH started AS (
  SELECT DISTINCT session_id
  FROM analytics_events
  WHERE event_name = 'interview_started'
    AND session_id IS NOT NULL
    AND occurred_at >= $1 AND occurred_at < $2
),
completed AS (
  SELECT DISTINCT session_id
  FROM analytics_events
  WHERE event_name = 'interview_completed'
    AND occurred_at >= $1 AND occurred_at < $2
)
SELECT
  (SELECT count(*) FROM started)                                   AS started_sessions,
  (SELECT count(*) FROM completed)                                 AS completed_sessions,
  CASE WHEN (SELECT count(*) FROM started) = 0 THEN NULL
       ELSE round(
         (SELECT count(*) FROM completed)::numeric
         / (SELECT count(*) FROM started) * 100, 1)
  END                                                              AS completion_rate_pct;
```

**注意事项**：
- 分子分母都限定在**同一统计窗口**内；跨窗口的「昨天开始、今天完成」会导致比率 > 100%，
  因此生产环境应改为**按会话聚合**（会话的 started 时间归属窗口）而非按事件时间
- **样本 < 30 时不要解读比率**（见 §5）

### 3.2 报告打开率

**口径**：`已生成报告` 中，`被打开过至少一次` 的比例。按报告统计。

```sql
WITH generated AS (
  SELECT id AS report_id, session_id, created_at
  FROM reports
  WHERE created_at >= $1 AND created_at < $2
),
viewed AS (
  SELECT DISTINCT (properties->>'report_id')::uuid AS report_id
  FROM analytics_events
  WHERE event_name = 'report_viewed'
)
SELECT
  (SELECT count(*) FROM generated)                                         AS reports_generated,
  (SELECT count(*) FROM generated g
     WHERE EXISTS (SELECT 1 FROM viewed v WHERE v.report_id = g.report_id)) AS reports_viewed,
  CASE WHEN (SELECT count(*) FROM generated) = 0 THEN NULL
       ELSE round(
         (SELECT count(*) FROM generated g
            WHERE EXISTS (SELECT 1 FROM viewed v WHERE v.report_id = g.report_id))::numeric
         / (SELECT count(*) FROM generated) * 100, 1)
  END                                                                      AS open_rate_pct;
```

**为什么分母用 `reports` 表而不是事件**：报告可能因解析失败等原因未生成，
用业务表作分母能反映「真实产出」的打开情况。

**补充观察**：区分解锁与未解锁报告的打开率 —— 若简版报告的打开率显著低于解锁报告，
说明简版价值感不足（对应 PRD 假设 H3）。

```sql
SELECT
  (properties->>'is_unlocked')::boolean AS is_unlocked,
  count(DISTINCT session_id)            AS views,
  count(DISTINCT user_id)               AS users
FROM analytics_events
WHERE event_name = 'report_viewed'
GROUP BY 1;
```

### 3.3 付费率

**口径**：`有 report_viewed 的用户` 中，`有 payment_succeeded` 的比例。**按用户统计**。

```sql
WITH viewers AS (
  SELECT DISTINCT user_id
  FROM analytics_events
  WHERE event_name = 'report_viewed'
    AND occurred_at >= $1 AND occurred_at < $2
),
payers AS (
  SELECT DISTINCT user_id
  FROM analytics_events
  WHERE event_name = 'payment_succeeded'
    AND occurred_at >= $1 AND occurred_at < $2
)
SELECT
  (SELECT count(*) FROM viewers)                                     AS report_viewers,
  (SELECT count(*) FROM payers)                                      AS paying_users,
  (SELECT count(*) FROM viewers v
     JOIN payers p ON p.user_id = v.user_id)                         AS converted_users,
  CASE WHEN (SELECT count(*) FROM viewers) = 0 THEN NULL
       ELSE round(
         (SELECT count(*) FROM viewers v JOIN payers p ON p.user_id = v.user_id)::numeric
         / (SELECT count(*) FROM viewers) * 100, 1)
  END                                                                AS payment_rate_pct;
```

**当前预期结果为 0**：支付渠道未接入（仅兑换码），**没有真实支付行为**。
这不是数据问题，而是产品缺口 —— 它直接决定下一版优先级（见 ITERATION_PLAN.md）。

### 3.4 付费意愿（点击到成单）

付费率只看成单会掩盖「点了但不买」的原因，因此同时看点击：

```sql
SELECT
  count(DISTINCT CASE WHEN event_name = 'pay_checkout_clicked' THEN user_id END) AS clicked_users,
  count(DISTINCT CASE WHEN event_name = 'payment_succeeded'    THEN user_id END) AS paid_users,
  count(*) FILTER (WHERE event_name = 'pay_checkout_clicked')                    AS clicks,
  count(*) FILTER (WHERE event_name = 'payment_succeeded')                       AS payments
FROM analytics_events
WHERE occurred_at >= $1 AND occurred_at < $2;
```

**点击高但成单低** → 定价或支付流程问题；**点击就低** → 价值感知问题（回到报告本身）。

### 3.5 常见异议指标（辅助定位）

```sql
-- 面试中断分布：用户在哪一步停下
SELECT
  s.phase,
  count(*) AS sessions
FROM interview_sessions s
WHERE s.created_at >= $1 AND s.created_at < $2
  AND s.status <> 'completed'
GROUP BY 1
ORDER BY 2 DESC;

-- AI 失败率（按操作）
SELECT
  operation,
  count(*)                                            AS calls,
  count(*) FILTER (WHERE status = 'error')            AS errors,
  round(count(*) FILTER (WHERE status = 'error')::numeric
        / greatest(count(*), 1) * 100, 1)             AS error_rate_pct
FROM ai_call_logs
WHERE created_at >= $1 AND created_at < $2
GROUP BY 1
ORDER BY 4 DESC NULLS LAST;
```

---

## 4. 隐私与合规（实现前必须完成）

| 要求 | 动作 |
|---|---|
| AGENTS.md §7 C1 知情同意 | 采集行为数据属于**处理目的变更** → 更新 `lib/legal/documents.ts` 的隐私政策**并提升版本号**，重登时重新征得同意 |
| §7 C3 数据安全与删除 | 用户删除账号时，`analytics_events` 按 `user_id` 匿名化（置 null）或一并删除；**保留聚合值**不保留个人轨迹 |
| §7 C6 审计日志 | 埋点**不等于**审计日志：审计记录「谁做了什么敏感操作」，事件记录「产品行为」；两者不可互相替代 |
| PII 最小化 | `properties` 禁止放简历原文、作答、邮箱、令牌；上报前经 `redactFields()` |
| 前端上报校验 | `pay_checkout_clicked` 由前端上报，服务端必须校验 `user_id` 来自会话而非请求体 |

---

## 5. 样本量与解读纪律

**这是本文件最重要的一节。**

| 样本量 | 允许的解读 |
|---|---|
| < 30 | **只报原始计数**，禁止报比率。百分比在小样本上波动极大，会误导决策 |
| 30–100 | 可报比率，但必须同时给出绝对值（如「62.5%（5/8）」） |
| > 100 | 可报比率与变化趋势 |

**禁止的做法**：
- 用个位数样本算「完面率 66.7%」并据此决定产品方向
- 只报百分比不报分母
- 把相关性当因果（例如「用了语音的人完面率更高」可能只是因为他们更投入）

**建议**：每个指标在看板上固定展示 `分子/分母` 与窗口起止时间。

---

## 6. 实现清单（本轮不改代码，确认后执行）

| # | 待实现 | 落点 |
|---|---|---|
| 1 | `analytics_events` 表 + 迁移 | `db/schema/analytics-events.ts`、`db/migrations/0007_*` |
| 2 | 事件写入与脱敏 | `lib/analytics/{events,track}.ts`（复用 `redactFields`） |
| 3 | 服务端触发点接入 | `start` / `finish` 路由、报告页、`grantEntitlement` |
| 4 | 前端上报接口（仅 `pay_checkout_clicked`） | `POST /api/analytics/events` |
| 5 | 指标查询与看板 | `app/api/admin/metrics`、`app/admin/metrics` |
| 6 | 隐私政策更新 + 版本号提升 | `lib/legal/documents.ts`（`LEGAL_VERSION` → v2） |
| 7 | 测试 | 事件脱敏断言、`payment_succeeded` 仅服务端可写、删号后匿名化 |
