import { describe, expect, it } from 'vitest'
import {
  applicationScopeSets,
  LARK_CAPABILITIES,
  LARK_CONVERSATION_EVENTS,
  LARK_CONVERSATION_TENANT_SCOPES,
  permissionImportTemplate,
  requestedTenantScopes,
  requestedUserScopes,
} from '../src/permissions.ts'

describe('Lark permission import template', () => {
  it('covers every capability with stable unique tenant and user scopes', () => {
    const parsed = JSON.parse(permissionImportTemplate()) as {
      scopes: { tenant: string[]; user: string[] }
    }
    expect(requestedTenantScopes()).toEqual(parsed.scopes.tenant)
    expect(LARK_CAPABILITIES).toHaveLength(17)
    expect(new Set(parsed.scopes.tenant).size).toBe(parsed.scopes.tenant.length)
    expect(new Set(parsed.scopes.user).size).toBe(parsed.scopes.user.length)
    for (const capability of LARK_CAPABILITIES) {
      expect(capability.tenant.length + capability.user.length).toBeGreaterThan(0)
      expect(capability.tenant.every(scope => parsed.scopes.tenant.includes(scope))).toBe(true)
      expect(capability.user.every(scope => parsed.scopes.user.includes(scope))).toBe(true)
    }
    expect(requestedUserScopes()).toEqual(parsed.scopes.user)
    expect(parsed.scopes.tenant).not.toContain('calendar:calendar.event:read')
    expect(parsed.scopes.user).toContain('calendar:calendar.event:read')
    expect(parsed.scopes.tenant).toEqual(expect.arrayContaining([
      'im:chat:read',
      'im:message.reactions:read',
      'im:message.p2p_msg:readonly',
      'im:message:readonly',
      'im:message:send_as_bot',
      'im:resource',
    ]))
    expect(parsed.scopes.user).toEqual(expect.arrayContaining([
      'im:chat:read',
      'im:message.group_msg:get_as_user',
      'im:message.p2p_msg:get_as_user',
      'im:message.reactions:read',
      'im:message:readonly',
      'search:message',
    ]))
  })

  it('declares the tenant scopes and event needed by the private-chat channel', () => {
    const parsed = JSON.parse(permissionImportTemplate()) as {
      scopes: { tenant: string[] }
    }
    expect(parsed.scopes.tenant).toEqual(expect.arrayContaining([...LARK_CONVERSATION_TENANT_SCOPES]))
    expect(LARK_CONVERSATION_EVENTS).toEqual(['im.message.receive_v1'])
  })

  it('contains permission names only and no credential fields', () => {
    const template = permissionImportTemplate()
    expect(template).not.toContain('secret')
    expect(template).not.toContain('appId')
    expect(template).not.toContain('token')
  })

  it('copies a human-readable JSON document accepted by the batch-import editor', () => {
    const template = permissionImportTemplate()
    expect(template).toMatch(/^\{\n  "scopes": \{\n    "tenant": \[\n/)
    expect(template).toContain('\n    "user": [\n')
    expect(template).toMatch(/\n  \}\n\}$/)
    expect(template.split('\n').length).toBeGreaterThan(10)
  })

  it('uses current Open Platform scopes under their supported identity types', () => {
    const parsed = JSON.parse(permissionImportTemplate()) as {
      scopes: { tenant: string[]; user: string[] }
    }
    const removedScopes = [
      'application:application:readonly',
      'base:app',
      'base:field',
      'base:record',
      'base:table',
      'base:view',
      'mail:user_mailbox.message',
      'slides:slides',
    ]
    expect(parsed.scopes.tenant).not.toEqual(expect.arrayContaining(removedScopes))
    expect(parsed.scopes.user).not.toEqual(expect.arrayContaining(removedScopes))
    expect(parsed.scopes.tenant).not.toEqual(expect.arrayContaining([
      'approval:instance:read',
      'approval:task:read',
      'mail:event',
      'mail:user_mailbox.message:send',
      'spark:app:read',
      'spark:app:write',
    ]))
    expect(parsed.scopes.user).toEqual(expect.arrayContaining([
      'approval:approval:read',
      'approval:instance:read',
      'approval:instance:write',
      'approval:task:read',
      'approval:task:write',
      'mail:user_mailbox.message:send',
      'spark:app:read',
      'spark:app:write',
    ]))
    expect(parsed.scopes.tenant).toEqual(expect.arrayContaining([
      'application:application:self_manage',
      'base:app:read',
      'base:record:retrieve',
      'slides:presentation:read',
    ]))
    expect(parsed.scopes.tenant).not.toContain('admin:app.info:readonly')
    expect(parsed.scopes.user).not.toContain('application:application:self_manage')
  })

  it('separates tenant and user application scopes from the official API envelope', () => {
    const scopes = applicationScopeSets({
      ok: true,
      data: {
        app: {
          scopes: [
            { scope: 'im:message', token_types: ['tenant', 'user'] },
            { scope: 'im:message:send_as_bot', token_types: ['tenant'] },
            { scope: 'calendar:calendar', token_types: ['user'] },
          ],
        },
      },
    })
    expect([...scopes.tenant]).toEqual(['im:message', 'im:message:send_as_bot'])
    expect([...scopes.user]).toEqual(['im:message', 'calendar:calendar'])
    expect(() => applicationScopeSets({ ok: true, data: {} })).toThrow(/scopes array/)
  })
})
