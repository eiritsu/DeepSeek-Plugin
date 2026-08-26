/** Sidebar footer action that opens the desktop plugin library. */

import { useSyncExternalStore } from 'react'
import { IconCordisPluginOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginLibraryController } from './controller.ts'
import css from './PluginLibraryTrigger.module.css'

/** Controller supplied by the package registration. */
export interface PluginLibraryTriggerInjected {
  /** Shared visibility controller for the shell overlay. */
  readonly controller: PluginLibraryController
}

/** Full props composed by the sidebar footer-action slot. */
export type PluginLibraryTriggerProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'pluginLibrary'>
  & InjectFace<PluginLibraryTriggerInjected>

/** Render one additive footer row without changing sidebar-owned chrome. */
export function PluginLibraryTrigger({ wide, controller, t }: PluginLibraryTriggerProps) {
  const open = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return (
    <div className={wide ? css.root : `${css.root} ${css.rail}`}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('trigger')}
        aria-expanded={open}
        data-plugin-library-trigger
        data-active={open || undefined}
        onClick={() => { controller.show() }}
      >
        <IconCordisPluginOutline14 size={wide ? 16 : 18} />
        {wide && <span>{t('trigger')}</span>}
      </button>
    </div>
  )
}
