# lib/config —— 配置读取与校验

| 文件 | 导出 | 作用 |
| --- | --- | --- |
| [`env.ts`](./env.ts) | `readEnvGroup` 等 | 集中读取并校验环境变量，缺失/非法时给出**可操作的**报错信息 |

## 为什么单独建目录

环境变量是**部署期最容易出错**的一环，出错现场往往离真正原因很远（比如「上传 500」的根因是
`S3_BUCKET` 拼错）。把读取逻辑收敛到一个文件的价值：

1. **只有这里允许读 `process.env`**（Next.js 自身要求的少数例外除外），
   想知道某个变量在哪被用，只看这一个文件就够
2. 校验失败时报出**变量名 + 期望格式 + 怎么修**，而不是让错误在几十层调用之后以
   `undefined is not a function` 的形式爆出来
3. 单测能覆盖「缺变量时报什么错」，见 `tests/unit/env.test.ts`

## 变量清单与说明

完整清单、每个变量的用途、必填时机，见：

- 模板与注释：[`../../.env.example`](../../.env.example)（含「为什么要小心」的踩坑说明）
- 说明文档：[`../../docs/engineering/ARCHITECTURE.md`](../../docs/engineering/ARCHITECTURE.md) §5

## 注意

- 真实值只写进 `.env.local`（已被 gitignore），**永不入库**
- 生产环境**必须**配齐 S3 相关变量，否则上传接口返回 503 而不是静默落本地磁盘
- 依赖「未配置就降级」的变量（如 `ADMIN_VIEW_RESUME_CONTENT`）必须严格匹配字符串 `"true"`，
  不接受 `1` / `TRUE`
