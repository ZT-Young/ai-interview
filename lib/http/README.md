# lib/http —— 浏览器端 HTTP 封装

**只在客户端组件（`'use client'`）里使用。** 服务端代码不要引这里——服务端直接调
`lib/services/`，不需要绕 HTTP 一圈。

| 文件 | 导出 | 作用 |
| --- | --- | --- |
| [`api-client.ts`](./api-client.ts) | `api`、`ApiClientError` | 统一 fetch 封装：拼路径、带 Cookie、解析后端 envelope、把错误码转成可读中文并抛出 `ApiClientError` |

## 为什么要这一层

后端所有接口返回统一信封 `{ schema_version, data }`，错误返回 `{ error: { code, message } }`。
如果每个组件各自 `fetch` + `res.json()`，就得到处重复判断 HTTP 状态码、解析错误体、处理
「网络断了」与「后端返回 4xx」这两种不同失败。

`api-client.ts` 把这件事收敛成一处，组件里只需：

```ts
import { api, ApiClientError } from '@/lib/http/api-client'

try {
  const data = await api.post(`/api/sessions/${id}/answers`, { text })
} catch (err) {
  // err 已经是带中文 message 的 ApiClientError，可直接展示
  setError(err instanceof ApiClientError ? err.message : '网络异常，请重试')
}
```

## 与 `lib/api/` 的区别（别弄混）

| | `lib/http/` | `lib/api/` |
| --- | --- | --- |
| 运行位置 | 浏览器 | 服务器（Route Handler 内） |
| 方向 | **发出**请求 | **处理**请求 |
| 内容 | fetch 封装 | 守卫、错误响应、归属校验、envelope 构造 |

一句话：`lib/http/api-client.ts` 是**客户端**，`lib/api/` 是**服务端**。
