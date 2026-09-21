import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import {
  StorageObjectNotFoundError,
  StorageUnavailableError,
} from './errors'
import type { PutObjectInput, StoragePort } from './s3'

/**
 * 本地文件系统存储 —— **仅供本地开发**，让上传链路在没有任何外部服务时也能跑通。
 *
 * 为什么需要它：本项目所有上传都经过 `StoragePort`。没有 S3 时
 * `S3Storage` 构造即抛错，导致「解析简历」这类核心流程在本地**完全无法验证**，
 * 而开发者只想跑通流程时并不该被迫先去注册一个对象存储账号。
 *
 * 启用条件（见 lib/storage/index.ts）：
 * - `STORAGE_DRIVER=local` 显式启用，或
 * - 非生产环境且未配置 `S3_*`（默认回退，便于开箱即用）
 *
 * ⚠️ **不可用于生产**：
 * - 无副本、无备份；Vercel 等 Serverless 的文件系统是**只读且临时**的，
 *   因此生产环境**强制**要求 `S3_*`（见 createStorage()），不会静默回退到这里。
 * - 数据目录默认 `.local-storage/`（已在 .gitignore 中忽略）。
 */

const DEFAULT_ROOT = process.env.LOCAL_STORAGE_DIR ?? '.local-storage'

export class LocalFileStorage implements StoragePort {
  private readonly root: string

  constructor(root: string = DEFAULT_ROOT) {
    this.root = resolve(root)
  }

  /**
   * 把存储 key 解析为绝对路径，并确保仍在根目录内。
   *
   * key 由服务端 `buildStorageKey()` 生成（不含用户文件名），理论上安全；
   * 这里仍然做一次越界校验，避免任何上游拼装失误导致写到仓库之外。
   */
  private resolveKey(key: string): string {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '')
    if (normalized.length === 0) {
      throw new StorageUnavailableError('[storage] 存储 key 不能为空')
    }

    const full = resolve(join(this.root, normalized))
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new StorageUnavailableError(`[storage] 非法的存储 key（越出根目录）：${key}`)
    }
    return full
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const full = this.resolveKey(input.key)
    try {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, input.body)
    } catch (error) {
      throw new StorageUnavailableError(
        `[storage] 写入本地存储失败（${input.key}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  async getObject(key: string): Promise<Buffer> {
    const full = this.resolveKey(key)
    try {
      return await readFile(full)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageObjectNotFoundError(key)
      }
      throw new StorageUnavailableError(
        `[storage] 读取本地存储失败（${key}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  async deleteObject(key: string): Promise<void> {
    const full = this.resolveKey(key)
    // 删除不存在的对象视为成功（与 S3 语义一致，调用方依赖这一点做清理）
    await rm(full, { force: true })
  }
}
