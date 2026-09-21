import type { S3Client } from '@aws-sdk/client-s3'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client as S3,
} from '@aws-sdk/client-s3'

import { StorageUnavailableError } from './errors'

/**
 * 对象存储端口 —— 简历原件存储。
 *
 * 供应商（Cloudflare R2 / AWS S3 / MinIO）由环境变量切换，
 * 调用方只依赖本接口，替换供应商不改业务代码（docs/ARCHITECTURE.md §7）。
 */

export interface PutObjectInput {
  key: string
  body: Buffer
  contentType: string
}

export interface StoragePort {
  putObject(input: PutObjectInput): Promise<void>
  getObject(key: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>
}

/** 由文件名与用户 ID 生成服务端存储 key，**不直接使用用户提供的文件名**（防路径穿越） */
export function buildStorageKey(input: {
  kind: 'resumes' | 'jd-images' | 'audio'
  userId: string
  fileId: string
  extension: string
}): string {
  const extension = input.extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  return `${input.kind}/${input.userId}/${input.fileId}.${extension}`
}

interface S3Env {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  region: string
}

function readS3Env(): S3Env {
  const endpoint = process.env.S3_ENDPOINT
  const accessKeyId = process.env.S3_ACCESS_KEY
  const secretAccessKey = process.env.S3_SECRET_KEY
  const bucket = process.env.S3_BUCKET
  const region = process.env.S3_REGION ?? 'auto'

  const missing: string[] = []
  if (!endpoint) missing.push('S3_ENDPOINT')
  if (!accessKeyId) missing.push('S3_ACCESS_KEY')
  if (!secretAccessKey) missing.push('S3_SECRET_KEY')
  if (!bucket) missing.push('S3_BUCKET')

  if (missing.length > 0) {
    // 必须抛类型化错误：裸 Error 会被上层兜底成 500「服务器内部错误」，
    // 而这是**环境级**失败，应映射为 503 并给出可操作提示。
    throw new StorageUnavailableError(
      `[storage] 缺少环境变量：${missing.join(', ')}。请参考 .env.example 配置 S3 兼容存储，` +
        '或在本地开发时使用本地文件系统（STORAGE_DRIVER=local）。',
    )
  }

  return {
    endpoint: endpoint!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    region,
  }
}

export class S3Storage implements StoragePort {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(env?: S3Env) {
    const config = env ?? readS3Env()
    this.bucket = config.bucket
    this.client = new S3({
      endpoint: config.endpoint,
      region: config.region,
      // R2 / MinIO 需要 path-style 寻址
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    )
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )
    const body = result.Body
    if (!body) throw new Error(`[storage] 对象为空：${key}`)

    const bytes = await body.transformToByteArray()
    return Buffer.from(bytes)
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
