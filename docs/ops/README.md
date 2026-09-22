# docs/ops —— 运维侧文档

| 文件 | 作用 |
| --- | --- |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 部署全流程。架构与前置条件、创建数据库（Neon / Supabase）、创建对象存储（R2 / S3 / MinIO）、生成密钥、部署到 Vercel、执行迁移、首次管理员提权、验收清单、回滚 |

## 上线前必须确认的三件事

1. **环境变量齐了**：清单见 [../engineering/ARCHITECTURE.md](../engineering/ARCHITECTURE.md) §5，
   模板见 [../../.env.example](../../.env.example)。生产环境**未配 S3 会直接 503**，不会静默落本地磁盘。
2. **迁移已执行**：`pnpm db:migrate` 指向生产 `DATABASE_URL`，见 [DEPLOYMENT.md](./DEPLOYMENT.md) §4。
3. **鉴权与支付密钥已轮换**：`AUTH_SECRET`、`PAYMENT_WEBHOOK_SECRET` 必须是生产专用值，
   **不得复用本地开发值**。更换 `AUTH_SECRET` 会使所有已登录会话立即失效，属预期行为。

## 安全红线

- 真实密钥**只进平台的环境变量面板**，不写进任何被 git 跟踪的文件。
  仓库侧有 `scripts/check-secrets.mjs` 与 `scripts/audit-public.mjs` 两道自动检查，已接入 `pnpm verify` 与 CI。
- 公开仓库前跑一次 `pnpm audit:public`，确认没有隐私数据或个人样本被推上去。
