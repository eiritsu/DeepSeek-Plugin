/** Desktop SkillHub marketplace mounted through the existing shell slots. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SkillLibraryController } from './controller.ts'
import { SkillLibraryOverlay, type SkillLibraryOverlayInjected } from './SkillLibraryOverlay.tsx'
import { SkillLibraryTrigger, type SkillLibraryTriggerInjected } from './SkillLibraryTrigger.tsx'
import { en, zh, type SkillLibraryLocaleKey } from './locales.ts'

declare global {
  interface Window { dshDesktopPluginBridge?: unknown }
}

export type { SkillHubPackage, SkillHubSkill } from './api.ts'
export type { SkillLibraryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** SkillHub marketplace copy. */ 'skillLibrary': SkillLibraryLocaleKey }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'skillLibrary'
/** Required services for the sidebar and shell overlay slots. */
export const inject = ['slots', 'locale']

/** Register the SkillHub marketplace only when the desktop bridge is present. */
export function apply(ctx: ClientContext): void {
  if (window.dshDesktopPluginBridge === undefined) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill-library: dictionaries')
  const controller = new SkillLibraryController()
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'skill-library', order: 80, locale: NS, inject: (): SkillLibraryTriggerInjected => ({ controller }) }, SkillLibraryTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'skill-library', order: 80, locale: NS, inject: (): SkillLibraryOverlayInjected => ({ controller }) }, SkillLibraryOverlay))
}
