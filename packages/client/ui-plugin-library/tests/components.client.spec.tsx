// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginLibraryController } from '../src/client/controller.ts'
import { PluginLibraryOverlay, type PluginLibraryOverlayProps } from '../src/client/PluginLibraryOverlay.tsx'
import type { DesktopPluginBridge, PluginBridgeRequest } from '../src/client/bridge.ts'
import { en, type PluginLibraryLocaleKey, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginLibraryLocaleKey, values?: Readonly<Record<string, unknown>>): string => {
  let text = en[key]
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replace(`{${name}}`, String(value))
  }
  return text
}) as PluginLibraryOverlayProps['t']

const zhT = ((key: PluginLibraryLocaleKey, values?: Readonly<Record<string, unknown>>): string => {
  let text = zh[key]
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replace(`{${name}}`, String(value))
  }
  return text
}) as PluginLibraryOverlayProps['t']

function makeBridge(options: { readonly riskyReview?: boolean } = {}) {
  const request = vi.fn(async (input: PluginBridgeRequest) => {
    switch (input.action) {
      case 'list': return { plugins: [{
        name: '@fixture/dsh-plugin',
        displayName: 'Fixture plugin',
        version: '1.2.3',
        latestVersion: '1.3.0',
        removable: true,
      }, {
        name: '@deepseek-ai/dsh-file-recognizer-office',
        displayName: 'Deepseek-Files',
        version: '0.1.1-rc.2',
        removable: false,
      }, {
        name: '@deepseek-ai/dsh-model-catalog',
        displayName: 'Model Capabilities',
        version: '0.1.1-rc.2',
        removable: false,
      }, {
        name: '@legacy/dsh-plugin',
        displayName: '',
        version: '0.9.0',
        removable: undefined,
      }] }
      case 'logs': return { records: [{
        id: 'audit-1',
        timestamp: '2026-08-23T08:00:00Z',
        action: 'review',
        subject: '@fixture/dsh-plugin',
        status: 'review' as const,
        message: 'Pinned source accepted.',
      }] }
      case 'catalog': return { plugins: [{
        repository: 'fixture/direct-plugin',
        description: 'A structurally valid Profile Bundle.',
        stars: 42,
        language: 'TypeScript',
        updatedAt: '2026-08-23T08:00:00Z',
        htmlUrl: 'https://github.com/fixture/direct-plugin',
        category: 'profile-bundle' as const,
        installable: true,
      }, {
        repository: 'fixture/python-service',
        stars: 7,
        language: 'Python',
        updatedAt: '2026-08-23T07:00:00Z',
        htmlUrl: 'https://github.com/fixture/python-service',
        category: 'external-project' as const,
        installable: false,
      }], hasMore: input.page === 1 }
      case 'thirdPartyCatalog': return { plugins: [{
        id: 'MemTensor/MemOS/apps/memos-local-plugin',
        name: 'memos-local-plugin',
        repository: 'MemTensor/MemOS',
        englishDescription: 'Persistent memory from an external catalog.',
        chineseDescription: '第三方目录中的持久记忆插件。',
        stars: 10_930,
        categoryId: 'memory',
        detailUrl: 'https://deepseek1024.com/plugins/MemTensor/MemOS/apps/memos-local-plugin',
        repositoryUrl: 'https://github.com/MemTensor/MemOS',
      }],
      hasMore: input.page === 1,
      total: input.category === 'memory' ? 271 : 9_222,
      catalogTotal: 9_222,
      categories: [{ id: 'memory', englishName: 'Memory', chineseName: '记忆', count: 271 }],
      }
      case 'selectDirectory': return { path: '/tmp/dsh-fixtures/local-plugin' }
      case 'reviewUpdate': return { report: {
        reviewId: 'review-update',
        source: '@fixture/dsh-plugin@1.3.0',
        kind: 'npm' as const,
        subject: '@fixture/dsh-plugin',
        category: 'profile-bundle' as const,
        installable: true,
        requiresForceInstall: false,
        packageName: '@fixture/dsh-plugin',
        findings: ['Exact update version pinned.'],
        risks: [],
        expiresAt: '2026-08-23T08:15:00Z',
      } }
      case 'review':
      case 'reviewRepository':
      case 'reviewThirdParty': return { report: {
        reviewId: 'review-1',
        source: input.action === 'review' ? input.source : '@fixture/dsh-plugin@1.2.3',
        kind: 'npm' as const,
        subject: '@fixture/dsh-plugin',
        category: 'profile-bundle' as const,
        installable: true,
        requiresForceInstall: options.riskyReview ?? false,
        packageName: '@fixture/dsh-plugin',
        findings: ['Exact version pinned.', 'Lifecycle scripts disabled.'],
        risks: options.riskyReview
          ? ['dependencies contains @fixture/events@workspace:*; pnpm may reject installation.']
          : [],
        expiresAt: '2026-08-23T08:15:00Z',
      } }
      case 'install':
      case 'cancelReview':
      case 'remove': return { ok: true as const }
    }
  })
  return { bridge: { request } as unknown as DesktopPluginBridge, request }
}

describe('PluginLibraryOverlay', () => {
  it('localizes the built-in model catalog product name', async () => {
    const controller = new PluginLibraryController()
    const { bridge } = makeBridge()
    controller.show()
    render(<PluginLibraryOverlay {...({ bridge, controller, t: zhT } as PluginLibraryOverlayProps)} />)

    expect(await screen.findByText('dsh-model-catalog')).toBeTruthy()
    expect(screen.queryByText('Model Capabilities')).toBeNull()
  })

  it('reviews an available npm update before installation', async () => {
    const controller = new PluginLibraryController()
    const { bridge, request } = makeBridge()
    controller.show()
    render(<PluginLibraryOverlay {...({ bridge, controller, t } as PluginLibraryOverlayProps)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Update to 1.3.0' }))

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith({ action: 'reviewUpdate', package: '@fixture/dsh-plugin' })
    })
    expect(await screen.findByText(en.reviewReady)).toBeTruthy()
    expect((screen.getByLabelText(en.sourceLabel) as HTMLInputElement).value)
      .toBe('@fixture/dsh-plugin@1.3.0')
    expect(screen.getByRole('button', { name: en.install })).toBeTruthy()
  })

  it('renders low detailed cards, compact cards, source review, and audit records', async () => {
    const controller = new PluginLibraryController()
    const { bridge, request } = makeBridge()
    controller.show()
    const view = render(<PluginLibraryOverlay {...({ bridge, controller, t } as PluginLibraryOverlayProps)} />)

    expect(await screen.findByText('Fixture plugin')).toBeTruthy()
    expect(screen.getByText('Deepseek-Files')).toBeTruthy()
    expect(screen.getByText('dsh-model-catalog')).toBeTruthy()
    expect(screen.getByText('@legacy/dsh-plugin')).toBeTruthy()
    expect(screen.getAllByText(en.defaultInstalled)).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: en.remove })).toHaveLength(2)
    const grid = view.container.querySelector('[data-view="detailed"]')
    expect(grid).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.compact }))
    expect(view.container.querySelector('[data-view="compact"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.review }))
    expect(screen.queryByRole('heading', { name: en.communityTitle })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.chooseDirectory }))
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith({ action: 'selectDirectory' })
      expect((screen.getByLabelText(en.sourceLabel) as HTMLInputElement).value).toBe('/tmp/dsh-fixtures/local-plugin')
    })
    fireEvent.click(screen.getByRole('button', { name: en.discovery }))
    expect(await screen.findByText('fixture/direct-plugin')).toBeTruthy()
    expect(request).toHaveBeenCalledWith({ action: 'catalog', page: 1, pageSize: 12, query: '' })
    expect(screen.queryByText('fixture/python-service')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.reviewThis }))
    expect(request).toHaveBeenCalledWith({ action: 'reviewRepository', repository: 'fixture/direct-plugin' })
    expect(await screen.findByText(en.reviewReady)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.review }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: en.discovery }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.categoryExternal) }))
    expect(screen.getByText('fixture/python-service')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.categoryBundle) }))
    fireEvent.click(screen.getByRole('button', { name: en.thirdPartyTab }))
    expect(await screen.findByText('memos-local-plugin')).toBeTruthy()
    expect(request).toHaveBeenCalledWith({
      action: 'thirdPartyCatalog', page: 1, pageSize: 12, query: '', category: '', sort: 'stars',
    })
    fireEvent.click(screen.getByRole('button', { name: /Memory.*271/ }))
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        action: 'thirdPartyCatalog', page: 1, pageSize: 12, query: '', category: 'memory', sort: 'stars',
      })
      expect(screen.getByRole('button', { name: en.search }).hasAttribute('disabled')).toBe(false)
    })
    fireEvent.change(screen.getByLabelText(en.searchThirdParty), { target: { value: 'memory' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    expect(request).toHaveBeenCalledWith({
      action: 'thirdPartyCatalog', page: 1, pageSize: 12, query: 'memory', category: 'memory', sort: 'stars',
    })
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: en.loadMore }).hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: en.loadMore }))
    expect(request).toHaveBeenCalledWith({
      action: 'thirdPartyCatalog', page: 2, pageSize: 12, query: 'memory', category: 'memory', sort: 'stars',
    })
    fireEvent.click(screen.getByRole('button', { name: en.reviewThis }))
    expect(request).toHaveBeenCalledWith({
      action: 'reviewThirdParty',
      id: 'MemTensor/MemOS/apps/memos-local-plugin',
    })
    expect(await screen.findByText(en.reviewReady)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.review }).getAttribute('aria-current')).toBe('page')
    fireEvent.change(screen.getByLabelText(en.sourceLabel), {
      target: { value: '@fixture/manual@1.2.3' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.startReview }))
    expect(await screen.findByText(en.reviewReady)).toBeTruthy()
    expect(screen.getAllByText(en.categoryBundle).length).toBeGreaterThan(0)
    expect(request).toHaveBeenCalledWith({ action: 'review', source: '@fixture/manual@1.2.3' })

    fireEvent.click(screen.getByRole('button', { name: en.logs }))
    expect(screen.getByText('Pinned source accepted.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(view.container.querySelector('[data-plugin-library-overlay]')).toBeNull()
  })

  it('requires an explicit force choice when review reports install risks', async () => {
    const controller = new PluginLibraryController()
    const { bridge, request } = makeBridge({ riskyReview: true })
    controller.show()
    render(<PluginLibraryOverlay {...({ bridge, controller, t } as PluginLibraryOverlayProps)} />)

    fireEvent.click(screen.getByRole('button', { name: en.review }))
    expect(screen.getByRole('button', { name: en.startReview }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText(en.sourceLabel), {
      target: { value: '@fixture/risky@1.2.3' },
    })
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: en.startReview }).hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: en.startReview }))

    expect(await screen.findByText(en.reviewRisk)).toBeTruthy()
    expect(screen.getByText(en.riskItems)).toBeTruthy()
    expect(screen.getByText(/@fixture\/events@workspace:\*/)).toBeTruthy()
    expect(screen.getByText(en.forceNotice)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.cancelInstall })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.forceInstall })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.cancelInstall }))
    await vi.waitFor(() => { expect(screen.queryByText(en.reviewRisk)).toBeNull() })
    expect(request).toHaveBeenCalledWith({ action: 'cancelReview', reviewId: 'review-1' })
    expect(request).not.toHaveBeenCalledWith({ action: 'install', reviewId: 'review-1', force: true })

    fireEvent.click(screen.getByRole('button', { name: en.startReview }))
    expect(await screen.findByText(en.reviewRisk)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.forceInstall }))
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith({ action: 'install', reviewId: 'review-1', force: true })
    })
  })
})
