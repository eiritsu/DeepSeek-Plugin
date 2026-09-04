import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
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
  readonly header: { readonly cwd?: string }
  readonly events: FakeEvent[]
}

type SessionListener = (session: FakeSession, event: FakeEvent) => void
type RequestListener = (
  payload: unknown,
  next: () => Promise<{ provider: string; model: string; reasoningEffort?: string }>,
) => Promise<{ provider: string; model: string; reasoningEffort?: string }>

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId('image-attachment'),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
  name: 'input.png',
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
  sessionCwd?: string
} = {}): {
  readonly ctx: Context
  readonly followups: UserMessage[]
  readonly created: SessionId[]
  readonly createdCwds: Array<string | undefined>
  readonly setupTimeZones: string[]
  readonly resumed: SessionId[]
  readonly attached: SessionId[]
  readonly workspaceResolves: string[]
  readonly workspaceCreates: string[]
  readonly disposed: ReturnType<typeof vi.fn>
  readonly scopedDisposed: ReturnType<typeof vi.fn>
  readonly savedImages: ReturnType<typeof vi.fn>
  readonly requestListeners: RequestListener[]
} {
  const listeners = new Set<SessionListener>()
  const agentCreatedListeners = new Set<(payload: { agent: Agent }) => void>()
  const sessions = new Map<SessionId, FakeSession>()
  const agents = new Map<SessionId, Agent>()
  const persistedIds = new Set<SessionId>()
  const persistedEvents = new Map<SessionId, FakeEvent[]>()
  const followups: UserMessage[] = []
  const created: SessionId[] = []
  const createdCwds: Array<string | undefined> = []
  const setupTimeZones: string[] = []
  const resumed: SessionId[] = []
  const attached: SessionId[] = []
  const workspaceResolves: string[] = []
  const workspaceCreates: string[] = []
  const disposed = vi.fn(async () => {})
  const scopedDisposed = vi.fn(async () => {})
  const savedImages = vi.fn(async () => [IMAGE_REF])
  const requestListeners: RequestListener[] = []
  const agentCtx = {
    plugin: vi.fn(async (_plugin: unknown, config: { timeZone: string }) => {
      setupTimeZones.push(config.timeZone)
      return { dispose: scopedDisposed }
    }),
    on: vi.fn((name: string, listener: unknown) => {
      if (name === 'agent/request') requestListeners.push(listener as RequestListener)
      return () => {}
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
  const makeHandle = (
    sessionId: SessionId,
    cwd = options.sessionCwd ?? '/workspace',
    initialEvents: FakeEvent[] = [],
  ): AgentHandle => {
    const session: FakeSession = { id: sessionId, header: { cwd }, events: [...initialEvents] }
    const agent = {
      id: sessionId,
      ctx: agentCtx,
      session,
      followup(message: UserMessage): void {
        followups.push(message)
        emit(session, { type: 'user/message', data: message as unknown as Record<string, unknown> })
        const content = options.responseWithAttachments === true
          ? [
              { type: 'text' as const, text: '已完成' },
              { type: 'image' as const, attachment: IMAGE_REF },
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
        persistedEvents.set(sessionId, [...session.events])
        agents.delete(sessionId)
        sessions.delete(sessionId)
      },
    }
  }

  let liveAgent: Agent | undefined
  if (options.live === true) {
    const handle = makeHandle(larkSessionId('cli_app', 'oc_chat'))
    liveAgent = handle.agent
    const session = liveAgent.session as unknown as FakeSession
    session.events.push({
      type: 'user/message',
      data: {
        source: {
          kind: 'lark',
          appId: 'cli_app',
          chatId: 'oc_chat',
          messageId: 'om_existing',
          senderId: 'ou_allowed',
        },
      },
    })
  }

  const ctx = {
    fiber: { assertActive(): void {} },
    logger: { warn: vi.fn() },
    on(name: string, listener: SessionListener | ((payload: { agent: Agent }) => void)): () => void {
      if (name === 'session/event') {
        listeners.add(listener as SessionListener)
        return () => { listeners.delete(listener as SessionListener) }
      }
      if (name === 'agent/created') {
        agentCreatedListeners.add(listener as (payload: { agent: Agent }) => void)
        return () => { agentCreatedListeners.delete(listener as (payload: { agent: Agent }) => void) }
      }
      throw new Error(`unexpected event listener: ${name}`)
    },
    agents: {
      get: (id: SessionId) => agents.get(id),
      list: () => liveAgent === undefined ? [] : [liveAgent],
      create: vi.fn(async ({ sessionId, meta, setup }: {
        sessionId: SessionId
        meta?: { cwd?: string }
        setup?: (ctx: Context) => void | Promise<void>
      }) => {
        created.push(sessionId)
        persistedIds.add(sessionId)
        createdCwds.push(meta?.cwd)
        await setup?.(agentCtx)
        return makeHandle(sessionId, meta?.cwd)
      }),
      resume: vi.fn(async ({ resumeSessionId, setup }: {
        resumeSessionId: SessionId
        setup?: (ctx: Context) => void | Promise<void>
      }) => {
        resumed.push(resumeSessionId)
        persistedIds.add(resumeSessionId)
        await setup?.(agentCtx)
        return makeHandle(resumeSessionId, undefined, persistedEvents.get(resumeSessionId))
      }),
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
    sessionPersistence: {
      list: vi.fn(async () => options.persisted === true || persistedIds.has(larkSessionId('cli_app', 'oc_chat'))
        ? [{ id: larkSessionId('cli_app', 'oc_chat') }]
        : []),
    },
    attachments: {
      saveImages: savedImages,
      recognizeImage: vi.fn(async () => ({ text: '图片内容' })),
      recognizeFile: vi.fn(async () => ({ text: '文件内容' })),
      readImage: vi.fn(async () => ({ ref: IMAGE_REF, data: new Uint8Array([1, 2, 3]) })),
    },
    workspaceRegistry: {
      resolveByPath: vi.fn(async (path: string) => {
        workspaceResolves.push(path)
        return options.workspaceExists === false ? undefined : workspace
      }),
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
    workspaceResolves,
    workspaceCreates,
    disposed,
    scopedDisposed,
    savedImages,
    requestListeners,
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
    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai', 'Asia/Shanghai'])
    expect(runtime.attached).toEqual([
      larkSessionId('cli_app', 'oc_chat'),
      larkSessionId('cli_app', 'oc_chat'),
    ])
    expect(runtime.followups).toHaveLength(1)
    expect(runtime.followups[0]?.source).toEqual({
      kind: 'lark',
      appId: 'cli_app',
      chatId: 'oc_chat',
      messageId: 'om_message',
      senderId: 'ou_allowed',
    })
    expect(channel.replies).toEqual([{ text: '收到' }])
    await bridge.dispose()
    expect(channel.disconnect).toHaveBeenCalledOnce()
    expect(runtime.disposed).toHaveBeenCalledTimes(2)
  })

  it('stores inbound images, recognizes transient files, and returns supported response blocks', async () => {
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
    expect(runtime.followups[0]?.content).toEqual([
      { type: 'text', text: '请处理附件' },
      { type: 'image', attachment: IMAGE_REF },
      { type: 'text', text: 'Attached file "input.txt" content:\n文件内容' },
    ])
    expect(channel.replies).toEqual([
      { text: '已完成' },
      { image: { source: Buffer.from([1, 2, 3]) } },
    ])
    await bridge.dispose()
  })

  it('supplies the current default route to a model-less Lark Agent', async () => {
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

    const listener = runtime.requestListeners[0]
    expect(listener).toBeDefined()
    await expect(listener?.({}, async () => ({ provider: '', model: '' }))).resolves.toMatchObject({
      provider: 'test',
      model: 'test-model',
    })
    await bridge.dispose()
  })

  it('resumes a persisted chat and rejects groups or other senders', async () => {
    const runtime = harness({ persisted: true, workspaceExists: false, sessionCwd: '/persisted-workspace' })
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
    expect(runtime.workspaceResolves).toEqual(['/persisted-workspace'])
    expect(runtime.workspaceCreates).toEqual(['/persisted-workspace'])
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
    const runtime = harness({ live: true, sessionCwd: '/live-workspace' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()

    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai'])
    expect(runtime.workspaceResolves).toEqual(['/live-workspace'])
    expect(runtime.attached).toEqual([larkSessionId('cli_app', 'oc_chat')])

    await channel.emitMessage(inbound())

    expect(runtime.created).toEqual([])
    expect(runtime.resumed).toEqual([])
    expect(runtime.followups).toHaveLength(1)
    await bridge.dispose()
    expect(runtime.scopedDisposed).toHaveBeenCalledOnce()
    expect(runtime.disposed).not.toHaveBeenCalled()
  })
})
