import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef, FileRecognizer } from '@deepseek-ai/dsh-attachment'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as officeRecognizer from '../src/index.ts'
import { apply, inject, name } from '../src/index.ts'

afterEach(() => { vi.restoreAllMocks() })

class MemorySettings extends SettingsProvider {
  private storedSettings: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storedSettings))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedSettings = { ...this.storedSettings, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function registered(config: Parameters<typeof apply>[1] = {}, apiKey?: string): FileRecognizer {
  const registerFileRecognizer = vi.fn<(recognizer: FileRecognizer) => () => void>(() => () => {})
  const ctx = {
    attachments: { registerFileRecognizer },
    effect: (install: () => () => void) => install(),
    inject: () => {},
    get: (service: string) => service === 'credentials' && apiKey !== undefined
      ? { resolve: () => Promise.resolve({ value: apiKey, source: 'test' }) }
      : undefined,
  } as unknown as Context
  apply(ctx, config)
  const recognizer = registerFileRecognizer.mock.calls[0]?.[0]
  if (recognizer === undefined) throw new Error('recognizer was not registered')
  return recognizer
}

function ref(name: string, mediaType = 'application/octet-stream'): FileAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    mediaType,
    bytes: 1,
    name,
  }
}

function docx(text: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  })
}

describe('file-recognizer-office', () => {
  it('uses Loader-safe function exports and unregisters with its Cordis fiber', async () => {
    const ctx = new Context()
    const recognizers = new Set<FileRecognizer>()
    ctx.provide('attachments', {
      registerFileRecognizer: (recognizer: FileRecognizer) => {
        recognizers.add(recognizer)
        return () => { recognizers.delete(recognizer) }
      },
    } as never)
    const fiber = ctx.plugin({ name, inject: [...inject], apply }, {})
    await fiber.await()
    expect('default' in officeRecognizer).toBe(false)
    expect(recognizers.size).toBe(1)
    await fiber.dispose()
    expect(recognizers.size).toBe(0)
  })

  it('registers a live settings namespace and rejects unusable endpoint pairs', async () => {
    const ctx = new Context()
    ctx.provide('attachments', { registerFileRecognizer: () => () => {} } as never)
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin({ name, inject: [...inject], apply }, {}).await()

    await expect(ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      ocr: { endpoint: 'file:///tmp/ocr', model: 'ocr-model' },
    })).rejects.toThrow(/HTTP or HTTPS/)
    await expect(ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      audioTranscription: { endpoint: 'https://audio.test/v1/audio/transcriptions' },
    })).rejects.toThrow(/requires both endpoint and model/)
    await ctx.settings.update(officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE, {
      videoUnderstanding: {
        endpoint: 'https://video.test/v1/chat/completions',
        model: 'video-model',
      },
    })
    expect(ctx.settings.describe().find(row => row.ns === officeRecognizer.FILE_RECOGNIZER_SETTINGS_NAMESPACE)?.value)
      .toMatchObject({ videoUnderstanding: { model: 'video-model' } })
    await ctx.fiber.dispose()
  })

  it('recognizes UTF-8 text by media type and caps recorded characters', async () => {
    const recognizer = registered({ maxExtractedChars: 4 })
    const attachment = ref('notes.unknown', 'text/plain')
    const result = await recognizer.recognize({
      ref: attachment,
      data: new TextEncoder().encode('abcdef'),
    })
    expect(recognizer.supports(attachment)).toBe(true)
    expect(result?.text).toBe('abcd\n[attachment text truncated]')
  })

  it('recognizes Markdown when the browser reports a generic media type', async () => {
    const recognizer = registered()
    const attachment = ref('README.md')
    const result = await recognizer.recognize({
      ref: attachment,
      data: new TextEncoder().encode('# Harness\n\nMarkdown content.'),
    })
    expect(recognizer.supports(attachment)).toBe(true)
    expect(result?.text).toBe('# Harness\n\nMarkdown content.')
  })

  it('extracts text from a bounded DOCX archive', async () => {
    const recognizer = registered()
    const attachment = ref('brief.docx')
    const data = docx('Hello DSH')
    const result = await recognizer.recognize({ ref: { ...attachment, bytes: data.byteLength }, data })
    expect(result?.text).toContain('Hello DSH')
  })

  it('refuses archives and inputs outside configured resource limits', async () => {
    const data = docx('bounded')
    const attachment = ref('brief.docx')
    await expect(registered({ maxZipEntries: 1 }).recognize({ ref: attachment, data }))
      .resolves.toBeUndefined()
    await expect(registered({ maxInputBytes: 1 }).recognize({ ref: attachment, data }))
      .resolves.toBeUndefined()
  })

  it('declines unsupported and malformed formats without inventing text', async () => {
    const recognizer = registered()
    expect(recognizer.supports(ref('archive.rar'))).toBe(false)
    await expect(recognizer.recognize({
      ref: ref('broken.docx'),
      data: new Uint8Array(Buffer.from('not a zip')),
    })).resolves.toBeUndefined()
  })

  it('sends OpenAI-compatible audio transcription with the configured credential', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ text: 'spoken words' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const recognizer = registered({
      audioTranscription: {
        endpoint: 'https://audio.test/v1',
        model: 'whisper-large',
        apiKeyEnv: 'DEEPSEEK_FILES_AUDIO_API_KEY',
      },
    }, 'audio-secret')
    const attachment = ref('sample.mp3', 'audio/mpeg')

    await expect(recognizer.recognize({ ref: attachment, data: new Uint8Array([1, 2, 3]) }))
      .resolves.toEqual({ text: 'spoken words' })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://audio.test/v1/audio/transcriptions')
    expect(init?.headers).toEqual({ authorization: 'Bearer audio-secret' })
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('model')).toBe('whisper-large')
  })

  it.each([
    ['ocr', 'scan.png', 'image/png', 'ocr-model', 'image_url', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/chat/completions'],
    ['videoUnderstanding', 'clip.mp4', 'video/mp4', 'video-model', 'video_url', 'https://vision.test/v1/chat/completions', 'https://vision.test/v1/chat/completions'],
  ] as const)('sends %s files through chat-completions content', async (
    kind,
    filename,
    mediaType,
    model,
    contentType,
    endpoint,
    expectedUrl,
  ) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'recognized content' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const recognizer = registered({
      [kind]: { endpoint, model },
    })
    const attachment = ref(filename, mediaType)

    await expect(recognizer.recognize({ ref: attachment, data: new Uint8Array([4, 5, 6]) }))
      .resolves.toEqual({ text: 'recognized content' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl)
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body
    expect(typeof requestBody).toBe('string')
    if (typeof requestBody !== 'string') throw new TypeError('expected a JSON request body')
    const body = JSON.parse(requestBody) as {
      model: string
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.model).toBe(model)
    expect(body.messages[0]?.content[1]?.type).toBe(contentType)
  })
})
