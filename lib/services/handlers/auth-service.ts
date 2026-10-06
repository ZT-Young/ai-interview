/**
 * 认证领域服务 —— ③ 领域服务层（门面）。
 *
 * 本文件只做**公开 API 汇总与 re-export**，不放置实现逻辑。实现按职责拆分到：
 * - ./auth/types.ts：纯类型与无副作用辅助（PublicUser / 规范化 / 用户名 / IP 解析）
 * - ./auth/register.ts：注册（邮箱 / 手机号双通道）
 * - ./auth/login.ts：登录 / 管理端登录 / 退出
 * - ./auth/profile.ts：读取 / 更新资料 / 软删账号
 *
 * 不依赖 next/headers 与 NextResponse：只接受纯参数、返回纯数据。
 * Cookie 读写与状态码由 ② 接口层负责，因此本层可在 Vitest 中直接调用。
 *
 * 历史说明：本模块曾因「认证逻辑集中、避免密码/验证码两处走偏」而保持单文件；
 * 随体量增长（注册/登录/资料三领域高度内聚但互不相关）拆分为上述子模块，
 * 对外导出集合保持不变，路由层无需改动。
 */

export * from './auth/types'
export * from './auth/register'
export * from './auth/login'
export * from './auth/profile'
