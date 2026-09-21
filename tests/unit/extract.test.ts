import { describe, expect, it } from 'vitest'

import { extractDocument, MAX_TEXT_LENGTH } from '@/lib/parsing/extract'
import { buildDocx, buildPdf, buildPng, SAMPLE_RESUME_TEXT } from '../fixtures/documents'

describe('文档抽取：PDF', () => {
  it('抽取 PDF 文字层', async () => {
    const buffer = buildPdf('Hello PDF Fixture For Ai Interview Parsing')
    const result = await extractDocument({ buffer, fileName: 'resume.pdf' })

    expect(result.source).toBe('pdf')
    expect(result.text).toContain('Hello PDF Fixture')
    expect(result.pageCount).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('移除 pdf-parse 附加的页码分隔噪声', async () => {
    const buffer = buildPdf('Clean Me Please From Page Number Noise')
    const result = await extractDocument({ buffer, fileName: 'a.pdf' })

    expect(result.text).toContain('Clean Me Please')
    expect(result.text).not.toMatch(/--\s*\d+\s+of\s+\d+\s*--/)
  })

  it('文字层过少（扫描件）时报「未能识别文字」', async () => {
    const buffer = buildPdf('X')
    await expect(extractDocument({ buffer, fileName: 'scan.pdf' })).rejects.toMatchObject({
      code: 'no_text_layer',
      userMessage: '未能从文件中识别出文字，请上传更清晰的图片',
    })
  })

  it('损坏的 PDF 报「文件无法读取」', async () => {
    const buffer = Buffer.from('this is definitely not a pdf')
    await expect(extractDocument({ buffer, fileName: 'broken.pdf' })).rejects.toMatchObject({
      code: 'corrupted_file',
    })
  })

  it('空文件被拒绝', async () => {
    await expect(
      extractDocument({ buffer: Buffer.alloc(0), fileName: 'empty.pdf' }),
    ).rejects.toMatchObject({ code: 'corrupted_file' })
  })
})

describe('文档抽取：DOCX', () => {
  it('抽取 DOCX 文本', async () => {
    const buffer = buildDocx(SAMPLE_RESUME_TEXT.split('\n'))
    const result = await extractDocument({ buffer, fileName: 'resume.docx' })

    expect(result.source).toBe('docx')
    expect(result.text).toContain('TypeScript')
    expect(result.text).toContain('AI 面试平台')
  })

  it('损坏的 DOCX 报错而不是返回乱码', async () => {
    const buffer = Buffer.from('not a docx at all, just plain text')
    await expect(extractDocument({ buffer, fileName: 'broken.docx' })).rejects.toMatchObject({
      code: 'corrupted_file',
    })
  })
})

describe('文档抽取：图片', () => {
  it('图片不本地 OCR，交由视觉模型直读', async () => {
    const buffer = buildPng()
    const result = await extractDocument({
      buffer,
      fileName: 'resume.png',
      mimeType: 'image/png',
    })

    expect(result.source).toBe('image')
    expect(result.text).toBe('')
    expect(result.imageMimeType).toBe('image/png')
    expect(result.imageBase64).toBe(buffer.toString('base64'))
  })

  it('jpeg 也被识别为图片', async () => {
    const result = await extractDocument({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      fileName: 'photo.jpg',
    })
    expect(result.source).toBe('image')
  })
})

describe('文档抽取：纯文本与边界', () => {
  it('支持 txt', async () => {
    const buffer = Buffer.from(SAMPLE_RESUME_TEXT, 'utf8')
    const result = await extractDocument({ buffer, fileName: 'resume.txt' })

    expect(result.source).toBe('text')
    expect(result.text).toContain('PostgreSQL')
  })

  it('过短的文本被拒绝', async () => {
    const buffer = Buffer.from('太短了', 'utf8')
    await expect(extractDocument({ buffer, fileName: 'a.txt' })).rejects.toMatchObject({
      code: 'text_too_short',
    })
  })

  it('超长文本被截断并标记 truncated', async () => {
    const long = 'A'.repeat(MAX_TEXT_LENGTH + 5000)
    const buffer = Buffer.from(long, 'utf8')
    const result = await extractDocument({ buffer, fileName: 'long.txt' })

    expect(result.text).toHaveLength(MAX_TEXT_LENGTH)
    expect(result.truncated).toBe(true)
  })

  it('旧版 .doc 明确提示不在范围内（而非解析出乱码）', async () => {
    const buffer = Buffer.from('legacy doc bytes here, long enough to pass size check')
    await expect(extractDocument({ buffer, fileName: 'old.doc' })).rejects.toMatchObject({
      code: 'not_in_scope',
      userMessage: '该能力尚未开放，请手动填写',
    })
  })

  it('不支持的扩展名报「暂不支持该文件格式」', async () => {
    const buffer = Buffer.from('some content that is long enough to pass the basic checks')
    await expect(extractDocument({ buffer, fileName: 'a.xyz' })).rejects.toMatchObject({
      code: 'unsupported_type',
      userMessage: '暂不支持该文件格式，请上传 PDF、Word 或图片',
    })
  })

  it('超过 20MB 的文件被拒绝', async () => {
    const buffer = Buffer.alloc(20 * 1024 * 1024 + 1)
    await expect(extractDocument({ buffer, fileName: 'big.pdf' })).rejects.toMatchObject({
      code: 'corrupted_file',
    })
  })
})
