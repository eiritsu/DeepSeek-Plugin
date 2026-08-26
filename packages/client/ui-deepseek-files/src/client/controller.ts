/** Settings and credential state for the Deepseek-Files section. */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Recognition provider identities shown by the Settings page. */
export type RecognitionKind = 'ocr' | 'audioTranscription' | 'videoUnderstanding'

/** One endpoint section mirrored from Host settings. */
export interface RecognitionEndpointSettings {
  /** Complete provider request URL. */
  endpoint?: string
  /** Provider model identifier. */
  model?: string
  /** Credential reference stored instead of a secret literal. */
  apiKeyEnv?: string
}

/** Settings namespace value owned by the Host recognizer. */
export interface DeepseekFilesSettings {
  /** OCR provider configuration. */
  ocr?: RecognitionEndpointSettings
  /** Audio transcription provider configuration. */
  audioTranscription?: RecognitionEndpointSettings
  /** Video understanding provider configuration. */
  videoUnderstanding?: RecognitionEndpointSettings
}

interface CredentialState {
  configured: boolean
  writable: boolean
}

/** Reactive projection consumed by the Deepseek-Files Settings page. */
export interface DeepseekFilesSettingsState {
  /** Settings namespace availability. */
  status: 'loading' | 'unavailable' | 'ready'
  /** Whether the settings document accepts writes. */
  writable: boolean
  /** Current resolved provider settings. */
  value: DeepseekFilesSettings
  /** Secret presence and source writability by provider. */
  credentials: Record<RecognitionKind, CredentialState>
  /** Provider currently saving. */
  busy?: RecognitionKind
  /** Latest explicit write result. */
  outcome?: 'saved' | 'error'
}

/** Managed credential reference for each recognition provider. */
export const CREDENTIAL_REFS: Record<RecognitionKind, string> = {
  ocr: 'DEEPSEEK_FILES_OCR_API_KEY',
  audioTranscription: 'DEEPSEEK_FILES_AUDIO_API_KEY',
  videoUnderstanding: 'DEEPSEEK_FILES_VIDEO_API_KEY',
}

const emptyCredential = (): CredentialState => ({ configured: false, writable: true })

/** Own the section's settings scope and credential projections. */
export class DeepseekFilesSettingsController {
  /** Current settings, credential metadata, and write state. */
  readonly store: SnapshotStore<DeepseekFilesSettingsState> = createSnapshotStore({
    status: 'loading',
    writable: false,
    value: {},
    credentials: {
      ocr: emptyCredential(),
      audioTranscription: emptyCredential(),
      videoUnderstanding: emptyCredential(),
    },
  })
  private readonly unsubscribe: () => void

  /**
   * @param scope - Bound Deepseek-Files settings namespace.
   * @param api - Credential wire face.
   */
  constructor(
    private readonly scope: SettingsScope<DeepseekFilesSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.unsubscribe = scope.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Load credential presence without exposing values. */
  async loadCredentials(): Promise<void> {
    const refs = Object.values(CREDENTIAL_REFS)
    const response = await this.api.credentials.describe({ refs })
    if (!response.result.ok) return
    const credentials = response.result.value.credentials
    this.store.update((draft) => {
      for (const kind of Object.keys(CREDENTIAL_REFS) as RecognitionKind[]) {
        const credential = credentials[CREDENTIAL_REFS[kind]]
        draft.credentials[kind] = {
          configured: credential?.configured ?? false,
          writable: credential?.writable ?? true,
        }
      }
    })
  }

  /**
   * Save one provider's endpoint/model and an optional replacement key.
   * @param kind - Provider section to update.
   * @param endpoint - Complete provider request URL.
   * @param model - Provider model identifier.
   * @param apiKey - Optional replacement secret; empty preserves the stored value.
   */
  async save(kind: RecognitionKind, endpoint: string, model: string, apiKey: string): Promise<void> {
    this.store.update((draft) => {
      draft.busy = kind
      delete draft.outcome
    })
    try {
      await this.scope.set(kind, {
        endpoint: endpoint.trim(),
        model: model.trim(),
        apiKeyEnv: CREDENTIAL_REFS[kind],
      })
      const accepted = this.scope.getSnapshot().value?.[kind]
      if (accepted?.endpoint !== endpoint.trim() || accepted.model !== model.trim()) {
        throw new Error('settings write was not accepted')
      }
      if (apiKey.length > 0) await this.api.credentials.set({ ref: CREDENTIAL_REFS[kind], value: apiKey })
      await this.loadCredentials()
      if (apiKey.length > 0 && !this.store.getSnapshot().credentials[kind].configured) {
        throw new Error('credential write was not accepted')
      }
      this.store.update((draft) => { draft.outcome = 'saved' })
    } catch (_writeFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    } finally {
      this.store.update((draft) => { delete draft.busy })
    }
  }

  /**
   * Remove one provider's managed API key.
   * @param kind - Provider whose credential should be removed.
   */
  async removeKey(kind: RecognitionKind): Promise<void> {
    try {
      await this.api.credentials.unset({ ref: CREDENTIAL_REFS[kind] })
      await this.loadCredentials()
    } catch (_writeFailure) {
      this.store.update((draft) => { draft.outcome = 'error' })
    }
  }

  /**
   * Refresh only when the changed credential belongs to this section.
   * @param ref - Credential reference announced by the Host.
   */
  refreshCredential(ref: string): void {
    if (!Object.values(CREDENTIAL_REFS).includes(ref)) return
    void this.loadCredentials()
  }

  /** Release the settings subscription. */
  dispose(): void {
    this.unsubscribe()
  }

  private adopt(): void {
    const snapshot = this.scope.getSnapshot()
    this.store.update((draft) => {
      draft.status = snapshot.status
      draft.writable = snapshot.writable
      if (snapshot.value !== undefined) draft.value = snapshot.value
    })
  }
}
