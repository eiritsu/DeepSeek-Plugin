import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type FileAttachmentRef, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { LarkChannel, NormalizedMessage, SendInput } from '@larksuite/channel'
import { describe, expect, it, vi } from 'vitest'
import { LarkConversationBridge, larkSessionId } from '../src/conversation.ts'

interface FakeEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

interface FakeSession {
  readonly id: SessionId
  readonly events: FakeEvent[]
}

type SessionListener = (session: FakeSession, event: FakeEvent) => void

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId('image-attachment'),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
  name: 'input.png',
}

const FILE_REF: FileAttachmentRef = {
  attachmentId: AttachmentId('file-attachment'),
  mediaType: 'text/plain',
  bytes: 4,
  name: 'answer.txt',
}

function inbound(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om_message',
    chatId: 'oc_chat',
    chatType: 'p2p',
    senderId: 'ou_allowed',
    content: '请处理附件',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
    ...overrides,
  }
}

class FakeChannel {
  readonly replies: SendInput[] = []
  readonly connect = vi.fn(async () => {})
  readonly disconnect = vi.fn(async () => {})
  readonly downloadResourceWithMeta = vi.fn(async (_messageId: string, fileKey: string) => ({
    buffer: Buffer.from(fileKey),
    contentType: fileKey.startsWith('image') ? 'image/png' : 'text/plain; charset=utf-8',
  }))
  private readonly messageHandlers = new Set<(message: NormalizedMessage) => void | Promise<void>>()
  private readonly errorHandlers = new Set<(error: unknown) => void>()

  on(name: string, handler: unknown): () => void {
    const handlers = name === 'message' ? this.messageHandlers : this.errorHandlers
    handlers.add(handler as never)
    return () => { handlers.delete(handler as never) }
  }

  async reply(_message: Pick<NormalizedMessage, 'chatId' | 'messageId' | 'threadId'>, input: SendInput): Promise<object> {
    this.replies.push(input)
    return {}
  }

  async emitMessage(message: NormalizedMessage): Promise<void> {
    await Promise.all([...this.messageHandlers].map(async handler => { await handler(message) }))
  }
}

function harness(options: {
  persisted?: boolean
  responseWithAttachments?: boolean
  workspaceExists?: boolean
  attachError?: Error
  live?: boolean
} = {}): {
  readonly ctx: Context
  readonly followups: UserMessage[]
  readonly created: SessionId[]
  readonly createdCwds: Array<string | undefined>
  readonly setupTimeZones: string[]
  readonly resumed: SessionId[]
  readonly attached: SessionId[]
  readonly workspaceCreates: string[]
  readonly disposed: ReturnType<typeof vi.fn>
  readonly scopedDisposed: ReturnType<typeof vi.fn>
  readonly savedImages: ReturnType<typeof vi.fn>
  readonly savedFiles: ReturnType<typeof vi.fn>
} {
  const listeners = new Set<SessionListener>()
  const sessions = new Map<SessionId, FakeSession>()
  const agents = new Map<SessionId, Agent>()
  const followups: UserMessage[] = []
  const created: SessionId[] = []
  const createdCwds: Array<string | undefined> = []
  const setupTimeZones: string[] = []
  const resumed: SessionId[] = []
  const attached: SessionId[] = []
  const workspaceCreates: string[] = []
  const disposed = vi.fn(async () => {})
  const scopedDisposed = vi.fn(async () => {})
  const savedImages = vi.fn(async () => [IMAGE_REF])
  const savedFiles = vi.fn(async () => [FILE_REF])
  const agentCtx = {
    plugin: vi.fn(async (_plugin: unknown, config: { timeZone: string }) => {
      setupTimeZones.push(config.timeZone)
      return { dispose: scopedDisposed }
    }),
  } as unknown as Context
  const workspace = {
    attachSession: vi.fn(async (sessionId: SessionId) => {
      if (options.attachError !== undefined) throw options.attachError
      attached.push(sessionId)
    }),
  }

  const emit = (session: FakeSession, event: FakeEvent): void => {
    session.events.push(event)
    for (const listener of listeners) listener(session, event)
  }
  const makeHandle = (sessionId: SessionId): AgentHandle => {
    const session: FakeSession = { id: sessionId, events: [] }
    const agent = {
      ctx: agentCtx,
      session,
      followup(message: UserMessage): void {
        followups.push(message)
        emit(session, { type: 'user/message', data: message as unknown as Record<string, unknown> })
        const content = options.responseWithAttachments === true
          ? [
              { type: 'text' as const, text: '已完成' },
              { type: 'image' as const, attachment: IMAGE_REF },
              { type: 'file' as const, attachment: FILE_REF },
            ]
          : [{ type: 'text' as const, text: '收到' }]
        emit(session, {
          type: 'assistant/message',
          data: {
            message: createAssistantMessage({
              content,
              source: { provider: 'test', model: 'test-model' },
            }),
          },
        })
        emit(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
      },
    } as unknown as Agent
    agents.set(sessionId, agent)
    sessions.set(sessionId, session)
    return {
      agent,
      dispose: async () => {
        await disposed()
        agents.delete(sessionId)
        sessions.delete(sessionId)
      },
    }
  }

  if (options.live === true) makeHandle(larkSessionId('cli_app', 'oc_chat'))

  const ctx = {
    fiber: { assertActive(): void {} },
    logger: { warn: vi.fn() },
    on(name: string, listener: SessionListener): () => void {
      expect(name).toBe('session/event')
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    agents: {
      get: (id: SessionId) => agents.get(id),
      create: vi.fn(async ({ sessionId, meta, setup }: {
        sessionId: SessionId
        meta?: { cwd?: string }
        setup?: (ctx: Context) => void | Promise<void>
      }) => {
        created.push(sessionId)
        createdCwds.push(meta?.cwd)
        await setup?.(agentCtx)
        return makeHandle(sessionId)
      }),
      resume: vi.fn(async ({ resumeSessionId, setup }: {
        resumeSessionId: SessionId
        setup?: (ctx: Context) => void | Promise<void>
      }) => {
        resumed.push(resumeSessionId)
        await setup?.(agentCtx)
        return makeHandle(resumeSessionId)
      }),
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
    sessionPersistence: {
      list: vi.fn(async () => options.persisted === true
        ? [{ id: larkSessionId('cli_app', 'oc_chat') }]
        : []),
    },
    attachments: {
      saveImages: savedImages,
      saveFiles: savedFiles,
      recognizeImage: vi.fn(async () => ({ text: '图片内容' })),
      recognizeFile: vi.fn(async () => ({ text: '文件内容' })),
      readImage: vi.fn(async () => ({ ref: IMAGE_REF, data: new Uint8Array([1, 2, 3]) })),
      readFile: vi.fn(async () => ({ ref: FILE_REF, data: new Uint8Array([4, 5, 6, 7]) })),
    },
    workspaceRegistry: {
      resolveByPath: vi.fn(async () => options.workspaceExists === false ? undefined : workspace),
      create: vi.fn(async (path: string) => {
        workspaceCreates.push(path)
        return workspace
      }),
    },
  } as unknown as Context
  return {
    ctx,
    followups,
    created,
    createdCwds,
    setupTimeZones,
    resumed,
    attached,
    workspaceCreates,
    disposed,
    scopedDisposed,
    savedImages,
    savedFiles,
  }
}

describe('LarkConversationBridge', () => {
  it('derives stable application-scoped session ids', () => {
    expect(larkSessionId('cli_app', 'oc_chat')).toBe(larkSessionId('cli_app', 'oc_chat'))
    expect(larkSessionId('cli_app', 'oc_chat')).not.toBe(larkSessionId('cli_other', 'oc_chat'))
    expect(larkSessionId('cli_app', 'oc_chat')).not.toBe(larkSessionId('cli_app', 'oc_other'))
    const legacyDigest = createHash('sha256').update('cli_app').update('\0').update('oc_chat').digest('hex')
    expect(larkSessionId('cli_app', 'oc_chat')).not.toBe(SessionId(`lark-${legacyDigest.slice(0, 32)}`))
  })

  it('logs one authorized private message and ignores its redelivery', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound())
    await channel.emitMessage(inbound())

    expect(runtime.created).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.createdCwds).toEqual(['/workspace'])
    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai'])
    expect(runtime.attached).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.followups).toHaveLength(1)
    expect(runtime.followups[0]?.source).toEqual({
      kind: 'lark',
      appId: 'cli_app',
      chatId: 'oc_chat',
      messageId: 'om_message',
      senderId: 'ou_allowed',
    })
    expect(channel.replies).toEqual([{ markdown: '收到' }])
    await bridge.dispose()
    expect(channel.disconnect).toHaveBeenCalledOnce()
    expect(runtime.disposed).toHaveBeenCalledOnce()
  })

  it('stores inbound images and files and returns attachment response blocks', async () => {
    const runtime = harness({ responseWithAttachments: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound({
      resources: [
        { type: 'image', fileKey: 'image-bytes', fileName: 'input.png' },
        { type: 'file', fileKey: 'file-bytes', fileName: 'input.txt' },
      ],
    }))

    expect(runtime.savedImages).toHaveBeenCalledWith([
      expect.objectContaining({ mediaType: 'image/png', name: 'input.png' }),
    ])
    expect(runtime.savedFiles).toHaveBeenCalledWith([
      expect.objectContaining({ mediaType: 'text/plain', name: 'input.txt' }),
    ])
    expect(runtime.followups[0]?.content).toEqual([
      { type: 'text', text: '请处理附件' },
      { type: 'image', attachment: IMAGE_REF, recognizedText: '图片内容' },
      { type: 'file', attachment: FILE_REF, recognizedText: '文件内容' },
    ])
    expect(channel.replies).toEqual([
      { markdown: '已完成' },
      { image: { source: Buffer.from([1, 2, 3]) } },
      { file: { source: Buffer.from([4, 5, 6, 7]), fileName: 'answer.txt' } },
    ])
    await bridge.dispose()
  })

  it('resumes a persisted chat and rejects groups or other senders', async () => {
    const runtime = harness({ persisted: true, workspaceExists: false })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound({ chatType: 'group' }))
    await channel.emitMessage(inbound({ senderId: 'ou_other' }))
    await channel.emitMessage(inbound())

    expect(runtime.created).toEqual([])
    expect(runtime.resumed).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.workspaceCreates).toEqual(['/workspace'])
    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai'])
    expect(runtime.attached).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.followups).toHaveLength(1)
    await bridge.dispose()
  })

  it('disposes an unpublished chat owner when Workspace attachment fails', async () => {
    const runtime = harness({ attachError: new Error('attach failed') })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()

    await channel.emitMessage(inbound())

    expect(runtime.disposed).toHaveBeenCalledOnce()
    expect(runtime.followups).toEqual([])
    expect(channel.replies).toEqual([{ text: '处理消息时发生错误，请稍后重试。' }])
    await bridge.dispose()
    expect(runtime.disposed).toHaveBeenCalledOnce()
  })

  it('configures a chat Agent that another client resumed first', async () => {
    const runtime = harness({ live: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()

    await channel.emitMessage(inbound())

    expect(runtime.created).toEqual([])
    expect(runtime.resumed).toEqual([])
    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai'])
    expect(runtime.attached).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.followups).toHaveLength(1)
    await bridge.dispose()
    expect(runtime.scopedDisposed).toHaveBeenCalledOnce()
    expect(runtime.disposed).not.toHaveBeenCalled()
  })
})
