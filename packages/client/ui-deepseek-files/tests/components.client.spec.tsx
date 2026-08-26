// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepseekFilesSection } from '../src/client/DeepseekFilesSection.tsx'
import type { DeepseekFilesSectionProps } from '../src/client/DeepseekFilesSection.tsx'
import type { DeepseekFilesSettingsState } from '../src/client/controller.ts'
import { en, type DeepseekFilesLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: DeepseekFilesLocaleKey): string => en[key]) as DeepseekFilesSectionProps['t']

const READY: DeepseekFilesSettingsState = {
  status: 'ready',
  writable: true,
  value: {
    ocr: { endpoint: 'https://ocr.test/v1/chat/completions', model: 'ocr-old' },
  },
  credentials: {
    ocr: { configured: true, writable: true },
    audioTranscription: { configured: false, writable: true },
    videoUnderstanding: { configured: false, writable: true },
  },
}

function props(state: DeepseekFilesSettingsState) {
  const controller = {
    loadCredentials: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
    removeKey: vi.fn(() => Promise.resolve()),
  }
  return {
    value: {
      t,
      controller,
      useDeepseekFiles: ((selector: (value: DeepseekFilesSettingsState) => unknown) => selector(state)),
    } as unknown as DeepseekFilesSectionProps,
    controller,
  }
}

describe('DeepseekFilesSection', () => {
  it('edits the three recognition providers without exposing a stored key', async () => {
    const fixture = props(READY)
    render(<DeepseekFilesSection {...fixture.value} />)

    expect(screen.getByRole('heading', { name: 'Deepseek-Files' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.ocrTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.audioTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.videoTitle })).toBeTruthy()
    expect(screen.getByText(en.keyConfigured)).toBeTruthy()
    expect(screen.getAllByPlaceholderText(en.apiKeyPlaceholder)).toHaveLength(3)

    const models = screen.getAllByLabelText(en.model)
    const endpoints = screen.getAllByLabelText(en.endpoint)
    const keys = screen.getAllByLabelText(en.apiKey)
    fireEvent.change(models[0]!, { target: { value: 'ocr-next' } })
    fireEvent.change(endpoints[0]!, { target: { value: 'https://next.test/v1/chat/completions' } })
    fireEvent.change(keys[0]!, { target: { value: 'secret-next' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.save })[0]!)

    await waitFor(() => {
      expect(fixture.controller.save).toHaveBeenCalledWith(
        'ocr',
        'https://next.test/v1/chat/completions',
        'ocr-next',
        'secret-next',
      )
    })
    fireEvent.click(screen.getByRole('button', { name: en.removeKey }))
    expect(fixture.controller.removeKey).toHaveBeenCalledWith('ocr')
  })

  it('renders loading, unavailable, and read-only states', () => {
    const loading = props({ ...READY, status: 'loading' })
    const view = render(<DeepseekFilesSection {...loading.value} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    view.rerender(<DeepseekFilesSection {...props({ ...READY, status: 'unavailable' }).value} />)
    expect(screen.getByText(en.unavailable)).toBeTruthy()

    view.rerender(<DeepseekFilesSection {...props({ ...READY, writable: false }).value} />)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.save })[0]?.hasAttribute('disabled')).toBe(true)
  })
})
