import { StorageUnavailableError } from './errors'
import { LocalFileStorage } from './local'
import { S3Storage, type StoragePort } from './s3'

/**
 * 存储端口工厂 —— 业务代码**只**通过这里拿实现，不要直接 `new S3Storage()`。
 *
 * 选择规则：
 * - 配了 `S3_*` → S3（生产与预发布应走这条）
 * - `STORAGE_DRIVER=local` → 本地文件系统（显式指定）
 * - **生产环境**且未配 `S3_*` → 抛 `StorageUnavailableError`
 *   （**绝不静默回退本地**：Serverless 文件系统只读且临时，
 *   静默回退会造成「上传成功但文件随即消失」这种更难排查的问题）
 * - 其它（本地开发）→ 回退本地文件系统，使上传链路开箱可用
 */

export * from './s3'
export { StorageUnavailableError, isStorageUnavailable } from './errors'
export { LocalFileStorage } from './local'

export function hasS3Config(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY &&
      process.env.S3_SECRET_KEY &&
      process.env.S3_BUCKET,
  )
}

export interface StorageSelection {
  storage: StoragePort
  driver: 's3' | 'local'
  /** 回退到本地时的说明，便于日志与界面提示 */
  note?: string
}

export function createStorage(): StoragePort {
  return selectStorage().storage
}

export function selectStorage(): StorageSelection {
  const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase()

  if (driver === 'local') {
    return { storage: new LocalFileStorage(), driver: 'local', note: 'STORAGE_DRIVER=local' }
  }

  if (hasS3Config()) {
    return { storage: new S3Storage(), driver: 's3' }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new StorageUnavailableError(
      '[storage] 生产环境必须配置 S3 兼容存储（S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET）。' +
        '本地文件系统在 Serverless 上不可持久化，因此不会自动回退。详见 .env.example。',
    )
  }

  return {
    storage: new LocalFileStorage(),
    driver: 'local',
    note: '未配置 S3_*，开发环境回退本地文件系统（.local-storage/）',
  }
}
