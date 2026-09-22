import { NextResponse } from 'next/server'

import { getDb } from '@/db/client'
import { jobJds, resumes } from '@/db/schema'
import { ownedByActive } from '@/lib/api/ownership'
import { buildStorageKey, createStorage, isStorageUnavailable } from '@/lib/storage'
import {
  createResume as createResumeRecord,
  updateParseState as updateResumeParseState,
} from '@/lib/services/resume-service'
import {
  createJobJd as createJobJdRecord,
  updateParseState as updateJobJdParseState,
} from '@/lib/services/job-jd-service'
import {
  createDefaultPorts,
  parseJdFile,
  parseResumeFile,
  type ParsePorts,
  type ParsedResult,
} from '@/lib/services/parse-service'
import { MAX_FILE_BYTES, extensionOf, mimeTypeOf } from '@/lib/parsing/extract'
import { RESUME_FILE_TYPES, type ResumeFileType } from '@/lib/validators/resume'

/**
 * 上传 + 解析的共用编排（② 接口层辅助）。
 *
 * 简历与 JD 的上传流程同构，差异仅在「落到哪张表」与「调哪个解析函数」，
 * 因此抽成一个函数；三条路由（简历上传 / JD 上传 / JD 文本解析）共用。
 */

export const MAX_UPLOAD_BYTES = MAX_FILE_BYTES
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'webp'] as const

/** 测试注入点：替换 LLM / 存储端口，避免真实调用 */
let portsOverride: ParsePorts | undefined

export function __setParsePortsForTest(ports: ParsePorts | undefined): void {
  portsOverride = ports
}

export function resolvePorts(): ParsePorts {
  return portsOverride ?? createDefaultPorts()
}

export type ResourceKind = 'resume' | 'job_jd'

export interface UploadOutcome {
  kind: ResourceKind
  recordId: string
  resource: unknown
  status: 'success' | 'failed'
  parseError?: string
}

export interface UploadError {
  status: number
  code: string
  message: string
}

/** 环境级失败统一走 503（依赖未配置/不可用） */
export const STORAGE_UNAVAILABLE_STATUS = 503
export const PARSE_UNAVAILABLE_STATUS = 503

export function isUploadError(value: unknown): value is UploadError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as UploadError).status === 'number' &&
    typeof (value as UploadError).code === 'string'
  )
}

export function errorResponse(error: UploadError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  )
}

function invalid(message: string): UploadError {
  return { status: 422, code: 'validation_error', message }
}

/**
 * 归一化扩展名为 DB 允许的枚举值。
 * `webp` 允许上传（视觉模型可直接读），但 `resumes.file_type` 的取值域
 * 见 docs/DATA_MODEL.md §3.2，此处映射为最接近的 jpg 以免越界。
 */
function toResumeFileType(extension: string): ResumeFileType {
  if (extension === 'webp') return 'jpg'
  return RESUME_FILE_TYPES.includes(extension as ResumeFileType)
    ? (extension as ResumeFileType)
    : 'pdf'
}

/** 读取并校验上传文件 */
export function readUploadedFile(
  form: FormData,
): { file: File; extension: string; mimeType: string } | UploadError {
  const file = form.get('file')
  if (!(file instanceof File)) return invalid('缺少上传文件')
  if (file.size === 0) return invalid('文件为空，请重新选择')

  if (file.size > MAX_UPLOAD_BYTES) {
    return invalid(`文件不能超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`)
  }

  const extension = extensionOf(file.name)
  if (!ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number])) {
    return invalid('暂不支持该文件格式，请上传 PDF、Word 或图片')
  }

  const mimeType = mimeTypeOf(file.name, file.type)
  if (!mimeType) return invalid('无法识别文件类型，请更换文件后重试')

  return { file, extension, mimeType }
}

/**
 * 上传文件到对象存储并落库 + 解析。
 *
 * 失败处理策略：
 * - 存储不可用（未配置 S3）→ 503，**不创建数据库记录**
 * - 解析环境级失败（未配置 LLM）→ 删除记录与对象，返回 503，避免脏数据
 * - 解析业务失败（格式不支持 / 无文字层 / AI 输出不合规）→ 200 + parse_status='failed'，
 *   保留可编辑内容，前端提示用户手动修改
 */
export async function uploadAndParse(
  userId: string,
  kind: ResourceKind,
  input: { file: File; extension: string; mimeType: string; isPrimary?: boolean },
): Promise<UploadOutcome | UploadError> {
  const buffer = Buffer.from(await input.file.arrayBuffer())
  const storageKey = buildStorageKey({
    kind: kind === 'resume' ? 'resumes' : 'jd-images',
    userId,
    fileId: crypto.randomUUID(),
    extension: input.extension,
  })

  /**
   * ⚠️ 存储的**构造**也必须在这个 try 里。
   *
   * 历史缺陷：`new S3Storage()` 写在 try 外面，而它在缺少 `S3_*` 时会抛错，
   * 于是专门为它准备的 `storage_unavailable → 503` 分支永远不会执行，
   * 异常一路冒泡被兜底成 **500「服务器内部错误」**——
   * 用户看到的是「解析简历服务器错误」，而真实原因只是没配对象存储。
   */
  let storage
  try {
    storage = createStorage()
    await storage.putObject({ key: storageKey, body: buffer, contentType: input.mimeType })
  } catch (error) {
    console.error('[parse] 上传对象存储失败', error)
    return {
      status: STORAGE_UNAVAILABLE_STATUS,
      code: 'storage_unavailable',
      message: isStorageUnavailable(error)
        ? '文件存储未配置或不可用。本地开发可设置 STORAGE_DRIVER=local 使用本地文件系统，' +
          '或在 .env.local 中配置 S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET。'
        : '文件存储暂时不可用，请稍后重试',
    }
  }

  const ports = resolvePorts()

  if (kind === 'resume') {
    const record = await createResumeRecord(userId, {
      fileName: input.file.name.slice(0, 255),
      fileType: toResumeFileType(input.extension),
      fileSize: input.file.size,
      storageKey,
      isPrimary: input.isPrimary ?? false,
    })

    const parsed = await parseResumeFile(ports, {
      storageKey,
      fileName: input.file.name,
      mimeType: input.mimeType,
    })

    return finish(userId, 'resume', record.id, storageKey, parsed)
  }

  // JD 图片：先占位，解析成功后由 title 等字段覆盖
  const record = await createJobJdRecord(userId, {
    rawText: `（图片待解析：${input.file.name}）`,
  })

  const parsed = await parseJdFile(ports, {
    storageKey,
    fileName: input.file.name,
    mimeType: input.mimeType,
  })

  return finish(userId, 'job_jd', record.id, storageKey, parsed)
}

/** 解析完成后的落库与清理 */
async function finish(
  userId: string,
  kind: ResourceKind,
  recordId: string,
  storageKey: string,
  parsed: ParsedResult<unknown>,
): Promise<UploadOutcome | UploadError> {
  /**
   * 环境未就绪（LLM 未配置 / 能力未开放）：
   *
   * **保留记录并标记为解析失败**，而不是删除它。理由：
   * 1. 该错误的用户文案本身就是「解析服务暂时不可用，请稍后重试**或手动填写**」
   *    （lib/parsing/errors.ts），删掉记录等于让用户无从下手，自相矛盾；
   * 2. 产品硬要求（AGENTS.md §2 第 4 步）是「展示解析结果、允许用户修改」——
   *    解析失败时更应保留可编辑的原文；
   * 3. 文件已经在存储里，删除它只是白费一次上传，用户还得重新传一遍。
   *
   * 唯一仍然拒绝的情形是**存储本身不可用**（那是上传阶段，已在
   * uploadAndParse 中返回 503）。
   */
  if (!parsed.ok && parsed.code === 'not_in_scope') {
    const db = getDb()
    if (kind === 'resume') {
      await db.delete(resumes).where(ownedByActive(resumes, recordId, userId))
    } else {
      await db.delete(jobJds).where(ownedByActive(jobJds, recordId, userId))
    }
    // 存储里的对象一并清理，避免留下无法被任何记录引用的孤儿文件
    await createStorage()
      .deleteObject(storageKey)
      .catch(() => undefined)

    return { status: 503, code: 'parse_unavailable', message: parsed.error.userMessage }
  }

  if (parsed.ok) {
    const meta = { ...parsed.meta, model: parsed.model, dropped: parsed.dropped }
    const resource =
      kind === 'resume'
        ? await updateResumeParseState(userId, recordId, {
            parseStatus: 'success',
            parsedData: parsed.data,
            parseError: null,
            extractionMeta: meta,
          })
        : await updateJobJdParseState(userId, recordId, {
            parseStatus: 'success',
            parsedData: parsed.data,
            parseError: null,
            extractionMeta: meta,
          })

    return { kind, recordId, resource, status: 'success' }
  }

  const meta = { ...parsed.meta, dropped: parsed.dropped }
  const resource =
    kind === 'resume'
      ? await updateResumeParseState(userId, recordId, {
          parseStatus: 'failed',
          parsedData: null,
          parseError: parsed.error.userMessage,
          extractionMeta: meta,
        })
      : await updateJobJdParseState(userId, recordId, {
          parseStatus: 'failed',
          parsedData: null,
          parseError: parsed.error.userMessage,
          extractionMeta: meta,
        })

  return {
    kind,
    recordId,
    resource,
    status: 'failed',
    parseError: parsed.error.userMessage,
  }
}
