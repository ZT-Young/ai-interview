/**
 * 存储层错误类型。
 *
 * 为什么要类型化：早期 `readS3Env()` 抛的是裸 `Error`，调用方只能靠字符串匹配判断，
 * 结果是「未配置 S3」这种**环境级**失败被兜底成 **500 服务器内部错误**
 * （见 lib/services/upload-service.ts 的历史缺陷）。
 * 有了带 `code` 的错误，调用方可以稳定地映射为 503 并给出可操作提示。
 */

export class StorageUnavailableError extends Error {
  readonly code = 'storage_unavailable'

  constructor(message: string) {
    super(message)
    this.name = 'StorageUnavailableError'
  }
}

export class StorageObjectNotFoundError extends Error {
  readonly code = 'storage_object_not_found'

  constructor(key: string) {
    super(`[storage] 对象不存在：${key}`)
    this.name = 'StorageObjectNotFoundError'
  }
}

/**
 * 判断是否为「存储未配置/不可用」。
 *
 * 鸭子类型判定（而不是 `instanceof`）：Next.js 的 server bundle 与测试环境
 * 可能加载到不同的模块实例，`instanceof` 会失效；这类跨实例判定在本仓库
 * 已有先例（见 lib/api/errors.ts 的 `isDatabaseUnavailable`）。
 */
export function isStorageUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown }

  if (candidate.name === 'StorageUnavailableError') return true
  if (candidate.code === 'storage_unavailable') return true
  if (typeof candidate.message === 'string') {
    // 兼容历史文案与 AWS SDK 在凭据缺失时抛出的错误
    return (
      candidate.message.includes('缺少环境变量：S3_') ||
      candidate.message.includes('缺少环境变量: S3_') ||
      candidate.message.includes('Resolved credential object is not valid') ||
      candidate.message.includes('CredentialsProviderError') ||
      candidate.message.includes('InvalidAccessKeyId') ||
      candidate.message.includes('SignatureDoesNotMatch') ||
      candidate.message.includes('NetworkingError') ||
      candidate.message.includes('ECONNREFUSED') ||
      candidate.message.includes('ENOTFOUND')
    )
  }
  return false
}
