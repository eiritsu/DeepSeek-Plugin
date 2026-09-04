/** Lark private-chat transport between normalized Channel messages and durable DSH Agents. */

import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { UNKNOWN_FILE_MEDIA_TYPE } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm/message'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import * as timeContext from '@deepseek-ai/dsh-time-context'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { LarkChannel, NormalizedMessage, ResourceDescriptor } from '@larksuite/channel'

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    /** Human input received from one Lark application and chat. */
    lark: {
      kind: 'lark'
      appId: string
      chatId: string
      messageId: string
      senderId: string
    }
  }
}

interface TurnResponse {
  readonly message?: AssistantMessage
  readonly failed: boolean
}

interface PendingTurnResponse {
  readonly promise: Promise<TurnResponse>
  cancel(reason: unknown): void
}

interface PreparedResource {
  readonly descriptor: ResourceDescriptor
  readonly input: SaveImageAttachment | { data: Uint8Array; mediaType: string; name?: string }
  readonly kind: 'image' | 'file'
}

/** Supply the live default route when a Lark Agent was created before a model was configured. */
function installDefaultModelRoute(
  agentCtx: Context,
  currentSelection: () => ModelSelection,
): () => void {
  return agentCtx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    if (resolved.provider.length > 0 && resolved.model.length > 0) return resolved
    const selection = currentSelection()
    if (selection.provider.length === 0 || selection.model.length === 0) return resolved
    return {
      ...resolved,
      provider: selection.provider,
      model: selection.model,
      ...resolved.reasoningEffort === undefined && selection.reasoningEffort !== undefined
        ? { reasoningEffort: selection.reasoningEffort }
        : {},
    }
  })
}

/** Construction options for one application-scoped Lark conversation bridge. */
export interface LarkConversationOptions {
  /** Application identity included in durable message provenance and session ids. */
  readonly appId: string
  /** Only this Lark user may open private-chat turns. */
  readonly allowedSenderId: string
  /** Maximum time to wait for the turn containing an accepted Lark message. */
  readonly responseTimeoutMs: number
  /** Workspace used by newly created chat sessions. */
  readonly cwd: string
  /** IANA time zone used when Lark supplies no browser time-zone provenance. */
  readonly timeZone: string
}

const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set<ImageMediaType>([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
])
const LARK_SESSION_KEY_VERSION = 'cwd-v1'

function normalizedMediaType(value: string | undefined): string | undefined {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === undefined || mediaType.length === 0 ? undefined : mediaType
}

function imageMediaType(contentType: string | undefined, name: string | undefined): ImageMediaType | undefined {
  const declared = normalizedMediaType(contentType)
  if (declared !== undefined && IMAGE_MEDIA_TYPES.has(declared)) return declared as ImageMediaType
  switch (extname(name ?? '').toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return undefined
  }
}

/** Derive a stable opaque DSH identity without retaining the Lark chat id in filenames. */
export function larkSessionId(appId: string, chatId: string): SessionId {
  const digest = createHash('sha256')
    .update(LARK_SESSION_KEY_VERSION).update('\0')
    .update(appId).update('\0')
    .update(chatId).digest('hex')
  return SessionId(`lark-${digest.slice(0, 32)}`)
}

/** Owns one Channel connection and every Agent lifecycle created for its private chats. */
export class LarkConversationBridge {
  private readonly abort = new AbortController()
  private readonly creations = new Map<SessionId, Promise<Agent>>()
  private readonly handles = new Map<SessionId, AgentHandle>()
  private readonly liveTimeContexts = new Map<SessionId, { dispose(): Promise<void> }>()
  private readonly activeMessages = new Map<SessionId, number>()
  private readonly inFlight = new Set<Promise<void>>()
  private unsubscribers: Array<() => void> = []
  private connected = false

  /** Bind a connected official Channel to DSH Agent and attachment services. */
  constructor(
    private readonly ctx: Context,
    private readonly channel: LarkChannel,
    private readonly options: LarkConversationOptions,
  ) {}

  /** Attach handlers and complete the first WebSocket handshake. */
  async connect(): Promise<void> {
    if (this.connected) return
    this.ctx.fiber.assertActive()
    this.unsubscribers = [
      this.channel.on('message', async (message) => {
        if (this.abort.signal.aborted) return
        const operation = this.handleMessage(message)
        this.inFlight.add(operation)
        try {
          await operation
        } finally {
          this.inFlight.delete(operation)
        }
      }),
      this.channel.on('error', (error) => {
        if (!this.abort.signal.aborted) this.ctx.logger.warn(`Lark conversation channel error: ${String(error)}`)
      }),
      this.ctx.on('agent/created', ({ agent }) => {
        void this.configureDiscoveredAgent(agent).catch((error: unknown) => {
          if (!this.abort.signal.aborted) {
            this.ctx.logger.warn(`Lark live Agent ${agent.id} configuration failed: ${String(error)}`)
          }
        })
      }),
    ]
    try {
      await Promise.all(this.ctx.agents.list().map(async agent => { await this.configureDiscoveredAgent(agent) }))
      await this.channel.connect()
      this.connected = true
    } catch (error: unknown) {
      for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
      throw error
    }
  }

  /** Stop ingress, settle active handlers, disconnect transport, and release owned Agents. */
  async dispose(): Promise<void> {
    if (!this.abort.signal.aborted) this.abort.abort(new Error('Lark conversation bridge disposed'))
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    try {
      await this.channel.disconnect()
    } finally {
      await Promise.allSettled([...this.inFlight])
      await Promise.allSettled([...this.liveTimeContexts.values()].map(fiber => fiber.dispose()))
      this.liveTimeContexts.clear()
      await Promise.allSettled([...this.handles.values()].map(handle => handle.dispose()))
      this.handles.clear()
      this.connected = false
    }
  }

  private async handleMessage(message: NormalizedMessage): Promise<void> {
    if (message.chatType !== 'p2p' || message.senderId !== this.options.allowedSenderId) return
    let sessionId: SessionId | undefined
    try {
      const agent = await this.ensureAgent(message.chatId)
      sessionId = agent.session.id
      this.activeMessages.set(sessionId, (this.activeMessages.get(sessionId) ?? 0) + 1)
      if (this.wasAccepted(agent, message.messageId)) return
      const content = await this.inboundContent(message)
      if (content.length === 0) {
        await this.channel.reply(message, { text: '暂不支持这类消息内容。' })
        return
      }
      const response = this.waitForTurn(agent, message.messageId)
      try {
        agent.followup(createUserMessage({
          content,
          source: {
            kind: 'lark',
            appId: this.options.appId,
            chatId: message.chatId,
            messageId: message.messageId,
            senderId: message.senderId,
          },
        }))
      } catch (error: unknown) {
        response.cancel(error)
        void response.promise.catch(() => {})
        throw error
      }
      await this.sendResponse(message, await response.promise)
    } catch (error: unknown) {
      if (this.abort.signal.aborted) return
      const diagnostic = error instanceof Error ? error.stack ?? error.message : String(error)
      this.ctx.logger.warn(`Lark message ${message.messageId} failed: ${diagnostic}`)
      process.stderr.write(`[dsh-lark] message ${message.messageId} failed: ${diagnostic}\n`)
      try {
        await this.channel.reply(message, { text: '处理消息时发生错误，请稍后重试。' })
      } catch (replyError: unknown) {
        this.ctx.logger.warn(`Lark error reply for ${message.messageId} failed: ${String(replyError)}`)
      }
    } finally {
      if (sessionId !== undefined) await this.releaseIdleAgent(sessionId)
    }
  }

  private wasAccepted(agent: Agent, messageId: string): boolean {
    return agent.session.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'lark'
      && event.data.source.messageId === messageId)
  }

  private async inboundContent(message: NormalizedMessage): Promise<ContentBlock[]> {
    const prepared = await Promise.all(message.resources.flatMap(resource =>
      resource.type === 'image' || resource.type === 'file'
        ? [this.downloadResource(message.messageId, resource)]
        : []))
    const imageInputs = prepared.filter(resource => resource.kind === 'image')
      .map(resource => resource.input as SaveImageAttachment)
    const imageRefs = imageInputs.length === 0 ? [] : await this.ctx.attachments.saveImages(imageInputs)
    const fileInputs = prepared.filter(resource => resource.kind === 'file').map(resource => resource.input as { data: Uint8Array; mediaType: string; name?: string })
    const fileStore = this.ctx.attachments as typeof this.ctx.attachments & { saveFiles?: (inputs: readonly { data: Uint8Array; mediaType: string; name?: string }[]) => Promise<readonly FileAttachmentRef[]> }
    const fileRefs = fileInputs.length === 0 || fileStore.saveFiles === undefined ? [] : await fileStore.saveFiles(fileInputs)
    let imageIndex = 0
    let fileIndex = 0
    const blocks: ContentBlock[] = message.content.trim().length === 0
      ? []
      : [{ type: 'text', text: message.content }]
    for (const resource of prepared) {
      if (resource.kind === 'image') {
        const ref = imageRefs[imageIndex++] as ImageAttachmentRef
        blocks.push({ type: 'image', attachment: ref })
      } else {
        const input = resource.input as { data: Uint8Array; mediaType: string; name?: string }
        const ref = fileRefs[fileIndex++] as FileAttachmentRef | undefined
        if (ref !== undefined) {
          const recognized = await this.ctx.attachments.recognizeFile(ref, this.abort.signal)
          blocks.push(recognized?.text ? { type: 'file', attachment: ref, recognizedText: recognized.text } : { type: 'file', attachment: ref })
        } else {
          const recognized = await this.ctx.attachments.recognizeFile(input, this.abort.signal)
          if (recognized !== undefined && recognized.text !== '') blocks.push({ type: 'text', text: `Attached file ${JSON.stringify(input.name ?? 'attachment')} content:\n${recognized.text}` })
        }
      }
    }
    return blocks
  }

  private async downloadResource(messageId: string, descriptor: ResourceDescriptor): Promise<PreparedResource> {
    const resourceType = descriptor.type === 'image' ? 'image' : 'file'
    const { buffer, contentType } = await this.channel.downloadResourceWithMeta(
      messageId,
      descriptor.fileKey,
      resourceType,
    )
    const imageType = descriptor.type === 'image' ? imageMediaType(contentType, descriptor.fileName) : undefined
    if (imageType !== undefined) {
      return {
        kind: 'image',
        descriptor,
        input: {
          data: new Uint8Array(buffer),
          mediaType: imageType,
          ...descriptor.fileName === undefined ? {} : { name: descriptor.fileName },
        },
      }
    }
    return {
      kind: 'file',
      descriptor,
      input: {
        data: new Uint8Array(buffer),
        mediaType: normalizedMediaType(contentType) ?? UNKNOWN_FILE_MEDIA_TYPE,
        ...descriptor.fileName === undefined ? {} : { name: descriptor.fileName },
      },
    }
  }

  private waitForTurn(agent: Agent, messageId: string): PendingTurnResponse {
    const timeout = AbortSignal.timeout(this.options.responseTimeoutMs)
    const cancellation = new AbortController()
    const signal = AbortSignal.any([this.abort.signal, timeout, cancellation.signal])
    const promise = new Promise<TurnResponse>((resolve, reject) => {
      let accepted = false
      let latest: AssistantMessage | undefined
      let settled = false
      const finish = (result?: TurnResponse, error?: unknown): void => {
        if (settled) return
        settled = true
        dispose()
        signal.removeEventListener('abort', onAbort)
        if (error !== undefined) reject(error)
        else resolve(result as TurnResponse)
      }
      const dispose = this.ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        if (event.type === 'user/message'
          && event.data.source.kind === 'lark'
          && event.data.source.messageId === messageId) {
          accepted = true
          return
        }
        if (!accepted) return
        if (event.type === 'assistant/message') {
          latest = event.data.message
          return
        }
        if (event.type === 'turn/end') {
          finish({
            ...latest === undefined ? {} : { message: latest },
            failed: event.data.reason.kind === 'error' || event.data.reason.kind === 'aborted',
          })
        }
      })
      const onAbort = (): void => { finish(undefined, signal.reason) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
    return {
      promise,
      cancel: reason => { cancellation.abort(reason) },
    }
  }

  private async sendResponse(inbound: NormalizedMessage, response: TurnResponse): Promise<void> {
    const blocks = response.message?.content ?? []
    const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
    let sent = false
    if (text.length > 0) {
      await this.channel.reply(inbound, { text })
      sent = true
    }
    for (const block of blocks) {
      if (block.type === 'image') {
        const stored = await this.ctx.attachments.readImage(block.attachment, this.abort.signal)
        await this.channel.reply(inbound, { image: { source: Buffer.from(stored.data) } })
        sent = true
      }
    }
    if (!sent) {
      await this.channel.reply(inbound, {
        text: response.failed ? '本次处理未能完成，请稍后重试。' : '处理已完成，但没有可发送的内容。',
      })
    }
  }

  private async ensureAgent(chatId: string): Promise<Agent> {
    const sessionId = larkSessionId(this.options.appId, chatId)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined && (
      this.handles.has(sessionId)
      || this.liveTimeContexts.has(sessionId)
    )) return live
    let creation = this.creations.get(sessionId)
    if (creation === undefined) {
      creation = (live === undefined
        ? this.createOrResumeAgent(sessionId)
        : this.configureLiveAgent(sessionId, live)
      ).catch((error: unknown) => {
        const concurrent = this.ctx.agents.get(sessionId)
        if (concurrent !== undefined && (
          this.handles.has(sessionId)
          || this.liveTimeContexts.has(sessionId)
        )) return concurrent
        throw error
      }).finally(() => {
        this.creations.delete(sessionId)
      })
      this.creations.set(sessionId, creation)
    }
    return creation
  }

  private async createOrResumeAgent(sessionId: SessionId): Promise<Agent> {
    const stored = (await this.ctx.sessionPersistence.list(this.abort.signal))
      .some(header => header.id === sessionId)
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const setup = async (agentCtx: Context): Promise<void> => {
      installDefaultModelRoute(agentCtx, () => this.ctx.agentDefaultModel.currentSelection())
      await agentCtx.plugin(timeContext, { timeZone: this.options.timeZone })
    }
    const handle = stored
      ? await this.ctx.agents.resume({
          resumeSessionId: sessionId,
          agentOptions: { provider: selection.provider, model: selection.model },
          signal: this.abort.signal,
          setup,
        })
      : await this.ctx.agents.create({
          sessionId,
          agentOptions: { provider: selection.provider, model: selection.model },
          signal: this.abort.signal,
          meta: { cwd: this.options.cwd },
          setup,
        })
    const workspace = await this.resolveWorkspace(handle.agent.session.header.cwd ?? this.options.cwd)
    try {
      await workspace.attachSession(sessionId)
    } catch (error) {
      await handle.dispose()
      throw error
    }
    this.handles.set(sessionId, handle)
    return handle.agent
  }

  /** Add Lark-owned context and Workspace membership to an Agent resumed by another client. */
  private async configureLiveAgent(sessionId: SessionId, agent: Agent): Promise<Agent> {
    const workspace = await this.resolveWorkspace(agent.session.header.cwd ?? this.options.cwd)
    const routeDisposer = installDefaultModelRoute(agent.ctx, () => this.ctx.agentDefaultModel.currentSelection())
    const fiber = await agent.ctx.plugin(timeContext, { timeZone: this.options.timeZone })
    try {
      await workspace.attachSession(sessionId)
    } catch (error) {
      routeDisposer()
      await fiber.dispose()
      throw error
    }
    this.liveTimeContexts.set(sessionId, {
      dispose: async () => {
        routeDisposer()
        await fiber.dispose()
      },
    })
    return agent
  }

  /** Release a Lark-owned Agent after its last in-flight message settles. */
  private async releaseIdleAgent(sessionId: SessionId): Promise<void> {
    const remaining = (this.activeMessages.get(sessionId) ?? 1) - 1
    if (remaining > 0) {
      this.activeMessages.set(sessionId, remaining)
      return
    }
    this.activeMessages.delete(sessionId)
    const handle = this.handles.get(sessionId)
    if (handle === undefined) return
    this.handles.delete(sessionId)
    await handle.dispose()
  }

  /** Configure a live session whose durable Lark provenance belongs to this application. */
  private async configureDiscoveredAgent(agent: Agent): Promise<void> {
    const belongsToApp = agent.session.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'lark'
      && event.data.source.appId === this.options.appId)
    if (!belongsToApp
      || this.handles.has(agent.id)
      || this.liveTimeContexts.has(agent.id)
      || this.creations.has(agent.id)) return
    const preparation = this.configureLiveAgent(agent.id, agent).finally(() => {
      this.creations.delete(agent.id)
    })
    this.creations.set(agent.id, preparation)
    await preparation
  }

  /** Resolve the configured directory to one durable, user-renamable Workspace. */
  private async resolveWorkspace(cwd: string): Promise<Workspace> {
    return await this.ctx.workspaceRegistry.resolveByPath(cwd)
      ?? await this.ctx.workspaceRegistry.create(cwd)
  }
}
