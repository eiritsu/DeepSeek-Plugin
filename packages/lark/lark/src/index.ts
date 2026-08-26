/** Host integration for Lark/Feishu credentials, permissions, OAuth, and CLI tools. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { defineTool, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { applicationScopeSets, LARK_CAPABILITIES, permissionImportTemplate, requestedUserScopes } from './permissions.ts'
import type { LarkCapabilityId } from './permissions.ts'

export type { LarkCapabilityDefinition, LarkCapabilityId } from './permissions.ts'
export { applicationScopeSets, LARK_CAPABILITIES, permissionImportTemplate, requestedUserScopes } from './permissions.ts'

/** Credential reference managed by the Lark Settings page. */
export const LARK_APP_SECRET_REF = credentialRef('LARKSUITE_CLI_APP_SECRET')
/** Settings namespace bound by the browser plugin. */
export const LARK_SETTINGS_NAMESPACE = settingsNamespace('lark')

const CLI_RUNNER = fileURLToPath(new URL('../vendor/larksuite-cli/scripts/run.cjs', import.meta.url))
const READ_ONLY_COMMANDS = new Set([
  'api GET', 'auth status', 'auth scopes', 'auth list', 'doctor', 'skills list', 'skills read',
])

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
  /** Whether the official CLI produced a status response. */
  readonly cliAvailable: boolean
  /** Bot/tenant identity state. */
  readonly bot: LarkIdentityStatus
  /** User OAuth identity state. */
  readonly user: LarkIdentityStatus
  /** Permission rows in product order. */
  readonly capabilities: readonly LarkCapabilityStatus[]
  /** Batch-import JSON copied by the page without rendering it. */
  readonly permissionTemplate: string
  /** Non-secret diagnostic from the latest inspection failure. */
  readonly diagnostic?: string
}

/** Device authorization values returned by the official CLI. */
export interface LarkUserAuthRequest {
  /** Opaque verification URL opened by the browser. */
  readonly verificationUrl: string
  /** Opaque code used to complete polling after user consent. */
  readonly deviceCode: string
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
  readonly handle: SubprocessHandle
  readonly verificationUrl: string
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

function commandKey(args: readonly string[]): string {
  return args.slice(0, 2).join(' ')
}

/** Remote service and model-facing tool backed by the official Lark CLI. */
export default class LarkManagementGateway extends TypertRemoteService {
  static inject = ['credentials', 'settings', 'subprocess', 'tools']
  private readonly settings: SettingsScope<Config>
  private pendingRegistration: PendingManagedRegistration | undefined

  /** Register the Remote service, settings namespace, tool, and write-approval gate. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'larkManagement')
    this.settings = ctx.settings.register(LARK_SETTINGS_NAMESPACE, Config, { base: config })
    ctx.effect(() => () => { this.pendingRegistration?.handle.terminate() })
    this.registerTool(ctx)
    ctx.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => {
      if (exec.name !== 'lark_cli') return next()
      const args = record(exec.arguments)?.arguments
      if (Array.isArray(args) && args.every(value => typeof value === 'string')
        && READ_ONLY_COMMANDS.has(commandKey(args))) return next()
      return Promise.resolve({ kind: 'ask', reason: 'This Lark CLI operation may change Lark or Feishu data.' })
    })
  }

  /** Read credentials, application scopes, and bot/user identity without exposing secret values. */
  @Remote('status')
  async status(): Promise<LarkManagementStatus> {
    const config = this.resolvedConfig()
    const secret = await this.ctx.credentials.describe(credentialRef(config.appSecretEnv))
    const cliConfigured = existsSync(join(config.cliConfigDir, 'config.json'))
    const configuredMode = config.credentialMode === 'none' && cliConfigured
      ? 'managed'
      : config.credentialMode
    const base = {
      appId: config.appId,
      brand: config.brand,
      credentialMode: configuredMode,
      secretConfigured: configuredMode === 'managed' ? cliConfigured : secret.configured,
      secretWritable: configuredMode !== 'managed' && secret.writable,
      permissionTemplate: permissionImportTemplate(),
    } as const
    if (!cliConfigured) {
      return {
        ...base,
        cliAvailable: false,
        bot: { status: 'missing', available: false },
        user: { status: 'missing', available: false },
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
      capabilities: this.capabilityStatus(enabledScopes?.tenant, enabledScopes?.user),
      ...diagnostics.length === 0 ? {} : { diagnostic: diagnostics.join(' ') },
    }
  }

  /** Store the application id/brand and optionally replace the write-only secret. */
  @Remote('saveApplication')
  async saveApplication(input: LarkApplicationInput): Promise<void> {
    const appId = input.appId.trim()
    if (appId.length === 0) throw new TypeError('Lark App ID must not be empty')
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
    })
    if (input.appSecret !== undefined) {
      await this.ctx.credentials.set(LARK_APP_SECRET_REF, input.appSecret)
    }
  }

  /** Remove the provider-managed application secret. */
  @Remote('clearSecret')
  async clearSecret(): Promise<void> {
    const removed = await this.runCli(['config', 'remove'])
    if (removed.exitCode !== 0 && !`${removed.stdout}\n${removed.stderr}`.includes('"subtype": "not_configured"')) {
      throw new Error(removed.stderr || removed.stdout || 'Lark CLI configuration removal failed')
    }
    await this.ctx.credentials.unset(LARK_APP_SECRET_REF)
    await this.settings.update({ appId: '', credentialMode: 'none' })
  }

  /** Start the official PersonalAgent app-registration flow without requesting a manual secret. */
  @Remote('beginManagedRegistration')
  async beginManagedRegistration(brand: 'feishu' | 'lark'): Promise<LarkManagedRegistrationRequest> {
    if (this.pendingRegistration !== undefined) {
      return { verificationUrl: this.pendingRegistration.verificationUrl }
    }
    const config = this.resolvedConfig()
    const deadline = AbortSignal.timeout(config.registrationTimeoutMs)
    const handle = this.spawnCli(['config', 'init', '--new', '--brand', brand], deadline)
    const verificationUrl = await this.waitForRegistrationUrl(handle)
    this.pendingRegistration = { handle, verificationUrl }
    return { verificationUrl }
  }

  /** Finish a managed app registration after the user approves the official browser prompt. */
  @Remote('completeManagedRegistration')
  async completeManagedRegistration(): Promise<void> {
    const pending = this.pendingRegistration
    if (pending === undefined) throw new Error('No managed Lark application registration is pending')
    try {
      const result = await this.collectCli(pending.handle, false)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'Lark managed application registration failed')
      }
      const auth = record(await this.runJson(['auth', 'status', '--json']))
      const appId = stringValue(auth?.appId)
      const brand = auth?.brand === 'lark' ? 'lark' : 'feishu'
      if (appId === undefined) throw new Error('Lark CLI registered an application without reporting its App ID')
      await this.settings.update({ appId, brand, credentialMode: 'managed' })
      await this.ctx.credentials.unset(LARK_APP_SECRET_REF)
    } finally {
      this.pendingRegistration = undefined
    }
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
    return { verificationUrl, deviceCode }
  }

  /** Complete a previously started user OAuth request after the user authorizes it. */
  @Remote('completeUserAuth')
  async completeUserAuth(deviceCode: string): Promise<void> {
    if (deviceCode.length === 0) throw new TypeError('device code must not be empty')
    const result = await this.runCli(['auth', 'login', '--device-code', deviceCode, '--json'])
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Lark user authorization failed')
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
    }
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

  private async waitForRegistrationUrl(handle: SubprocessHandle): Promise<string> {
    let output = ''
    let offset = 0
    while (true) {
      const read = handle.collected.stderr?.readFrom(offset)
      if (read !== undefined) {
        offset = read.nextOffset
        output = `${output}${read.text}`.slice(-256 * 1024)
        const match = output.match(/https:\/\/(?:open\.feishu\.cn|open\.larksuite\.com)\/page\/cli\?[^\s]+/)
        if (match !== null) return match[0]
      }
      const state = await Promise.race([
        handle.done.then(() => 'done' as const),
        new Promise<'waiting'>(resolve => { setTimeout(() => { resolve('waiting') }, 100) }),
      ])
      if (state === 'done') {
        const result = await this.collectCli(handle, false)
        throw new Error(result.stderr || result.stdout || 'Lark CLI did not return an app-registration URL')
      }
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
          description: 'CLI arguments after `lark-cli`, for example ["calendar", "+event-list", "--json"].',
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
      execute: (args, exec) => this.runCli(args.arguments, exec.signal),
      presentCall: args => ({
        card: 'terminal',
        title: `lark-cli ${args.arguments.join(' ')}`,
        description: 'Official Lark/Feishu CLI',
      }),
    }))
  }
}
