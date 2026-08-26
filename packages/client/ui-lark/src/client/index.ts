/** Lark management Settings section registration. */

import TYPERT_REMOTE from '@deepseek-ai/dsh-lark/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { LarkManagementController } from './controller.ts'
import { LarkManagementSection, type LarkManagementSectionInjected } from './LarkManagementSection.tsx'
import { en, zh, type LarkLocaleKey } from './locales.ts'

export type { LarkManagementState } from './controller.ts'
export type { LarkManagementSectionInjected, LarkManagementSectionProps } from './LarkManagementSection.tsx'
export type { LarkLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Lark/Feishu management copy. */
    'settings.lark': LarkLocaleKey
  }
}

/** Required browser service used to mount this package's generated contribution. */
export const inject = ['remote']

/** Mount the generated Lark Remote contribution and register its Settings page. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const surface = ctx.inject(
    ['slots', 'locale', 'remote', 'remote.larkManagement'],
    (surfaceCtx: ClientContext) => {
      const controller = new LarkManagementController(surfaceCtx.remote.larkManagement)
      surfaceCtx.effect(() => surfaceCtx.locale.register('settings.lark', { zh, en }), 'ui-lark: dictionaries')
      const injected = (): LarkManagementSectionInjected => ({
        controller,
        hooks: { larkManagement: controller.store },
      })
      const t = surfaceCtx.locale.bind('settings.lark')
      surfaceCtx.slots.inject('settings.section', () => surfaceCtx.slots.register({
        name: 'settings.section',
        id: 'lark-management',
        order: 46,
        label: () => t('nav'),
        locale: 'settings.lark',
        inject: injected,
      }, LarkManagementSection))
    },
  )
  try {
    await surface
  } catch (error: unknown) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await surface.dispose()
    await disposeRemote()
  }
}
