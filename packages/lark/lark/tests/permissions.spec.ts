import { describe, expect, it } from 'vitest'
import { applicationScopeSets, LARK_CAPABILITIES, permissionImportTemplate, requestedUserScopes } from '../src/permissions.ts'

describe('Lark permission import template', () => {
  it('covers every capability with stable unique tenant and user scopes', () => {
    const parsed = JSON.parse(permissionImportTemplate()) as {
      scopes: { tenant: string[]; user: string[] }
    }
    expect(LARK_CAPABILITIES).toHaveLength(17)
    expect(new Set(parsed.scopes.tenant).size).toBe(parsed.scopes.tenant.length)
    expect(new Set(parsed.scopes.user).size).toBe(parsed.scopes.user.length)
    for (const capability of LARK_CAPABILITIES) {
      expect(capability.tenant.length).toBeGreaterThan(0)
      expect(capability.user.length).toBeGreaterThan(0)
      expect(capability.tenant.every(scope => parsed.scopes.tenant.includes(scope))).toBe(true)
      expect(capability.user.every(scope => parsed.scopes.user.includes(scope))).toBe(true)
    }
    expect(requestedUserScopes()).toEqual(parsed.scopes.user)
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
