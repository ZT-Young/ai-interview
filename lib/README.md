# lib —— 业务能力层

这里是全项目的逻辑重心。`app/` 只负责路由与渲染，真正的规则全部住在 `lib/`。

## 一层一张表

| 目录 | 放什么 | 可以依赖 | 禁止依赖 |
| --- | --- | --- | --- |
| `ai/` | **复杂 AI 逻辑**：prompt、JSON Schema、评分公式、LLM 客户端 | 无（最底层） | 任何业务层 |
| `parsing/` | 简历/JD 解析链路：文本抽取、LLM 调用与重试、输出校验、禁止项检测 | `ai/` | 数据库、HTTP |
| `storage/` | 对象存储：S3 与本地文件系统两种实现，统一 `StoragePort` | — | 业务层 |
| `payments/` | 支付：商品定义、渠道 provider、兑换码算法 | — | 业务层 |
| `auth/` | 密码哈希（scrypt）、会话令牌签发与校验 | `db/` | 路由 |
| `services/` | **业务用例**（详见该目录 README）：编排数据库 + 上面各项能力 | 以上全部 + `db/` | React |
| `api/` | 路由层支撑：守卫、错误响应、归属校验、统一 envelope | `services/`、`auth/` | React |
| `http/` | **浏览器端**的 fetch 封装（`api-client.ts`），只在客户端组件里用 | 无 | `db/`、`services/` |
| `config/` | 环境变量读取与校验（`env.ts`） | 无 | 其他 `lib/` |
| `utils/` | 无业务语义的小工具（`cn` 等） | 无 | 其他 `lib/` |
| `observability/` | 结构化日志、错误上报、限流 | — | 业务层 |
| `constants/` | 常量：题目类型上限、业务阈值 | 无 | 其他 `lib/` |
| `validators/` | 请求体 Zod 校验（与 `ai/schemas/` 的区别见下） | — | 数据库 |
| `legal/` | 隐私政策与用户协议正文 | 无 | 其他 `lib/` |
| `asr/` | 语音转文字端口（供应商待选型，当前为「未配置」实现） | — | 业务层 |

## 两个容易混淆的点

**`validators/` vs `ai/schemas/`** —— 都叫校验，但方向相反：

- `validators/` 校验**用户发来的请求体**，失败返回 422 给用户
- `ai/schemas/` 校验**模型返回的内容**，失败要重试或降级，用户看不到

**`services/` vs `api/`** —— 都靠近路由，但职责分开：

- `services/` 管业务规则（能不能做、做了会怎样）
- `api/` 管 HTTP 形式（登录了吗、这资源是你的吗、错误怎么序列化）

## 为什么 `http/` `config/` `utils/` 单独建目录

它们原本平铺在 `lib/` 根下，混在 12 个功能目录之间，从路径看不出归属。现在：

- 看到 `@/lib/http/api-client` 就知道这是**客户端**发请求用的
- 看到 `@/lib/config/env` 就知道环境变量只在这里读，其他地方不许直接摸 `process.env`
- 看到 `@/lib/utils/index` 就知道这是无业务语义的工具集合

## 外部依赖一律走「端口注入」

`LlmPort` / `StoragePort` / `AsrPort` / `RateLimitStore` 都是接口，真实实现与测试假实现并存
（假实现在 `tests/helpers/fakes.ts`）。这样集成测试不需要联网、不需要真实 API key。

**新增外部依赖时必须先定义端口**，不要在业务代码里直接 `new` 一个 SDK 客户端。
