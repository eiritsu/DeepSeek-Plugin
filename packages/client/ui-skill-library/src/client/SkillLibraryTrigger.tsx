/** Sidebar footer action that opens the SkillHub marketplace. */

import { useSyncExternalStore } from 'react'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillLibraryController } from './controller.ts'
import css from './SkillLibraryTrigger.module.css'

export interface SkillLibraryTriggerInjected { readonly controller: SkillLibraryController }
export type SkillLibraryTriggerProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'skillLibrary'> & InjectFace<SkillLibraryTriggerInjected>

/** Render the additive SkillHub sidebar entry. */
export function SkillLibraryTrigger({ wide, controller, t }: SkillLibraryTriggerProps) {
  const open = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return <div className={wide ? css.root : `${css.root} ${css.rail}`}>
    <button type="button" className={css.trigger} aria-label={t('trigger')} aria-expanded={open} data-skill-library-trigger data-active={open || undefined} onClick={() => { controller.show() }}>
      <IconSkillOutline16 size={wide ? 16 : 18} />{wide && <span>{t('trigger')}</span>}
    </button>
  </div>
}
