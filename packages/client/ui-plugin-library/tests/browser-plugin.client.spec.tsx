// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginLibraryOverlay } from '../src/client/PluginLibraryOverlay.tsx'
import { PluginLibraryTrigger } from '../src/client/PluginLibraryTrigger.tsx'
import type { DesktopPluginBridge } from '../src/client/bridge.ts'

const bridge = {
  request: async () => ({ plugins: [] }),
} as unknown as DesktopPluginBridge

afterEach(() => {
  delete window.dshDesktopPluginBridge
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, locale }
}

describe('desktop plugin-library registration', () => {
  it('declares only the standard extension services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('adds nothing to a normal browser', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('adds one footer icon and one frame overlay when the native bridge exists', async () => {
    window.dshDesktopPluginBridge = bridge
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const trigger = b.slots.entries('sidebar.footer.action')[0]!
    const overlay = b.slots.entries('shell.overlay')[0]!
    expect(trigger.component).toBe(PluginLibraryTrigger)
    expect(overlay.component).toBe(PluginLibraryOverlay)
    expect(trigger.options).toMatchObject({ id: 'plugin-library', order: 90 })
    expect(overlay.options).toMatchObject({ id: 'plugin-library', order: 90 })
    expect(trigger.locale).toBe(NS)
    expect(overlay.locale).toBe(NS)
    expect((trigger.inject as () => { controller: unknown })().controller)
      .toBe((overlay.inject as () => { controller: unknown })().controller)

    await fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
