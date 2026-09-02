/** Host integration for Lark/Feishu credentials, permissions, OAuth, and CLI tools. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createLarkChannel, registerApp, type RegisterAppResult } from '@larksuite/channel'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { defineTool, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { authenticatedUserOpenId, missingUserAuthorizationScopes } from './auth-status.ts'
import {
  commandHelpArguments,
  helpDeclaresReadOnly,
  isDirectReadOnlyCommand,
  normalizeLarkCommand,
} from './command-risk.ts'
import { LarkConversationBridge } from './conversation.ts'
import {
  applicationScopeSets,
  LARK_CAPABILITIES,
  LARK_CONVERSATION_EVENTS,
  permissionImportTemplate,
  requestedTenantScopes,
  requestedUserScopes,
} from './permissions.ts'
import type { LarkCapabilityId } from './permissions.ts'
import {
  decodePendingUserAuthorization,
  encodePendingUserAuthorization,
  type PendingUserAuthorization,
} from './pending-user-auth.ts'

export type { LarkCapabilityDefinition, LarkCapabilityId } from './permissions.ts'
export { applicationScopeSets, LARK_CAPABILITIES, permissionImportTemplate, requestedTenantScopes, requestedUserScopes } from './permissions.ts'

/** Credential reference managed by the Lark Settings page. */
export const LARK_APP_SECRET_REF = credentialRef('LARKSUITE_CLI_APP_SECRET')
/** Credential reference for an unfinished current-user device authorization. */
export const LARK_PENDING_USER_AUTH_REF = credentialRef('LARKSUITE_CLI_PENDING_USER_AUTH_DEVICE_CODE')
/** Settings namespace bound by the browser plugin. */
export const LARK_SETTINGS_NAMESPACE = settingsNamespace('lark')

const CLI_RUNNER = fileURLToPath(new URL('../vendor/larksuite-cli/scripts/run.cjs', import.meta.url))
/** Lark integration configuration and user-editable settings. */
export interface Config {
  /** Self-built application id. */
  appId?: string
  /** Product endpoint family. */
  brand?: 'feishu' | 'lark'
  /** Credential reference containing the application secret. */
  appSecretEnv?: string
  /** Maximum duration of one CLI operation. */
  cliTimeoutMs?: number
  /** Per-stream in-memory CLI output limit. */
  maxOutputBytes?: number
  /** Private official-CLI state directory below the Harness home. */
  cliConfigDir?: string
  /** Credential setup mode selected by the management page. */
  credentialMode?: 'none' | 'managed' | 'self-built'
  /** Maximum duration of official managed-app registration. */
  registrationTimeoutMs?: number
  /** Whether private-chat messages should drive durable Harness sessions. */
  conversationEnabled?: boolean
  /** Open ID allowed to use the private-chat bridge. */
  conversationUserOpenId?: string
  /** Maximum duration of the Channel WebSocket handshake. */
  conversationHandshakeTimeoutMs?: number
  /** Maximum duration to wait for one Harness turn response. */
  conversationResponseTimeoutMs?: number
  /** Workspace assigned to newly created private-chat sessions; empty uses the runtime directory. */
  conversationCwd?: string
  /** IANA time zone used to interpret otherwise-unqualified Lark dates and times. */
  conversationTimeZone?: string
}

/** Schemastery configuration for the Lark integration. */
export const Config: z<Config> = z.object({
  appId: z.string().default(''),
  brand: z.union(['feishu', 'lark'] as const).default('feishu'),
  appSecretEnv: z.string().role('credential-ref').default(String(LARK_APP_SECRET_REF)),
  cliTimeoutMs: z.number().step(1).min(1_000).max(300_000).default(30_000),
  maxOutputBytes: z.number().step(1).min(1_024).max(4 * 1024 * 1024).default(256 * 1024),
  cliConfigDir: z.string().default(join(resolveDshHome(), 'lark-cli')),
  credentialMode: z.union(['none', 'managed', 'self-built'] as const).default('none'),
  registrationTimeoutMs: z.number().step(1).min(60_000).max(15 * 60_000).default(10 * 60_000),
  conversationEnabled: z.boolean().default(true),
  conversationUserOpenId: z.string().default(''),
  conversationHandshakeTimeoutMs: z.number().step(1).min(1_000).max(300_000).default(30_000),
  conversationResponseTimeoutMs: z.number().step(1).min(10_000).max(30 * 60_000).default(10 * 60_000),
  conversationCwd: z.string().default(''),
  conversationTimeZone: z.string().default('Asia/Shanghai'),
})

/** Application values accepted from the management page. */
export interface LarkApplicationInput {
  /** Self-built application id. */
  readonly appId: string
  /** Product endpoint family. */
  readonly brand: 'feishu' | 'lark'
  /** Optional replacement secret; omission preserves the current secret. */
  readonly appSecret?: string
}

/** One identity reported by the official CLI. */
export interface LarkIdentityStatus {
  /** CLI identity state. */
  readonly status: string
  /** Whether the identity can currently be used. */
  readonly available: boolean
  /** Server verification result, when verification ran. */
  readonly verified?: boolean
}

/** Runtime state of the private-chat transport. */
export interface LarkConversationStatus {
  /** Current connection phase. */
  readonly status: 'disabled' | 'waiting' | 'connecting' | 'ready' | 'error'
  /** Non-secret explanation when the transport is not ready. */
  readonly diagnostic?: string
}

/** Permission outcome for one management-page capability row. */
export interface LarkCapabilityStatus {
  /** Stable capability id. */
  readonly id: LarkCapabilityId
  /** Chinese label. */
  readonly label: string
  /** Whether every required tenant and user scope is enabled for the application. */
  readonly state: 'granted' | 'missing' | 'unknown'
  /** Required scopes not reported by the application. */
  readonly missingScopes: readonly string[]
}

/** Complete safe-to-display Lark management snapshot. */
export interface LarkManagementStatus {
  /** Configured application id. */
  readonly appId: string
  /** Product endpoint family. */
  readonly brand: 'feishu' | 'lark'
  /** Source of the application credentials used by the official CLI. */
  readonly credentialMode: 'none' | 'managed' | 'self-built'
  /** Whether the application secret resolves. */
  readonly secretConfigured: boolean
  /** Whether the current credential source accepts a replacement. */
  readonly secretWritable: boolean
  /** Whether current-user device authorization is waiting for browser consent. */
  readonly userAuthorizationPending: boolean
  /** Whether the official CLI produced a status response. */
  readonly cliAvailable: boolean
  /** Bot/tenant identity state. */
  readonly bot: LarkIdentityStatus
  /** User OAuth identity state. */
  readonly user: LarkIdentityStatus
  /** Required scopes absent from the current user OAuth token. */
  readonly userAuthorizationMissingScopes: readonly string[]
  /** Private-chat transport state. */
  readonly conversation: LarkConversationStatus
  /** Permission rows in product order. */
  readonly capabilities: readonly LarkCapabilityStatus[]
  /** Batch-import JSON copied by the page without rendering it. */
  readonly permissionTemplate: string
  /** Non-secret diagnostic from the latest inspection failure. */
  readonly diagnostic?: string
}

/** Browser handoff for current-user device authorization. */
export interface LarkUserAuthRequest {
  /** Opaque verification URL opened by the browser. */
  readonly verificationUrl: string
}

/** Browser handoff for official managed PersonalAgent registration. */
export interface LarkManagedRegistrationRequest {
  /** Opaque official registration URL opened by the browser. */
  readonly verificationUrl: string
}

/** Canonical result of one official CLI invocation. */
export interface LarkCliResult {
  /** Exit code, or null when terminated by a signal. */
  readonly exitCode: number | null
  /** Terminating signal, or null on normal exit. */
  readonly signal: string | null
  /** Whether the plugin-owned deadline fired. */
  readonly timedOut: boolean
  /** Captured stdout tail. */
  readonly stdout: string
  /** Captured stderr tail. */
  readonly stderr: string
}

interface JsonRecord { readonly [key: string]: unknown }
interface PendingManagedRegistration {
  readonly controller: AbortController
  readonly verificationUrl: Promise<string>
  readonly result: Promise<RegisterAppResult>
  readonly brand: 'feishu' | 'lark'
  completion: Promise<void> | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Lark/Feishu management Remote service. */
    larkManagement: LarkManagementGateway
  }
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function identity(value: unknown): LarkIdentityStatus {
  const item = record(value)
  const verified = booleanValue(item?.verified)
  return {
    status: stringValue(item?.status) ?? 'unknown',
    available: booleanValue(item?.available) ?? false,
    ...verified === undefined ? {} : { verified },
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Remote service and model-facing tool backed by the official Lark CLI. */
export default class LarkManagementGateway extends TypertRemoteService {
  static inject = [
    'agents', 'agentDefaultModel', 'attachments', 'credentials', 'sessionPersistence',
    'settings', 'subprocess', 'tools', 'workspaceRegistry',
  ]
  private readonly settings: SettingsScope<Config>
  private readonly readOnlyCommandCache = new Map<string, boolean>()
  private pendingRegistration: PendingManagedRegistration | undefined
  private conversation: LarkConversationBridge | undefined
  private conversationState: LarkConversationStatus = { status: 'waiting', diagnostic: '正在读取对话配置。' }
  private conversationRefreshTail: Promise<void> = Promise.resolve()
  private disposed = false

  /** Register the Remote service, settings namespace, tool, and write-approval gate. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'larkManagement')
    this.settings = ctx.settings.register(LARK_SETTINGS_NAMESPACE, Config, { base: config })
    ctx.effect(() => async () => {
      this.disposed = true
      this.pendingRegistration?.controller.abort(new Error('Lark management gateway disposed'))
      await this.conversationRefreshTail
      await this.conversation?.dispose()
      this.conversation = undefined
    })
    this.registerTool(ctx)
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.name !== 'lark_cli') return next()
      const args = record(exec.arguments)?.arguments
      if (Array.isArray(args) && args.every(value => typeof value === 'string')
        && await this.isReadOnlyCommand(normalizeLarkCommand(args))) return next()
      return Promise.resolve({ kind: 'ask', reason: 'This Lark CLI operation may change Lark or Feishu data.' })
    })
    void this.refreshConversation().catch((error: unknown) => {
      this.ctx.logger.warn(`Lark conversation startup failed: ${message(error)}`)
    })
  }

  /** Read credentials, application scopes, and bot/user identity without exposing secret values. */
  @Remote('status')
  async status(): Promise<LarkManagementStatus> {
    const config = this.resolvedConfig()
    const [secret, pendingUserAuthorization] = await Promise.all([
      this.ctx.credentials.describe(credentialRef(config.appSecretEnv)),
      this.resolvePendingUserAuthorization(),
    ])
    const cliConfigured = existsSync(join(config.cliConfigDir, 'config.json'))
    const configuredMode = config.credentialMode === 'none' && cliConfigured
      ? 'managed'
      : config.credentialMode
    const base = {
      appId: config.appId,
      brand: config.brand,
      credentialMode: configuredMode,
      secretConfigured: secret.configured,
      secretWritable: configuredMode !== 'managed' && secret.writable,
      userAuthorizationPending: pendingUserAuthorization !== undefined,
      conversation: this.conversationState,
      permissionTemplate: permissionImportTemplate(),
    } as const
    if (!cliConfigured) {
      return {
        ...base,
        cliAvailable: false,
        bot: { status: 'missing', available: false },
        user: { status: 'missing', available: false },
        userAuthorizationMissingScopes: requestedUserScopes(),
        capabilities: this.capabilityStatus(undefined, undefined),
      }
    }
    const [authResult] = await Promise.allSettled([
      this.runJson(['auth', 'status', '--json', '--verify']),
    ])
    const auth = authResult.status === 'fulfilled' ? record(authResult.value) : undefined
    const appId = stringValue(auth?.appId) ?? config.appId
    const [scopesResult] = await Promise.allSettled([
      appId.length === 0
        ? Promise.reject(new Error('Lark CLI did not report an App ID for permission inspection'))
        : this.runJson([
            'api', 'GET', `/open-apis/application/v6/applications/${encodeURIComponent(appId)}`,
            '--params', '{"lang":"zh_cn"}', '--as', 'bot', '--json',
          ]),
    ])
    const identities = record(auth?.identities)
    const enabledScopes = scopesResult.status === 'fulfilled'
      ? applicationScopeSets(scopesResult.value)
      : undefined
    const diagnostics = [authResult, scopesResult].flatMap(result =>
      result.status === 'rejected' ? [message(result.reason)] : [])
    return {
      ...base,
      appId,
      brand: auth?.brand === 'lark' ? 'lark' : auth?.brand === 'feishu' ? 'feishu' : base.brand,
      cliAvailable: authResult.status === 'fulfilled',
      bot: identity(identities?.bot),
      user: identity(identities?.user),
      userAuthorizationMissingScopes: missingUserAuthorizationScopes(auth, requestedUserScopes()),
      capabilities: this.capabilityStatus(enabledScopes?.tenant, enabledScopes?.user),
      ...diagnostics.length === 0 ? {} : { diagnostic: diagnostics.join(' ') },
    }
  }

  /** Store the application id/brand and optionally replace the write-only secret. */
  @Remote('saveApplication')
  async saveApplication(input: LarkApplicationInput): Promise<void> {
    const appId = input.appId.trim()
    if (appId.length === 0) throw new TypeError('Lark App ID must not be empty')
    const current = this.resolvedConfig()
    const existing = input.appSecret === undefined
      ? await this.ctx.credentials.resolve(LARK_APP_SECRET_REF)
      : undefined
    const appSecret = input.appSecret ?? existing?.value
    if (appSecret === undefined || appSecret.length === 0) {
      throw new TypeError('Lark App Secret is required when no managed secret exists')
    }
    const initialized = await this.runCli([
      'config', 'init', '--app-id', appId, '--app-secret-stdin', '--brand', input.brand,
    ], undefined, `${appSecret}\n`)
    if (initialized.exitCode !== 0) {
      throw new Error(initialized.stderr || initialized.stdout || 'Lark CLI rejected the application credentials')
    }
    await this.settings.update({
      appId,
      brand: input.brand,
      appSecretEnv: String(LARK_APP_SECRET_REF),
      credentialMode: 'self-built',
      conversationUserOpenId: current.appId === appId ? current.conversationUserOpenId : '',
    })
    if (input.appSecret !== undefined) {
      await this.ctx.credentials.set(LARK_APP_SECRET_REF, input.appSecret)
    }
    await this.refreshConversation()
  }

  /** Remove the provider-managed application secret. */
  @Remote('clearSecret')
  async clearSecret(): Promise<void> {
    this.pendingRegistration?.controller.abort(new Error('Lark application disconnected'))
    this.pendingRegistration = undefined
    const removed = await this.runCli(['config', 'remove'])
    if (removed.exitCode !== 0 && !`${removed.stdout}\n${removed.stderr}`.includes('"subtype": "not_configured"')) {
      throw new Error(removed.stderr || removed.stdout || 'Lark CLI configuration removal failed')
    }
    await this.settings.update({ appId: '', credentialMode: 'none', conversationUserOpenId: '' })
    await this.refreshConversation()
    await Promise.all([
      this.ctx.credentials.unset(LARK_APP_SECRET_REF),
      this.ctx.credentials.unset(LARK_PENDING_USER_AUTH_REF),
    ])
  }

  /** Start the official PersonalAgent app-registration flow without requesting a manual secret. */
  @Remote('beginManagedRegistration')
  async beginManagedRegistration(brand: 'feishu' | 'lark'): Promise<LarkManagedRegistrationRequest> {
    if (this.pendingRegistration !== undefined) {
      return { verificationUrl: await this.pendingRegistration.verificationUrl }
    }
    const config = this.resolvedConfig()
    const controller = new AbortController()
    const deadline = AbortSignal.timeout(config.registrationTimeoutMs)
    let resolveUrl!: (url: string) => void
    let rejectUrl!: (error: unknown) => void
    const verificationUrl = new Promise<string>((resolve, reject) => {
      resolveUrl = resolve
      rejectUrl = reject
    })
    const result = registerApp({
      domain: brand === 'lark' ? 'accounts.larksuite.com' : 'accounts.feishu.cn',
      larkDomain: 'accounts.larksuite.com',
      source: 'deepseek-harness',
      signal: AbortSignal.any([controller.signal, deadline]),
      createOnly: true,
      appPreset: {
        name: 'DeepSeek Harness - {user}',
        desc: 'DeepSeek Harness 私聊 Agent',
      },
      addons: {
        scopes: { tenant: requestedTenantScopes(), user: requestedUserScopes() },
        events: { items: { tenant: [...LARK_CONVERSATION_EVENTS] } },
      },
      onQRCodeReady: info => { resolveUrl(info.url) },
    })
    void result.catch((error: unknown) => { rejectUrl(error) })
    const pending = { controller, verificationUrl, result, brand, completion: undefined } satisfies PendingManagedRegistration
    this.pendingRegistration = pending
    // Persist credentials as soon as the official device flow resolves. The
    // confirmation button remains idempotent and only advances to user OAuth.
    void this.finalizeManagedRegistration(pending).catch((error: unknown) => {
      this.ctx.logger.warn(`Managed Lark registration failed: ${message(error)}`)
    })
    try {
      return { verificationUrl: await verificationUrl }
    } catch (error: unknown) {
      if (this.pendingRegistration === pending) this.pendingRegistration = undefined
      throw error
    }
  }

  /** Finish a managed app registration after the user approves the official browser prompt. */
  @Remote('completeManagedRegistration')
  async completeManagedRegistration(): Promise<void> {
    const pending = this.pendingRegistration
    if (pending === undefined) throw new Error('No managed Lark application registration is pending')
    try {
      await this.finalizeManagedRegistration(pending)
    } finally {
      this.pendingRegistration = undefined
    }
  }

  /**
   * Persist credentials returned by the official registration flow exactly once.
   *
   * @param pending - In-memory registration flow owned by this gateway.
   * @returns A promise that settles after the CLI and settings contain the app.
   */
  private finalizeManagedRegistration(pending: PendingManagedRegistration): Promise<void> {
    if (pending.completion !== undefined) return pending.completion
    const completion = this.persistManagedRegistration(pending)
    pending.completion = completion.catch((error: unknown) => {
      pending.completion = undefined
      throw error
    })
    return pending.completion
  }

  private async persistManagedRegistration(pending: PendingManagedRegistration): Promise<void> {
    const registered = await pending.result
    const appId = registered.client_id.trim()
    const appSecret = registered.client_secret
    const brand = registered.user_info?.tenant_brand ?? pending.brand
    if (appId.length === 0 || appSecret.length === 0) {
      throw new Error('Lark managed application registration returned incomplete credentials')
    }
    const previous = await this.ctx.credentials.resolve(LARK_APP_SECRET_REF)
    await this.ctx.credentials.set(LARK_APP_SECRET_REF, appSecret)
    try {
      const initialized = await this.runCli([
        'config', 'init', '--app-id', appId, '--app-secret-stdin', '--brand', brand,
      ], undefined, `${appSecret}\n`)
      if (initialized.exitCode !== 0) {
        throw new Error(initialized.stderr || initialized.stdout || 'Lark CLI rejected managed application credentials')
      }
      await this.settings.update({
        appId,
        brand,
        appSecretEnv: String(LARK_APP_SECRET_REF),
        credentialMode: 'managed',
        conversationUserOpenId: registered.user_info?.open_id ?? '',
      })
    } catch (error: unknown) {
      if (previous === undefined) await this.ctx.credentials.unset(LARK_APP_SECRET_REF)
      else await this.ctx.credentials.set(LARK_APP_SECRET_REF, previous.value)
      throw error
    }
    await this.refreshConversation()
  }

  /** Start user OAuth for the capability scopes represented by the management page. */
  @Remote('beginUserAuth')
  async beginUserAuth(): Promise<LarkUserAuthRequest> {
    const output = record(await this.runJson([
      'auth', 'login', '--scope', requestedUserScopes().join(' '), '--no-wait', '--json',
    ]))
    const verificationUrl = stringValue(output?.verification_url)
    const deviceCode = stringValue(output?.device_code)
    if (verificationUrl === undefined || deviceCode === undefined) {
      throw new Error('Lark CLI did not return a device authorization URL and code')
    }
    await this.ctx.credentials.set(
      LARK_PENDING_USER_AUTH_REF,
      encodePendingUserAuthorization(deviceCode, requestedUserScopes()),
    )
    return { verificationUrl }
  }

  /** Complete the persisted user OAuth request after the user authorizes it. */
  @Remote('completeUserAuth')
  async completeUserAuth(): Promise<void> {
    const pending = await this.resolvePendingUserAuthorization()
    if (pending === undefined) throw new Error('No Lark user authorization is pending')
    const result = await this.runCli(['auth', 'login', '--device-code', pending.deviceCode, '--json'])
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Lark user authorization failed')
    const auth = record(await this.runJson(['auth', 'status', '--json']))
    const openId = authenticatedUserOpenId(auth)
    if (openId === undefined) throw new Error('Lark CLI completed user authorization without reporting an Open ID')
    await this.settings.update({ conversationUserOpenId: openId })
    await this.ctx.credentials.unset(LARK_PENDING_USER_AUTH_REF)
    await this.refreshConversation()
  }

  private async resolvePendingUserAuthorization(): Promise<PendingUserAuthorization | undefined> {
    const stored = await this.ctx.credentials.resolve(LARK_PENDING_USER_AUTH_REF)
    if (stored === undefined) return undefined
    const pending = decodePendingUserAuthorization(stored.value, requestedUserScopes())
    if (pending !== undefined) return pending
    await this.ctx.credentials.unset(LARK_PENDING_USER_AUTH_REF)
    return undefined
  }

  private resolvedConfig(): Required<Config> {
    const current = this.settings.get()
    return {
      appId: current.appId ?? '',
      brand: current.brand ?? 'feishu',
      appSecretEnv: current.appSecretEnv ?? String(LARK_APP_SECRET_REF),
      cliTimeoutMs: current.cliTimeoutMs ?? 30_000,
      maxOutputBytes: current.maxOutputBytes ?? 256 * 1024,
      cliConfigDir: current.cliConfigDir ?? join(resolveDshHome(), 'lark-cli'),
      credentialMode: current.credentialMode ?? 'none',
      registrationTimeoutMs: current.registrationTimeoutMs ?? 10 * 60_000,
      conversationEnabled: current.conversationEnabled ?? true,
      conversationUserOpenId: current.conversationUserOpenId ?? '',
      conversationHandshakeTimeoutMs: current.conversationHandshakeTimeoutMs ?? 30_000,
      conversationResponseTimeoutMs: current.conversationResponseTimeoutMs ?? 10 * 60_000,
      conversationCwd: current.conversationCwd ?? '',
      conversationTimeZone: current.conversationTimeZone ?? 'Asia/Shanghai',
    }
  }

  private refreshConversation(): Promise<void> {
    const refresh = this.conversationRefreshTail.then(async () => { await this.replaceConversation() })
      .catch((error: unknown) => {
        if (!this.disposed) this.conversationState = { status: 'error', diagnostic: message(error) }
        throw error
      })
    this.conversationRefreshTail = refresh.catch(() => {})
    return refresh
  }

  private async replaceConversation(): Promise<void> {
    const previous = this.conversation
    this.conversation = undefined
    if (previous !== undefined) await previous.dispose()
    if (this.disposed) return

    const config = this.resolvedConfig()
    if (!config.conversationEnabled) {
      this.conversationState = { status: 'disabled' }
      return
    }
    if (config.appId.length === 0) {
      this.conversationState = { status: 'waiting', diagnostic: '请先连接飞书应用。' }
      return
    }
    const allowedSenderId = await this.resolveConversationUserOpenId(config)
    if (allowedSenderId === undefined) {
      this.conversationState = { status: 'waiting', diagnostic: '请完成当前用户授权，以限定可发起对话的飞书账号。' }
      return
    }
    const secret = await this.ctx.credentials.resolve(credentialRef(config.appSecretEnv))
    if (secret === undefined) {
      this.conversationState = {
        status: 'waiting',
        diagnostic: config.credentialMode === 'managed'
          ? '当前快速连接缺少 Channel 凭据，请断开后重新连接。'
          : '请配置 App Secret。',
      }
      return
    }

    this.conversationState = { status: 'connecting' }
    const bridge = new LarkConversationBridge(this.ctx, createLarkChannel({
      appId: config.appId,
      appSecret: secret.value,
      domain: config.brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
      source: 'deepseek-harness',
      handshakeTimeoutMs: config.conversationHandshakeTimeoutMs,
      httpTimeoutMs: config.cliTimeoutMs,
      policy: {
        dmMode: 'allowlist',
        dmAllowlist: [allowedSenderId],
      },
    }), {
      appId: config.appId,
      allowedSenderId,
      responseTimeoutMs: config.conversationResponseTimeoutMs,
      cwd: config.conversationCwd.trim() || process.cwd(),
      timeZone: config.conversationTimeZone,
    })
    try {
      await bridge.connect()
      if (this.disposed) {
        await bridge.dispose()
        return
      }
      this.conversation = bridge
      this.conversationState = { status: 'ready' }
    } catch (error: unknown) {
      await bridge.dispose()
      throw error
    }
  }

  private async resolveConversationUserOpenId(config: Required<Config>): Promise<string | undefined> {
    if (config.conversationUserOpenId.length > 0) return config.conversationUserOpenId
    let auth: unknown
    try {
      auth = await this.runJson(['auth', 'status', '--json', '--verify'])
    } catch (_existingAuthorizationUnavailable) {
      return undefined
    }
    const openId = authenticatedUserOpenId(auth)
    if (openId !== undefined) await this.settings.update({ conversationUserOpenId: openId })
    return openId
  }

  private capabilityStatus(
    tenant: ReadonlySet<string> | undefined,
    user: ReadonlySet<string> | undefined,
  ): LarkCapabilityStatus[] {
    return LARK_CAPABILITIES.map(capability => {
      const missingScopes = tenant === undefined || user === undefined
        ? [...new Set([...capability.tenant, ...capability.user])]
        : [...new Set([
            ...capability.tenant.filter(scope => !tenant.has(scope)),
            ...capability.user.filter(scope => !user.has(scope)),
          ])]
      return {
        id: capability.id,
        label: capability.label,
        state: tenant === undefined || user === undefined
          ? 'unknown'
          : missingScopes.length === 0 ? 'granted' : 'missing',
        missingScopes,
      }
    })
  }

  private async runJson(args: readonly string[]): Promise<unknown> {
    const result = await this.runCli(args)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Lark CLI exited with ${String(result.exitCode)}`)
    try {
      return JSON.parse(result.stdout) as unknown
    } catch (error: unknown) {
      throw new Error(`Lark CLI returned invalid JSON: ${message(error)}`)
    }
  }

  private async isReadOnlyCommand(args: readonly string[]): Promise<boolean> {
    if (isDirectReadOnlyCommand(args)) return true
    const helpArgs = commandHelpArguments(args)
    if (helpArgs === undefined) return false
    const cacheKey = helpArgs.slice(0, -1).join('\0')
    const cached = this.readOnlyCommandCache.get(cacheKey)
    if (cached !== undefined) return cached
    try {
      const result = await this.runCli(helpArgs)
      const readOnly = result.exitCode === 0 && helpDeclaresReadOnly(result.stdout, result.stderr)
      this.readOnlyCommandCache.set(cacheKey, readOnly)
      return readOnly
    } catch (_metadataInspectionFailure) {
      return false
    }
  }

  private async runCli(
    args: readonly string[],
    callerSignal?: AbortSignal,
    stdin?: string,
  ): Promise<LarkCliResult> {
    const config = this.resolvedConfig()
    const deadline = AbortSignal.timeout(config.cliTimeoutMs)
    const signal = callerSignal === undefined ? deadline : AbortSignal.any([callerSignal, deadline])
    const handle = this.spawnCli(args, signal, stdin)
    return this.collectCli(handle, () => deadline.aborted && callerSignal?.aborted !== true)
  }

  private spawnCli(args: readonly string[], signal: AbortSignal, stdin?: string): SubprocessHandle {
    const config = this.resolvedConfig()
    return this.ctx.subprocess.spawn({
      argv: [process.execPath, CLI_RUNNER, ...args],
      cwd: process.cwd(),
      stdio: {
        stdin: stdin === undefined ? 'ignore' : { data: stdin },
        stdout: { maxBytes: config.maxOutputBytes },
        stderr: { maxBytes: config.maxOutputBytes },
      },
      graceMs: 2_000,
      signal,
      env: {
        LARKSUITE_CLI_BIN_DIR: join(resolveDshHome(), 'lark-cli-bin', 'v1.0.90'),
        LARKSUITE_CLI_CONFIG_DIR: config.cliConfigDir,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
    })
  }

  private async collectCli(handle: SubprocessHandle, timedOut: boolean | (() => boolean)): Promise<LarkCliResult> {
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: typeof timedOut === 'function' ? timedOut() : timedOut,
      stdout,
      stderr,
    }
  }

  private registerTool(ctx: Context): void {
    ctx.tools.register(defineTool({
      name: 'lark_cli',
      description: 'Run the official Lark/Feishu CLI with the application and user authorization configured in Lark Settings. Pass arguments after `lark-cli` as an array. Read-only status and query operations run directly; data-changing operations require user approval.',
      parameters: {
        arguments: {
          type: 'array',
          required: true,
          description: 'CLI arguments after `lark-cli`, for example ["calendar", "+agenda", "--json"].',
          items: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
            signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            timedOut: { type: 'boolean', required: true },
            stdout: { type: 'string', required: true },
            stderr: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: [value.stdout, value.stderr, value.timedOut ? '[timed out]' : ''].filter(Boolean).join('\n'),
        }],
      },
      timeoutMs: 305_000,
      execute: (args, exec) => this.runCli(normalizeLarkCommand(args.arguments), exec.signal),
      presentCall: args => ({
        card: 'terminal',
        title: `lark-cli ${normalizeLarkCommand(args.arguments).join(' ')}`,
        description: 'Official Lark/Feishu CLI',
      }),
    }))
  }
}
