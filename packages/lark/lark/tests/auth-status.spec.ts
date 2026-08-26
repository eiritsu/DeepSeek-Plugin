import { describe, expect, it } from 'vitest'
import { authenticatedUserOpenId } from '../src/auth-status.ts'

describe('authenticatedUserOpenId', () => {
  it('reads an available verified user identity', () => {
    expect(authenticatedUserOpenId({
      identities: {
        user: { status: 'ready', available: true, verified: true, openId: 'ou_authorized' },
      },
    })).toBe('ou_authorized')
  })

  it('accepts a freshly authorized identity before verification is reported', () => {
    expect(authenticatedUserOpenId({
      identities: {
        user: { status: 'ready', available: true, openId: 'ou_authorized' },
      },
    })).toBe('ou_authorized')
  })

  it.each([
    undefined,
    {},
    { identities: { user: { available: false, verified: true, openId: 'ou_stale' } } },
    { identities: { user: { available: true, verified: false, openId: 'ou_unverified' } } },
    { identities: { user: { available: true, verified: true, openId: '' } } },
  ])('rejects an unusable identity %#', (status) => {
    expect(authenticatedUserOpenId(status)).toBeUndefined()
  })
})
