import { describe, expect, it } from 'vitest'
import {
  decodePendingUserAuthorization,
  encodePendingUserAuthorization,
} from '../src/pending-user-auth.ts'

describe('Lark pending current-user authorization', () => {
  it('restores a device code only for the exact requested scopes', () => {
    const stored = encodePendingUserAuthorization('device-code', ['calendar:calendar', 'im:chat:read'])

    expect(decodePendingUserAuthorization(stored, ['calendar:calendar', 'im:chat:read']))
      .toEqual({ deviceCode: 'device-code', scopes: ['calendar:calendar', 'im:chat:read'] })
    expect(decodePendingUserAuthorization(stored, ['calendar:calendar', 'im:chat:read', 'im:message:readonly']))
      .toBeUndefined()
  })

  it('rejects malformed and legacy pending values', () => {
    expect(decodePendingUserAuthorization('device-code', [])).toBeUndefined()
    expect(decodePendingUserAuthorization('{"deviceCode":"","scopes":[]}', [])).toBeUndefined()
    expect(decodePendingUserAuthorization('{"deviceCode":"code","scopes":[1]}', [])).toBeUndefined()
    expect(() => encodePendingUserAuthorization('', [])).toThrow(/must not be empty/)
  })
})
