/** Lark capability groups and their importable permission template. */

/** Stable capability identifier rendered by the management page. */
export type LarkCapabilityId =
  | 'calendar' | 'im' | 'docs' | 'drive' | 'markdown' | 'base' | 'sheets' | 'slides'
  | 'task' | 'wiki' | 'contact' | 'mail' | 'meeting' | 'attendance' | 'approval' | 'okr' | 'apps'

/** Required application and user scopes for one capability group. */
export interface LarkCapabilityDefinition {
  /** Stable identifier. */
  readonly id: LarkCapabilityId
  /** Chinese product label. */
  readonly label: string
  /** Application scopes imported under the tenant token type. */
  readonly tenant: readonly string[]
  /** Scopes imported under the user token type and requested during OAuth. */
  readonly user: readonly string[]
}

/** Enabled application scopes split by the token types reported by Open Platform. */
export interface LarkApplicationScopeSets {
  /** Scopes enabled for tenant access tokens. */
  readonly tenant: ReadonlySet<string>
  /** Scopes enabled for user access tokens. */
  readonly user: ReadonlySet<string>
}

/**
 * Parse the official CLI raw application-info success envelope.
 * @param value - JSON emitted by `lark-cli api GET application/v6/applications/:app_id`.
 * @returns Enabled tenant and user scope sets.
 */
export function applicationScopeSets(value: unknown): LarkApplicationScopeSets {
  const envelope = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  const data = typeof envelope?.data === 'object' && envelope.data !== null
    ? envelope.data as Record<string, unknown>
    : undefined
  const app = typeof data?.app === 'object' && data.app !== null
    ? data.app as Record<string, unknown>
    : undefined
  if (!Array.isArray(app?.scopes)) throw new TypeError('Lark application info did not contain a scopes array')
  const tenant = new Set<string>()
  const user = new Set<string>()
  for (const value of app.scopes) {
    if (typeof value !== 'object' || value === null) continue
    const item = value as Record<string, unknown>
    if (typeof item.scope !== 'string' || !Array.isArray(item.token_types)) continue
    if (item.token_types.includes('tenant')) tenant.add(item.scope)
    if (item.token_types.includes('user')) user.add(item.scope)
  }
  return { tenant, user }
}

/** Minimum scopes for the Lark CLI capabilities exposed by this bundle. */
export const LARK_CAPABILITIES: readonly LarkCapabilityDefinition[] = [
  { id: 'calendar', label: '日历', tenant: ['calendar:calendar'], user: ['calendar:calendar'] },
  { id: 'im', label: '即时通讯', tenant: ['im:chat', 'im:message', 'im:message:send_as_bot'], user: ['im:chat', 'im:message'] },
  { id: 'docs', label: '云文档', tenant: ['docx:document', 'docs:document.media:upload'], user: ['docx:document', 'docs:document.media:upload'] },
  { id: 'drive', label: '云空间', tenant: ['drive:drive', 'drive:file'], user: ['drive:drive', 'drive:file'] },
  { id: 'markdown', label: 'Markdown', tenant: ['drive:file'], user: ['drive:file'] },
  { id: 'base', label: '多维表格', tenant: ['base:app', 'base:table', 'base:field', 'base:record', 'base:view'], user: ['base:app', 'base:table', 'base:field', 'base:record', 'base:view'] },
  { id: 'sheets', label: '电子表格', tenant: ['sheets:spreadsheet'], user: ['sheets:spreadsheet'] },
  { id: 'slides', label: '幻灯片', tenant: ['slides:slides'], user: ['slides:slides'] },
  { id: 'task', label: '任务', tenant: ['task:task'], user: ['task:task'] },
  { id: 'wiki', label: '知识库', tenant: ['wiki:wiki'], user: ['wiki:wiki'] },
  { id: 'contact', label: '通讯录', tenant: ['contact:user.employee:readonly'], user: ['contact:user.base:readonly'] },
  { id: 'mail', label: '邮箱', tenant: ['mail:user_mailbox.message'], user: ['mail:user_mailbox.message'] },
  { id: 'meeting', label: '视频会议', tenant: ['vc:meeting', 'minutes:minutes'], user: ['vc:meeting', 'minutes:minutes'] },
  { id: 'attendance', label: '考勤打卡', tenant: ['attendance:task:readonly'], user: ['attendance:task:readonly'] },
  { id: 'approval', label: '审批', tenant: ['approval:instance:read', 'approval:task:read'], user: ['approval:instance:read', 'approval:task:read'] },
  { id: 'okr', label: 'OKR', tenant: ['okr:okr'], user: ['okr:okr'] },
  { id: 'apps', label: '应用', tenant: ['application:application:readonly'], user: ['application:application:readonly'] },
]

/** Import payload accepted by the Feishu/Lark permission batch-import dialog. */
export function permissionImportTemplate(): string {
  const unique = (values: readonly string[]): string[] => [...new Set(values)].sort()
  return JSON.stringify({
    scopes: {
      tenant: unique(LARK_CAPABILITIES.flatMap(capability => capability.tenant)),
      user: unique(LARK_CAPABILITIES.flatMap(capability => capability.user)),
    },
  }, null, 2)
}

/** Complete user-scope set requested by the management page's OAuth flow. */
export function requestedUserScopes(): string[] {
  return [...new Set(LARK_CAPABILITIES.flatMap(capability => capability.user))].sort()
}
