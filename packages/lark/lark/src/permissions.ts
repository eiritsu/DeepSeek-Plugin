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

const BASE_SCOPES = [
  'base:app:copy', 'base:app:create', 'base:app:read', 'base:app:update',
  'base:field:create', 'base:field:delete', 'base:field:read', 'base:field:update',
  'base:record:create', 'base:record:delete', 'base:record:read', 'base:record:retrieve', 'base:record:update',
  'base:table:create', 'base:table:delete', 'base:table:read', 'base:table:update',
  'base:view:read', 'base:view:write_only',
] as const

const MAIL_SCOPES = [
  'mail:user_mailbox:readonly',
  'mail:user_mailbox.folder:read',
  'mail:user_mailbox.message.address:read',
  'mail:user_mailbox.message.body:read',
  'mail:user_mailbox.message.subject:read',
  'mail:user_mailbox.message:modify',
  'mail:user_mailbox.message:readonly',
] as const

const SLIDES_SCOPES = [
  'slides:presentation:create',
  'slides:presentation:read',
  'slides:presentation:screenshot',
  'slides:presentation:update',
  'slides:presentation:write_only',
] as const

const PERMISSION_INSPECTION_SCOPES = ['application:application:self_manage'] as const

/** Scopes supported by both user and bot identities for meeting/minutes commands. */
const MEETING_SHARED_SCOPES = [
  'vc:meeting',
  'vc:meeting.meetingevent:read',
  'vc:record:readonly',
  'vc:note:read',
  'vc:meeting.bot.join:write',
  'vc:meeting.interaction:write',
  'vc:meeting.message:write',
  'minutes:minutes',
  'minutes:minutes.search:read',
  'minutes:minutes.basic:read',
  'minutes:minutes.artifacts:read',
  'minutes:minutes.media:export',
  'minutes:minutes:readonly',
  'minutes:permission:apply',
] as const

/** Application scopes required by bot-only meeting commands. */
const MEETING_TENANT_SCOPES = [
  ...MEETING_SHARED_SCOPES,
  'vc:meeting.bot.manage:write',
] as const

/** User scopes required by the meeting/minutes commands shipped with the Lark CLI. */
const MEETING_USER_SCOPES = [
  ...MEETING_SHARED_SCOPES,
  'vc:meeting.meetingid:write',
  'vc:meeting.search:read',
  'minutes:minutes.upload:write',
  'minutes:minutes:update',
] as const

/** Tenant scopes required by the private-chat transport. */
export const LARK_CONVERSATION_TENANT_SCOPES = [
  'im:message.p2p_msg:readonly',
  'im:message:send_as_bot',
  'im:resource',
] as const

/** Event subscriptions required by the private-chat transport. */
export const LARK_CONVERSATION_EVENTS = ['im.message.receive_v1'] as const

const IM_TENANT_SCOPES = [
  'im:chat',
  'im:chat:read',
  'im:message',
  'im:message.reactions:read',
  'im:message:readonly',
  ...LARK_CONVERSATION_TENANT_SCOPES,
] as const

const IM_USER_SCOPES = [
  'im:chat',
  'im:chat:read',
  'im:message',
  'im:message.group_msg:get_as_user',
  'im:message.p2p_msg:get_as_user',
  'im:message.reactions:read',
  'im:message.send_as_user',
  'im:message:readonly',
  'search:message',
] as const

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
  {
    id: 'calendar',
    label: '日历',
    tenant: ['calendar:calendar'],
    user: ['calendar:calendar', 'calendar:calendar.event:read'],
  },
  { id: 'im', label: '即时通讯', tenant: IM_TENANT_SCOPES, user: IM_USER_SCOPES },
  { id: 'docs', label: '云文档', tenant: ['docx:document', 'docs:document.media:upload'], user: ['docx:document', 'docs:document.media:upload'] },
  { id: 'drive', label: '云空间', tenant: ['drive:drive', 'drive:file'], user: ['drive:drive', 'drive:file'] },
  { id: 'markdown', label: 'Markdown', tenant: ['drive:file'], user: ['drive:file'] },
  { id: 'base', label: '多维表格', tenant: BASE_SCOPES, user: BASE_SCOPES },
  { id: 'sheets', label: '电子表格', tenant: ['sheets:spreadsheet'], user: ['sheets:spreadsheet'] },
  { id: 'slides', label: '幻灯片', tenant: SLIDES_SCOPES, user: SLIDES_SCOPES },
  { id: 'task', label: '任务', tenant: ['task:task'], user: ['task:task'] },
  { id: 'wiki', label: '知识库', tenant: ['wiki:wiki'], user: ['wiki:wiki'] },
  { id: 'contact', label: '通讯录', tenant: ['contact:user.employee:readonly'], user: ['contact:user.base:readonly'] },
  { id: 'mail', label: '邮箱', tenant: MAIL_SCOPES, user: [...MAIL_SCOPES, 'mail:event', 'mail:user_mailbox.message:send'] },
  { id: 'meeting', label: '视频会议', tenant: MEETING_TENANT_SCOPES, user: MEETING_USER_SCOPES },
  { id: 'attendance', label: '考勤打卡', tenant: ['attendance:task:readonly'], user: ['attendance:task:readonly'] },
  { id: 'approval', label: '审批', tenant: [], user: ['approval:approval:read', 'approval:instance:read', 'approval:instance:write', 'approval:task:read', 'approval:task:write'] },
  { id: 'okr', label: 'OKR', tenant: ['okr:okr'], user: ['okr:okr'] },
  { id: 'apps', label: '妙搭应用', tenant: [], user: ['spark:app:read', 'spark:app:write', 'spark:directory.user.id_convert:read'] },
]

/** Import payload accepted by the Feishu/Lark permission batch-import dialog. */
export function permissionImportTemplate(): string {
  return JSON.stringify({
    scopes: {
      tenant: requestedTenantScopes(),
      user: requestedUserScopes(),
    },
  }, null, 2)
}

/** Complete tenant-scope set requested by managed registration and the import template. */
export function requestedTenantScopes(): string[] {
  return [...new Set([
    ...PERMISSION_INSPECTION_SCOPES,
    ...LARK_CAPABILITIES.flatMap(capability => capability.tenant),
  ])].sort()
}

/** Complete user-scope set requested by the management page's OAuth flow. */
export function requestedUserScopes(): string[] {
  return [...new Set(LARK_CAPABILITIES.flatMap(capability => capability.user))].sort()
}
