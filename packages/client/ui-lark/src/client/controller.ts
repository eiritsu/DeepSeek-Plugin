/** Reactive state and Remote actions for the Lark management page. */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { LarkManagementStatus } from '@deepseek-ai/dsh-lark'
import { openVerificationUrl } from './external-link.ts'

type LarkRemote = ClientRemote['larkManagement']

/** Browser state consumed by the Lark Settings page. */
export interface LarkManagementState {
  /** Current request phase. */
  status: 'loading' | 'ready' | 'error'
  /** Latest Host snapshot. */
  value?: LarkManagementStatus
  /** Operation currently running. */
  busy?: 'save' | 'refresh' | 'copy' | 'begin-registration' | 'complete-registration' | 'begin-auth' | 'complete-auth' | 'clear-secret'
  /** Latest user-visible outcome. */
  outcome?: 'saved' | 'copied' | 'authorized' | 'error'
  /** Current-user authorization is waiting for browser consent. */
  authPending: boolean
  /** Official PersonalAgent app registration is waiting for browser approval. */
  registrationPending: boolean
}

/** Own Remote calls and immutable snapshots for the Lark section. */
export class LarkManagementController {
  /** Current management state. */
  readonly store: SnapshotStore<LarkManagementState> = createSnapshotStore({
    status: 'loading',
    authPending: false,
    registrationPending: false,
  })
  /** Bind the generated Remote namespace. */
  constructor(
    private readonly remote: LarkRemote,
    private readonly openUrl: (url: string) => void = openVerificationUrl,
  ) {}

  /** Refresh credentials, identity, and permissions. */
  async refresh(): Promise<void> {
    this.begin('refresh')
    try {
      const result = await this.remote.status()
      if (!result.ok) throw new Error(result.error.message)
      this.store.update((draft) => {
        draft.status = 'ready'
        draft.value = result.value
        draft.authPending = result.value.userAuthorizationPending
      })
    } catch (_statusFailure) {
      this.store.update((draft) => { draft.status = 'error'; draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  /** Save application values; an empty secret preserves the existing one. */
  async save(appId: string, brand: 'feishu' | 'lark', appSecret: string): Promise<void> {
    this.begin('save')
    try {
      const result = await this.remote.saveApplication({
        appId,
        brand,
        ...appSecret.length === 0 ? {} : { appSecret },
      })
      if (!result.ok) throw new Error(result.error.message)
      this.store.update((draft) => { draft.outcome = 'saved' })
      await this.refreshValue()
    } catch (_saveFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  /** Remove the managed App Secret. */
  async clearSecret(): Promise<void> {
    this.begin('clear-secret')
    try {
      const result = await this.remote.clearSecret()
      if (!result.ok) throw new Error(result.error.message)
      await this.refreshValue()
    } catch (_clearFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  /** Start official PersonalAgent registration and open its opaque verification URL. */
  async beginManagedRegistration(brand: 'feishu' | 'lark'): Promise<void> {
    this.begin('begin-registration')
    try {
      const result = await this.remote.beginManagedRegistration(brand)
      if (!result.ok) throw new Error(result.error.message)
      this.openUrl(result.value.verificationUrl)
      this.store.update((draft) => { draft.registrationPending = true })
    } catch (_registrationFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  /** Complete application registration, then continue into current-user OAuth. */
  async completeManagedRegistration(): Promise<void> {
    this.begin('complete-registration')
    try {
      const result = await this.remote.completeManagedRegistration()
      if (!result.ok) throw new Error(result.error.message)
      const authorization = await this.remote.beginUserAuth()
      if (!authorization.ok) throw new Error(authorization.error.message)
      this.openUrl(authorization.value.verificationUrl)
      this.store.update((draft) => {
        draft.registrationPending = false
        draft.authPending = true
        draft.outcome = 'saved'
      })
      await this.refreshValue()
    } catch (_registrationFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  /** Copy the import template without rendering its JSON. */
  async copyPermissions(): Promise<void> {
    const template = this.store.getSnapshot().value?.permissionTemplate
    if (template === undefined) return
    this.begin('copy')
    try {
      await navigator.clipboard.writeText(template)
      this.store.update((draft) => { draft.outcome = 'copied' })
    } catch (_clipboardFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  /** Start device authorization and open the exact verification URL. */
  async beginUserAuth(): Promise<void> {
    this.begin('begin-auth')
    try {
      const result = await this.remote.beginUserAuth()
      if (!result.ok) throw new Error(result.error.message)
      this.openUrl(result.value.verificationUrl)
      this.store.update((draft) => { draft.authPending = true })
    } catch (_authFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  /** Complete device authorization after the user confirms consent. */
  async completeUserAuth(): Promise<void> {
    this.begin('complete-auth')
    try {
      const result = await this.remote.completeUserAuth()
      if (!result.ok) throw new Error(result.error.message)
      this.store.update((draft) => { draft.authPending = false; draft.outcome = 'authorized' })
      await this.refreshValue()
    } catch (_authFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.finish()
    }
  }

  private begin(busy: NonNullable<LarkManagementState['busy']>): void {
    this.store.update((draft) => { draft.busy = busy; delete draft.outcome })
  }

  private finish(): void {
    this.store.update((draft) => { delete draft.busy })
  }

  private async refreshValue(): Promise<void> {
    const result = await this.remote.status()
    if (!result.ok) throw new Error(result.error.message)
    this.store.update((draft) => {
      draft.status = 'ready'
      draft.value = result.value
      draft.authPending = result.value.userAuthorizationPending
    })
  }
}
