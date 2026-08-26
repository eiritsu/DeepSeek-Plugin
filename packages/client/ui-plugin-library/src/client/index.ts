/** Desktop-only external plugin library mounted through existing shell slots. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PluginLibraryController } from './controller.ts'
import { PluginLibraryOverlay, type PluginLibraryOverlayInjected } from './PluginLibraryOverlay.tsx'
import { PluginLibraryTrigger, type PluginLibraryTriggerInjected } from './PluginLibraryTrigger.tsx'
import { en, zh, type PluginLibraryLocaleKey } from './locales.ts'

export type { DesktopPluginBridge, InstalledPlugin, PluginAuditRecord, PluginReviewReport } from './bridge.ts'
export type { PluginLibraryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-only external plugin library. */
    'pluginLibrary': PluginLibraryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginLibrary'

/** Required services for the two existing shell slots and localized copy. */
export const inject = ['slots', 'locale']

/** Register nothing in a normal browser; the desktop bridge is the capability signal. */
export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktopPluginBridge
  if (bridge === undefined) return

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plugin-library: dictionaries')
  const controller = new PluginLibraryController()

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'plugin-library',
    order: 90,
    locale: NS,
    inject: (): PluginLibraryTriggerInjected => ({ controller }),
  }, PluginLibraryTrigger))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'plugin-library',
    order: 90,
    locale: NS,
    inject: (): PluginLibraryOverlayInjected => ({ bridge, controller }),
  }, PluginLibraryOverlay))
}
