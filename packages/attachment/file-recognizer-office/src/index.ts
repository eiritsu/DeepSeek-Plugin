/** Sideloadable semantic recognition for common document attachments. */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AttachmentRef, FileRecognizer } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { parseOfficeAsync } from 'officeparser'
import yauzl from 'yauzl'
import type { Entry } from 'yauzl'

const OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'pdf'])
const ZIP_OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'flac', 'ogg', 'oga'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mpeg', 'mpg', 'mov', 'webm', 'mkv', 'avi', 'm4v'])
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'mdx', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'xml',
  'toml', 'ini', 'env', 'conf', 'config', 'properties', 'log', 'ts', 'tsx', 'js', 'jsx',
  'mjs', 'cjs', 'css', 'scss', 'less', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h',
  'cpp', 'hpp', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'graphql',
])

/** One external recognition endpoint configured from Settings. */
export interface RecognitionEndpointConfig {
  /** Complete request URL. */
  endpoint?: string
  /** Provider model identifier. */
  model?: string
  /** Credential reference resolved immediately before each request. */
  apiKeyEnv?: string
}

/** Deepseek-Files recognition plugin configuration. */
export interface Config {
  /** Maximum input bytes parsed by this recognizer. Default: 32 MiB. */
  maxInputBytes?: number
  /** Maximum extracted characters recorded in one file block. Default: 200,000. */
  maxExtractedChars?: number
  /** Maximum total uncompressed archive bytes. Default: 128 MiB. */
  maxUncompressedBytes?: number
  /** Maximum archive entries. Default: 4,000. */
  maxZipEntries?: number
  /** OpenAI-compatible OCR endpoint. */
  ocr?: RecognitionEndpointConfig
  /** OpenAI-compatible audio transcription endpoint. */
  audioTranscription?: RecognitionEndpointConfig
  /** OpenAI-compatible video understanding endpoint. */
  videoUnderstanding?: RecognitionEndpointConfig
}

const recognitionEndpointConfig: z<RecognitionEndpointConfig> = z.object({
  endpoint: z.string(),
  model: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
})

export const Config: z<Config> = z.object({
  maxInputBytes: z.number().step(1).min(1).default(32 * 1024 * 1024),
  maxExtractedChars: z.number().step(1).min(1).default(200_000),
  maxUncompressedBytes: z.number().step(1).min(1).default(128 * 1024 * 1024),
  maxZipEntries: z.number().step(1).min(1).default(4_000),
  ocr: recognitionEndpointConfig,
  audioTranscription: recognitionEndpointConfig,
  videoUnderstanding: recognitionEndpointConfig,
})

/** Cordis plugin name. */
export const name = 'file-recognizer-office'
/** Services required by the recognition provider. */
export const inject = ['attachments']

/** Settings namespace for external file-recognition providers. */
export const FILE_RECOGNIZER_SETTINGS_NAMESPACE = settingsNamespace('file-recognizer-office')

/** Credential references used by the Deepseek-Files settings page. */
export const FILE_RECOGNIZER_CREDENTIAL_REFS = {
  ocr: 'DEEPSEEK_FILES_OCR_API_KEY',
  audioTranscription: 'DEEPSEEK_FILES_AUDIO_API_KEY',
  videoUnderstanding: 'DEEPSEEK_FILES_VIDEO_API_KEY',
} as const

function validateConfig(config: Config): void {
  for (const [name, endpoint] of Object.entries({
    ocr: config.ocr,
    audioTranscription: config.audioTranscription,
    videoUnderstanding: config.videoUnderstanding,
  })) {
    if (endpoint === undefined) continue
    const hasEndpoint = endpoint.endpoint !== undefined && endpoint.endpoint.length > 0
    const hasModel = endpoint.model !== undefined && endpoint.model.length > 0
    if (hasEndpoint !== hasModel) throw new TypeError(`${name} requires both endpoint and model`)
    if (!hasEndpoint) continue
    const endpointUrl = endpoint.endpoint
    if (endpointUrl === undefined) continue
    const protocol = new URL(endpointUrl).protocol
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new TypeError(`${name} endpoint must use HTTP or HTTPS`)
    }
  }
}

function extension(ref: AttachmentRef): string | undefined {
  const name = ref.name
  if (name === undefined) return undefined
  const index = name.lastIndexOf('.')
  return index < 0 ? undefined : name.slice(index + 1).toLowerCase()
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\n[attachment text truncated]'
}

function configured(endpoint: RecognitionEndpointConfig | undefined): endpoint is Required<Pick<RecognitionEndpointConfig, 'endpoint' | 'model'>> & RecognitionEndpointConfig {
  return endpoint?.endpoint !== undefined && endpoint.endpoint.length > 0
    && endpoint.model !== undefined && endpoint.model.length > 0
}

function operationEndpoint(config: RecognitionEndpointConfig, operation: string): string {
  if (config.endpoint === undefined) throw new TypeError('recognition endpoint is not configured')
  const endpoint = new URL(config.endpoint)
  const path = endpoint.pathname.replace(/\/+$/, '')
  if (/\/(?:api\/)?v\d+(?:\.\d+)?$/.test(path)) endpoint.pathname = `${path}/${operation}`
  return endpoint.toString()
}

async function authorizationHeaders(ctx: Context, config: RecognitionEndpointConfig): Promise<Record<string, string>> {
  if (config.apiKeyEnv === undefined || config.apiKeyEnv.length === 0) return {}
  const key = await ctx.get('credentials')?.resolve(credentialRef(config.apiKeyEnv))
  return key === undefined ? {} : { authorization: `Bearer ${key.value}` }
}

function responseText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  for (const key of ['text', 'transcript', 'output_text']) {
    if (typeof record[key] === 'string' && record[key].length > 0) return record[key]
  }
  const choices = record.choices
  if (!Array.isArray(choices)) return undefined
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return undefined
  const message = (first as Record<string, unknown>).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content.length === 0 ? undefined : content
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((part) => {
    if (typeof part !== 'object' || part === null) return []
    const candidate = (part as Record<string, unknown>).text
    return typeof candidate === 'string' ? [candidate] : []
  }).join('\n')
  return text.length === 0 ? undefined : text
}

async function recognizeChatFile(
  ctx: Context,
  file: Parameters<FileRecognizer['recognize']>[0],
  config: RecognitionEndpointConfig,
  kind: 'ocr' | 'video',
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!configured(config)) return undefined
  const dataURL = `data:${file.ref.mediaType};base64,${Buffer.from(file.data).toString('base64')}`
  const filename = file.ref.name ?? `attachment.${extension(file.ref) ?? 'bin'}`
  const media = kind === 'video'
    ? { type: 'video_url', video_url: { url: dataURL } }
    : file.ref.mediaType.startsWith('image/')
      ? { type: 'image_url', image_url: { url: dataURL } }
      : { type: 'file', file: { filename, file_data: dataURL } }
  const response = await fetch(operationEndpoint(config, 'chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...await authorizationHeaders(ctx, config),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: kind === 'ocr' ? 'Extract all visible text verbatim.' : 'Describe and transcribe the important content of this video.' },
          media,
        ],
      }],
    }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) return undefined
  return responseText(await response.json())
}

async function transcribeAudio(
  ctx: Context,
  file: Parameters<FileRecognizer['recognize']>[0],
  config: RecognitionEndpointConfig,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!configured(config)) return undefined
  const form = new FormData()
  form.set('model', config.model)
  form.set('file', new File([Uint8Array.from(file.data).buffer], file.ref.name ?? 'audio', { type: file.ref.mediaType }))
  const response = await fetch(operationEndpoint(config, 'audio/transcriptions'), {
    method: 'POST',
    headers: await authorizationHeaders(ctx, config),
    body: form,
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) return undefined
  return responseText(await response.json())
}

async function preflightZip(data: Uint8Array, maxEntries: number, maxBytes: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    yauzl.fromBuffer(Buffer.from(data), { lazyEntries: true }, (error, archive) => {
      if (error !== null) {
        resolve(false)
        return
      }
      let entries = 0
      let bytes = 0
      let settled = false
      const finish = (accepted: boolean): void => {
        if (settled) return
        settled = true
        resolve(accepted)
      }
      const refuse = (): void => {
        archive.close()
        finish(false)
      }
      archive.on('error', refuse)
      archive.on('entry', (entry: Entry) => {
        entries += 1
        bytes += entry.uncompressedSize
        if (entries > maxEntries || bytes > maxBytes) {
          refuse()
          return
        }
        archive.readEntry()
      })
      archive.on('end', () => { finish(true) })
      archive.readEntry()
    })
  })
}

/** Register the common-document recognizer into the mounted attachment store. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, FILE_RECOGNIZER_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
    validate: validateConfig,
  })
  const maxInputBytes = config.maxInputBytes ?? 32 * 1024 * 1024
  const maxExtractedChars = config.maxExtractedChars ?? 200_000
  const maxUncompressedBytes = config.maxUncompressedBytes ?? 128 * 1024 * 1024
  const maxZipEntries = config.maxZipEntries ?? 4_000
  const recognizer: FileRecognizer = {
    id: 'officeparser',
    supports: (ref) => {
      const suffix = extension(ref)
      const settings = current()
      return ref.mediaType.startsWith('text/')
        || (suffix !== undefined && (OFFICE_EXTENSIONS.has(suffix) || TEXT_EXTENSIONS.has(suffix)))
        || (configured(settings.ocr)
          && (ref.mediaType.startsWith('image/') || (suffix !== undefined && IMAGE_EXTENSIONS.has(suffix))))
        || (configured(settings.audioTranscription)
          && (ref.mediaType.startsWith('audio/') || (suffix !== undefined && AUDIO_EXTENSIONS.has(suffix))))
        || (configured(settings.videoUnderstanding)
          && (ref.mediaType.startsWith('video/') || (suffix !== undefined && VIDEO_EXTENSIONS.has(suffix))))
    },
    recognize: async (file, signal) => {
      signal?.throwIfAborted()
      if (file.data.byteLength > maxInputBytes) return undefined
      const suffix = extension(file.ref)
      const settings = current()
      if (file.ref.mediaType.startsWith('text/') || (suffix !== undefined && TEXT_EXTENSIONS.has(suffix))) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(file.data)
        return text === '' ? undefined : { text: truncate(text, maxExtractedChars) }
      }
      try {
        if (file.ref.mediaType.startsWith('video/')
          || (!file.ref.mediaType.startsWith('audio/') && suffix !== undefined && VIDEO_EXTENSIONS.has(suffix))) {
          const text = await recognizeChatFile(ctx, file, settings.videoUnderstanding ?? {}, 'video', signal)
          return text === undefined ? undefined : { text: truncate(text, maxExtractedChars) }
        }
        if (file.ref.mediaType.startsWith('audio/') || (suffix !== undefined && AUDIO_EXTENSIONS.has(suffix))) {
          const text = await transcribeAudio(ctx, file, settings.audioTranscription ?? {}, signal)
          return text === undefined ? undefined : { text: truncate(text, maxExtractedChars) }
        }
        if (file.ref.mediaType.startsWith('image/') || (suffix !== undefined && IMAGE_EXTENSIONS.has(suffix))) {
          const text = await recognizeChatFile(ctx, file, settings.ocr ?? {}, 'ocr', signal)
          return text === undefined ? undefined : { text: truncate(text, maxExtractedChars) }
        }
        if (suffix === undefined || !OFFICE_EXTENSIONS.has(suffix)) return undefined
        if (ZIP_OFFICE_EXTENSIONS.has(suffix)
          && !await preflightZip(file.data, maxZipEntries, maxUncompressedBytes)) return undefined
        let text = (await parseOfficeAsync(Buffer.from(file.data), {
          outputErrorToConsole: false,
        })).trim()
        if (text === '' && suffix === 'pdf') {
          text = await recognizeChatFile(ctx, file, settings.ocr ?? {}, 'ocr', signal) ?? ''
        }
        signal?.throwIfAborted()
        return text === '' ? undefined : { text: truncate(text, maxExtractedChars) }
      } catch {
        signal?.throwIfAborted()
        return undefined
      }
    },
  }
  ctx.effect(() => ctx.attachments.registerFileRecognizer(recognizer), 'file-recognizer-office registration')
}
