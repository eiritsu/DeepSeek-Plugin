import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeepseekFilesLocaleKey } from './locales.ts'
import type {
  DeepseekFilesSettingsController, DeepseekFilesSettingsState, RecognitionKind,
} from './controller.ts'
import css from './DeepseekFilesSection.module.css'

/** Registration-side face for the Deepseek-Files settings section. */
export interface DeepseekFilesSectionInjected {
  controller: DeepseekFilesSettingsController
  hooks: { deepseekFiles: DeepseekFilesSettingsController['store'] }
}

/** Full section props assembled by the Settings slot renderer. */
export type DeepseekFilesSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.deepseekFiles'>
  & InjectFace<DeepseekFilesSectionInjected>

const META = {
  ocr: ['ocrTitle', 'ocrDescription'],
  audioTranscription: ['audioTitle', 'audioDescription'],
  videoUnderstanding: ['videoTitle', 'videoDescription'],
} as const satisfies Record<RecognitionKind, readonly [DeepseekFilesLocaleKey, DeepseekFilesLocaleKey]>

function ProviderCard(props: {
  kind: RecognitionKind
  state: DeepseekFilesSettingsState
  t: DeepseekFilesSectionProps['t']
  controller: DeepseekFilesSettingsController
}): ReactNode {
  const { kind, state, t, controller } = props
  const configured = state.value[kind]
  const [endpoint, setEndpoint] = useState(configured?.endpoint ?? '')
  const [model, setModel] = useState(configured?.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [titleKey, descriptionKey] = META[kind]
  const credential = state.credentials[kind]

  useEffect(() => {
    setEndpoint(configured?.endpoint ?? '')
    setModel(configured?.model ?? '')
  }, [configured?.endpoint, configured?.model])

  return (
    <section className={css.card}>
      <div className={css.cardHeading}>
        <div>
          <h2>{t(titleKey)}</h2>
          <p>{t(descriptionKey)}</p>
        </div>
        <span data-configured={credential.configured}>{credential.configured ? t('keyConfigured') : t('keyMissing')}</span>
      </div>
      <label>
        <span>{t('model')}</span>
        <input value={model} placeholder={t('modelPlaceholder')} disabled={!state.writable} onChange={(event) => { setModel(event.currentTarget.value) }} />
      </label>
      <label>
        <span>{t('endpoint')}</span>
        <input type="url" value={endpoint} placeholder={t('endpointPlaceholder')} disabled={!state.writable} onChange={(event) => { setEndpoint(event.currentTarget.value) }} />
      </label>
      <label>
        <span>{t('apiKey')}</span>
        <input type="password" value={apiKey} autoComplete="new-password" placeholder={t('apiKeyPlaceholder')} disabled={!credential.writable} onChange={(event) => { setApiKey(event.currentTarget.value) }} />
      </label>
      {!credential.writable ? <p className={css.readOnly}>{t('keyReadOnly')}</p> : null}
      <div className={css.actions}>
        {credential.configured && credential.writable ? (
          <button type="button" className={css.secondary} onClick={() => { void controller.removeKey(kind) }}>{t('removeKey')}</button>
        ) : null}
        <button
          type="button"
          disabled={!state.writable || state.busy !== undefined}
          onClick={() => {
            void controller.save(kind, endpoint, model, apiKey).then(() => { setApiKey('') })
          }}
        >
          {state.busy === kind ? t('saving') : t('save')}
        </button>
      </div>
    </section>
  )
}

/** Render the Deepseek-Files Settings page. */
export function DeepseekFilesSection({ useDeepseekFiles, controller, t }: DeepseekFilesSectionProps): ReactNode {
  const state = useDeepseekFiles(value => value)

  useEffect(() => { void controller.loadCredentials() }, [controller])

  if (state.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (state.status === 'unavailable') return <p className={css.status}>{t('unavailable')}</p>
  return (
    <div className={css.page}>
      <header>
        <h1>{t('title')}</h1>
        <p>{t('intro')}</p>
      </header>
      {!state.writable ? <p className={css.readOnly}>{t('readOnly')}</p> : null}
      {(Object.keys(META) as RecognitionKind[]).map(kind => (
        <ProviderCard key={kind} kind={kind} state={state} t={t} controller={controller} />
      ))}
      {state.outcome === 'saved' ? <p className={css.outcome} role="status">{t('saved')}</p> : null}
      {state.outcome === 'error' ? <p className={css.error} role="alert">{t('saveFailed')}</p> : null}
    </div>
  )
}
