/** Deepseek-Files Settings section registration. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DeepseekFilesSettingsController } from './controller.ts'
import type { DeepseekFilesSettings } from './controller.ts'
import { DeepseekFilesSection } from './DeepseekFilesSection.tsx'
import type { DeepseekFilesSectionInjected } from './DeepseekFilesSection.tsx'
import { en, zh, type DeepseekFilesLocaleKey } from './locales.ts'

export type { DeepseekFilesSettings, DeepseekFilesSettingsState, RecognitionKind } from './controller.ts'
export type { DeepseekFilesSectionInjected, DeepseekFilesSectionProps } from './DeepseekFilesSection.tsx'
export type { DeepseekFilesLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Deepseek-Files provider settings copy. */
    'settings.deepseekFiles': DeepseekFilesLocaleKey
  }
}

/** Required browser services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/** Register the Deepseek-Files Settings page. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<DeepseekFilesSettings>({ namespace: 'file-recognizer-office' })
  const controller = new DeepseekFilesSettingsController(scope, connection.api)
  ctx.effect(() => ctx.locale.register('settings.deepseekFiles', { zh, en }), 'ui-deepseek-files: dictionaries')
  ctx.effect(() => {
    const dispose = ctx.remote.$on('credentials/reference-updated', (ref) => { controller.refreshCredential(ref) })
    return () => {
      dispose()
      controller.dispose()
    }
  }, 'ui-deepseek-files: credential refresh')
  const injected = (): DeepseekFilesSectionInjected => ({
    controller,
    hooks: { deepseekFiles: controller.store },
  })
  const t = ctx.locale.bind('settings.deepseekFiles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'deepseek-files',
    order: 45,
    label: () => t('nav'),
    locale: 'settings.deepseekFiles',
    inject: injected,
  }, DeepseekFilesSection))
}
