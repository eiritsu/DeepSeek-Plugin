import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { DeepseekFilesSection } from '../src/client/DeepseekFilesSection.tsx'
import type { DeepseekFilesSettings } from '../src/client/controller.ts'

class RemoteService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remote')
  }

  $on(): () => void {
    return () => {}
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  new RemoteService(ctx)
  const scope: SettingsScope<DeepseekFilesSettings> = {
    getSnapshot: () => ({
      status: 'ready', value: {}, base: undefined, user: undefined,
      revision: 0, writable: true, mode: 'host',
    }),
    subscribe: () => () => {},
    set: () => Promise.resolve(),
    unset: () => Promise.resolve(),
  }
  ctx.provide('settingsScope', { bind: () => scope })
  ctx.provide('connection', { api: { credentials: {
    describe: vi.fn(() => Promise.resolve({ result: { ok: true, value: { credentials: {} } } })),
    set: vi.fn(),
    unset: vi.fn(),
  } } })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, locale }
}

describe('ui-deepseek-files browser plugin', () => {
  it('declares the settings and credential services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers and releases one localized Settings section', async () => {
    const test = await bench()
    const fiber = test.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = test.slots.entries('settings.section').find(candidate => candidate.options.id === 'deepseek-files')
    expect(entry?.component).toBe(DeepseekFilesSection)
    expect(resolveSlotLabel(entry?.options.label)).toBe('Deepseek-Files')
    test.locale.setLocale('en')
    expect(resolveSlotLabel(entry?.options.label)).toBe('Deepseek-Files')

    await fiber.dispose()
    expect(test.slots.entries('settings.section').some(candidate => candidate.options.id === 'deepseek-files')).toBe(false)
    await test.ctx.fiber.dispose()
  })
})
