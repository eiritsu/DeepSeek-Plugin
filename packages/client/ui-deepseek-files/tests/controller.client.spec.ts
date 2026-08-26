import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { CREDENTIAL_REFS, DeepseekFilesSettingsController } from '../src/client/controller.ts'
import type { DeepseekFilesSettings } from '../src/client/controller.ts'

function fixture() {
  let snapshot: SettingsScopeSnapshot<DeepseekFilesSettings> = {
    status: 'ready',
    value: {},
    base: undefined,
    user: undefined,
    revision: 0,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: string, value: unknown) => {
    snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } }
    for (const listener of listeners) listener()
  })
  const scope: SettingsScope<DeepseekFilesSettings> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset: vi.fn(() => Promise.resolve()),
  }
  const describe = vi.fn(async () => ({ result: { ok: true as const, value: { credentials: {
    [CREDENTIAL_REFS.ocr]: { configured: true, writable: true },
  } } } }))
  const credentials = {
    describe,
    set: vi.fn(() => Promise.resolve({ result: { ok: true as const, value: {} } })),
    unset: vi.fn(() => Promise.resolve({ result: { ok: true as const, value: {} } })),
  }
  const controller = new DeepseekFilesSettingsController(scope, { credentials } as never)
  return { controller, credentials, set, listeners }
}

describe('DeepseekFilesSettingsController', () => {
  it('writes settings and credentials through their separate owners', async () => {
    const test = fixture()
    await test.controller.save('ocr', ' https://ocr.test/v1 ', ' model-1 ', 'key-1')

    expect(test.set).toHaveBeenCalledWith('ocr', {
      endpoint: 'https://ocr.test/v1',
      model: 'model-1',
      apiKeyEnv: CREDENTIAL_REFS.ocr,
    })
    expect(test.credentials.set).toHaveBeenCalledWith({ ref: CREDENTIAL_REFS.ocr, value: 'key-1' })
    expect(test.controller.store.getSnapshot()).toMatchObject({ outcome: 'saved' })
    expect(test.controller.store.getSnapshot()).not.toHaveProperty('busy')

    await test.controller.removeKey('ocr')
    expect(test.credentials.unset).toHaveBeenCalledWith({ ref: CREDENTIAL_REFS.ocr })
    test.controller.dispose()
    expect(test.listeners.size).toBe(0)
  })

  it('ignores unrelated credential invalidations', () => {
    const test = fixture()
    test.controller.refreshCredential('UNRELATED_API_KEY')
    expect(test.credentials.describe).not.toHaveBeenCalled()
    test.controller.refreshCredential(CREDENTIAL_REFS.videoUnderstanding)
    expect(test.credentials.describe).toHaveBeenCalledOnce()
  })
})
