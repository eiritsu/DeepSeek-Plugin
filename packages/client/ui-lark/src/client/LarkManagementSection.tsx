import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LarkManagementController } from './controller.ts'
import css from './LarkManagementSection.module.css'

/** Registration-side business face for the Lark section. */
export interface LarkManagementSectionInjected {
  controller: LarkManagementController
  hooks: { larkManagement: LarkManagementController['store'] }
}

/** Props assembled by the Settings slot renderer. */
export type LarkManagementSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.lark'>
  & InjectFace<LarkManagementSectionInjected>

function identityLabel(
  item: { available: boolean; verified?: boolean },
  t: LarkManagementSectionProps['t'],
  missingScopes: readonly string[] = [],
): string {
  if (item.verified === false) return t('verifyFailed')
  if (missingScopes.length > 0) return t('reauthorizationRequired')
  return item.available ? t('ready') : t('unavailable')
}

function conversationLabel(
  status: 'disabled' | 'waiting' | 'connecting' | 'ready' | 'error',
  t: LarkManagementSectionProps['t'],
): string {
  switch (status) {
    case 'disabled': return t('conversationDisabled')
    case 'waiting': return t('conversationWaiting')
    case 'connecting': return t('conversationConnecting')
    case 'ready': return t('ready')
    case 'error': return t('conversationError')
  }
}

/** Render application credentials, identity, and permission capability rows. */
export function LarkManagementSection({ useLarkManagement, controller, t }: LarkManagementSectionProps): ReactNode {
  const state = useLarkManagement(value => value)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [brand, setBrand] = useState<'feishu' | 'lark'>('feishu')
  const value = state.value

  useEffect(() => { void controller.refresh() }, [controller])
  useEffect(() => {
    if (value === undefined) return
    setAppId(value.appId)
    setBrand(value.brand)
  }, [value?.appId, value?.brand])
  useEffect(() => {
    if (!state.registrationPending) return
    const timer = window.setInterval(() => { void controller.refresh() }, 2_000)
    return () => { window.clearInterval(timer) }
  }, [controller, state.registrationPending])

  if (state.status === 'loading' && value === undefined) return <p className={css.status}>{t('loading')}</p>
  if (state.status === 'error' && value === undefined) return <p className={css.error}>{t('loadFailed')}</p>

  return (
    <div className={css.page}>
      <header>
        <h1>{t('title')}</h1>
        <p>{t('intro')}</p>
      </header>
      <section className={css.card}>
        <div className={css.heading}>
          <div><h2>{t('quickConnect')}</h2><p>{t('quickConnectIntro')}</p></div>
          <span data-ok={value?.credentialMode === 'managed'}>{value?.credentialMode === 'managed' ? t('managedConnected') : t('recommended')}</span>
        </div>
        <label><span>{t('brand')}</span><select value={brand} onChange={(event) => { setBrand(event.currentTarget.value as 'feishu' | 'lark') }}><option value="feishu">{t('feishu')}</option><option value="lark">{t('lark')}</option></select></label>
        <div className={css.actions}>
          {value?.credentialMode === 'managed' ? <button className={css.secondary} type="button" disabled={state.busy !== undefined} onClick={() => { void controller.clearSecret() }}>{t('disconnect')}</button> : null}
          {state.registrationPending
            ? <button type="button" disabled={state.busy !== undefined} onClick={() => { void controller.completeManagedRegistration() }}>{state.busy === 'complete-registration' ? t('completingRegistration') : t('completeRegistration')}</button>
            : <button type="button" disabled={state.busy !== undefined} onClick={() => { void controller.beginManagedRegistration(brand) }}>{state.busy === 'begin-registration' ? t('startingRegistration') : t('startRegistration')}</button>}
        </div>
      </section>
      <section className={css.card}>
        <div className={css.heading}>
          <div><h2>{t('application')}</h2><p>{t('customApplicationIntro')}</p></div>
          <span data-ok={value?.secretConfigured === true}>{value?.secretConfigured === true ? t('secretConfigured') : t('secretMissing')}</span>
        </div>
        <label><span>{t('brand')}</span><select value={brand} onChange={(event) => { setBrand(event.currentTarget.value as 'feishu' | 'lark') }}><option value="feishu">{t('feishu')}</option><option value="lark">{t('lark')}</option></select></label>
        <label><span>{t('appId')}</span><input value={appId} placeholder={t('appIdPlaceholder')} onChange={(event) => { setAppId(event.currentTarget.value) }} /></label>
        <label><span>{t('appSecret')}</span><input type="password" autoComplete="new-password" value={appSecret} placeholder={t('appSecretPlaceholder')} disabled={value?.secretWritable === false} onChange={(event) => { setAppSecret(event.currentTarget.value) }} /></label>
        {value?.secretWritable === false ? <p className={css.muted}>{t('secretReadOnly')}</p> : null}
        <div className={css.actions}>
          {value?.secretConfigured === true && value.secretWritable ? <button className={css.secondary} type="button" onClick={() => { void controller.clearSecret() }}>{t('clearSecret')}</button> : null}
          <button type="button" disabled={state.busy !== undefined || appId.trim().length === 0} onClick={() => { void controller.save(appId, brand, appSecret).then(() => { setAppSecret('') }) }}>{state.busy === 'save' ? t('saving') : t('save')}</button>
        </div>
      </section>
      <section className={css.card}>
        <h2>{t('identity')}</h2>
        <ol className={css.identitySteps}>
          <li>
            <span className={css.stepNumber}>1</span>
            <div><strong>{t('botIdentity')}</strong><p>{t('botIdentityIntro')}</p></div>
            <strong className={css.identityStatus} data-ok={value?.bot.available === true}>{value === undefined ? t('unknown') : identityLabel(value.bot, t)}</strong>
          </li>
          <li>
            <span className={css.stepNumber}>2</span>
            <div><strong>{t('userIdentity')}</strong><p>{t('userIdentityIntro')}</p>{value?.secretConfigured !== true ? <p className={css.blockedHint}>{t('userAuthBlocked')}</p> : null}{value !== undefined && value.userAuthorizationMissingScopes.length > 0 && value.user.available ? <p className={css.blockedHint}>{t('missingUserScopes')} <code>{value.userAuthorizationMissingScopes.join(', ')}</code></p> : null}</div>
            <div className={css.stepAction}>
              <strong className={css.identityStatus} data-ok={value?.user.available === true && value.userAuthorizationMissingScopes.length === 0}>{value === undefined ? t('unknown') : identityLabel(value.user, t, value.userAuthorizationMissingScopes)}</strong>
              {state.authPending ? <button type="button" disabled={state.busy !== undefined} onClick={() => { void controller.completeUserAuth() }}>{state.busy === 'complete-auth' ? t('completingAuth') : t('completeAuth')}</button> : <button type="button" disabled={state.busy !== undefined || value?.secretConfigured !== true} onClick={() => { void controller.beginUserAuth() }}>{state.busy === 'begin-auth' ? t('authorizing') : value !== undefined && value.userAuthorizationMissingScopes.length > 0 && value.user.available ? t('reauthorize') : t('authorize')}</button>}
            </div>
          </li>
          <li>
            <span className={css.stepNumber}>3</span>
            <div>
              <strong>{t('conversationIdentity')}</strong>
              <p>{t('conversationIdentityIntro')}</p>
              {value?.conversation.diagnostic !== undefined ? <p className={css.blockedHint}>{value.conversation.diagnostic}</p> : null}
            </div>
            <strong className={css.identityStatus} data-ok={value?.conversation.status === 'ready'}>{value === undefined ? t('unknown') : conversationLabel(value.conversation.status, t)}</strong>
          </li>
        </ol>
      </section>
      <section className={css.card}>
        <div className={css.heading}><div><h2>{t('permissions')}</h2><p>{t('permissionsIntro')}</p></div><button className={css.secondary} type="button" disabled={state.busy !== undefined || value === undefined} onClick={() => { void controller.copyPermissions() }}>{t('copyPermissions')}</button></div>
        <div className={css.permissions}>
          {value?.capabilities.map(capability => <div key={capability.id}><span>{capability.label}</span><strong data-state={capability.state}>{t(capability.state)}</strong></div>)}
        </div>
        <div className={css.actions}><button className={css.secondary} type="button" disabled={state.busy !== undefined} onClick={() => { void controller.refresh() }}>{t('refresh')}</button></div>
      </section>
      {value?.diagnostic !== undefined ? <details className={css.diagnostic}><summary>{t('diagnostic')}</summary><p>{value.diagnostic}</p></details> : null}
      {state.outcome === 'saved' ? <p className={css.success}>{t('saved')}</p> : null}
      {state.outcome === 'copied' ? <p className={css.success}>{t('copied')}</p> : null}
      {state.outcome === 'authorized' ? <p className={css.success}>{t('authorized')}</p> : null}
      {state.outcome === 'error' ? <p className={css.error}>{t('operationFailed')}{state.errorMessage === undefined ? null : <><br /><code>{state.errorMessage}</code></>}</p> : null}
    </div>
  )
}
