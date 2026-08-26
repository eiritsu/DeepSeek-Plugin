/** Full-frame desktop plugin library. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconCloseOutline16, IconCordisPluginOutline14, IconSearchOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CommunityPlugin, DesktopPluginBridge, InstalledPlugin, PluginAuditRecord, PluginCategory,
  PluginReviewReport, ThirdPartyCategory, ThirdPartyPlugin, ThirdPartySort,
} from './bridge.ts'
import type { PluginLibraryController } from './controller.ts'
import css from './PluginLibraryOverlay.module.css'

/** Native bridge and shared overlay controller supplied by registration. */
export interface PluginLibraryOverlayInjected {
  /** Main-frame, loopback-only native plugin bridge. */
  readonly bridge: DesktopPluginBridge
  /** Shared visibility controller. */
  readonly controller: PluginLibraryController
}

/** Full props composed by the shell overlay slot. */
export type PluginLibraryOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'pluginLibrary'>
  & InjectFace<PluginLibraryOverlayInjected>

type Tab = 'installed' | 'review' | 'discovery' | 'logs'
type CardView = 'detailed' | 'compact'
type CatalogFilter = 'all' | PluginCategory
type DiscoverySource = 'github' | 'thirdParty'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusLabel(status: PluginAuditRecord['status'], t: PluginLibraryOverlayProps['t']): string {
  if (status === 'success') return t('success')
  if (status === 'failure') return t('failure')
  return t('reviewed')
}

function categoryLabel(category: PluginCategory, t: PluginLibraryOverlayProps['t']): string {
  if (category === 'profile-bundle') return t('categoryBundle')
  if (category === 'needs-adapter') return t('categoryAdapter')
  if (category === 'external-project') return t('categoryExternal')
  return t('categoryBlocked')
}

function installedPluginTitle(
  plugin: InstalledPlugin,
  _t: PluginLibraryOverlayProps['t'],
): string {
  if (plugin.name === '@deepseek-ai/dsh-model-catalog') return 'dsh-model-catalog'
  return plugin.displayName.trim() || plugin.name
}

function installedPluginIdentifier(plugin: InstalledPlugin): string {
  if (plugin.name === '@deepseek-ai/dsh-model-catalog') return 'dsh-model-catalog'
  return plugin.name
}

function installedPluginRemovable(plugin: InstalledPlugin): boolean {
  return (plugin as { readonly removable?: boolean }).removable ?? true
}

/** Render the external package inventory, source review, and desktop audit log. */
export function PluginLibraryOverlay({ bridge, controller, t }: PluginLibraryOverlayProps) {
  const open = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [tab, setTab] = useState<Tab>('installed')
  const [cardView, setCardView] = useState<CardView>('detailed')
  const [plugins, setPlugins] = useState<readonly InstalledPlugin[]>([])
  const [logs, setLogs] = useState<readonly PluginAuditRecord[]>([])
  const [catalog, setCatalog] = useState<readonly CommunityPlugin[]>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string>()
  const [catalogPage, setCatalogPage] = useState(0)
  const [catalogHasMore, setCatalogHasMore] = useState(true)
  const [catalogSearchInput, setCatalogSearchInput] = useState('')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('profile-bundle')
  const [discoverySource, setDiscoverySource] = useState<DiscoverySource>('github')
  const [thirdPartyCatalog, setThirdPartyCatalog] = useState<readonly ThirdPartyPlugin[]>([])
  const [thirdPartyLoaded, setThirdPartyLoaded] = useState(false)
  const [thirdPartyLoading, setThirdPartyLoading] = useState(false)
  const [thirdPartyError, setThirdPartyError] = useState<string>()
  const [thirdPartyPage, setThirdPartyPage] = useState(0)
  const [thirdPartyHasMore, setThirdPartyHasMore] = useState(true)
  const [thirdPartyTotal, setThirdPartyTotal] = useState(0)
  const [thirdPartyCatalogTotal, setThirdPartyCatalogTotal] = useState(0)
  const [thirdPartyCategories, setThirdPartyCategories] = useState<readonly ThirdPartyCategory[]>([])
  const [thirdPartyCategory, setThirdPartyCategory] = useState('')
  const [thirdPartySort, setThirdPartySort] = useState<ThirdPartySort>('stars')
  const [thirdPartySearchInput, setThirdPartySearchInput] = useState('')
  const [thirdPartySearch, setThirdPartySearch] = useState('')
  const [source, setSource] = useState('')
  const [report, setReport] = useState<PluginReviewReport>()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const catalogLoadingRef = useRef(false)
  const thirdPartyLoadingRef = useRef(false)
  const catalogRequestVersion = useRef(0)
  const thirdPartyRequestVersion = useRef(0)
  const catalogViewport = useRef<HTMLDivElement>(null)
  const thirdPartyViewport = useRef<HTMLDivElement>(null)
  const discoveryScroll = useRef<Record<DiscoverySource, number>>({ github: 0, thirdParty: 0 })

  const refresh = async (): Promise<void> => {
    const [listed, recorded] = await Promise.all([
      bridge.request({ action: 'list' }),
      bridge.request({ action: 'logs' }),
    ])
    setPlugins(listed.plugins)
    setLogs(recorded.records)
  }

  const loadCatalogPage = async (page: number, search: string, reset: boolean): Promise<void> => {
    if (catalogLoadingRef.current) return
    catalogLoadingRef.current = true
    const version = reset ? catalogRequestVersion.current + 1 : catalogRequestVersion.current
    if (reset) catalogRequestVersion.current = version
    if (reset) {
      setCatalog([])
      setCatalogPage(0)
      setCatalogHasMore(true)
    }
    setCatalogLoading(true)
    setCatalogError(undefined)
    try {
      const reply = await bridge.request({
        action: 'catalog',
        page,
        pageSize: 12,
        query: search,
      })
      if (version !== catalogRequestVersion.current) return
      setCatalog(current => reset
        ? reply.plugins
        : [...current, ...reply.plugins.filter(
          plugin => !current.some(existing => existing.repository === plugin.repository),
        )])
      setCatalogPage(page)
      setCatalogHasMore(reply.hasMore)
      setCatalogLoaded(true)
      if (reset) {
        discoveryScroll.current.github = 0
        if (catalogViewport.current !== null) catalogViewport.current.scrollTop = 0
      }
    } catch (reason) {
      if (version === catalogRequestVersion.current) setCatalogError(errorMessage(reason))
    } finally {
      catalogLoadingRef.current = false
      if (version === catalogRequestVersion.current) setCatalogLoading(false)
    }
  }

  const loadThirdPartyPage = async (
    page: number,
    search: string,
    category: string,
    sort: ThirdPartySort,
    reset: boolean,
  ): Promise<void> => {
    if (thirdPartyLoadingRef.current) return
    thirdPartyLoadingRef.current = true
    const version = reset ? thirdPartyRequestVersion.current + 1 : thirdPartyRequestVersion.current
    if (reset) thirdPartyRequestVersion.current = version
    if (reset) {
      setThirdPartyCatalog([])
      setThirdPartyPage(0)
      setThirdPartyHasMore(true)
    }
    setThirdPartyLoading(true)
    setThirdPartyError(undefined)
    try {
      const reply = await bridge.request({
        action: 'thirdPartyCatalog',
        page,
        pageSize: 12,
        query: search,
        category,
        sort,
      })
      if (version !== thirdPartyRequestVersion.current) return
      setThirdPartyCatalog(current => reset
        ? reply.plugins
        : [...current, ...reply.plugins.filter(
          plugin => !current.some(existing => existing.id === plugin.id),
        )])
      setThirdPartyPage(page)
      setThirdPartyHasMore(reply.hasMore)
      setThirdPartyTotal(reply.total)
      setThirdPartyCatalogTotal(reply.catalogTotal)
      setThirdPartyCategories(reply.categories)
      setThirdPartyLoaded(true)
      if (reset) {
        discoveryScroll.current.thirdParty = 0
        if (thirdPartyViewport.current !== null) thirdPartyViewport.current.scrollTop = 0
      }
    } catch (reason) {
      if (version === thirdPartyRequestVersion.current) setThirdPartyError(errorMessage(reason))
    } finally {
      thirdPartyLoadingRef.current = false
      if (version === thirdPartyRequestVersion.current) setThirdPartyLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    let current = true
    setBusy('load')
    setError(undefined)
    void refresh().catch((reason: unknown) => {
      if (current) setError(errorMessage(reason))
    }).finally(() => {
      if (current) setBusy(undefined)
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') controller.hide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      current = false
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [bridge, controller, open])

  useEffect(() => {
    if (!open || catalogLoaded || catalogLoadingRef.current) return
    void loadCatalogPage(1, catalogSearch, true)
  }, [catalogLoaded, open])

  useEffect(() => {
    if (!open || thirdPartyLoaded || thirdPartyLoadingRef.current) return
    void loadThirdPartyPage(1, thirdPartySearch, thirdPartyCategory, thirdPartySort, true)
  }, [open, thirdPartyLoaded])

  useEffect(() => {
    const viewport = discoverySource === 'github' ? catalogViewport.current : thirdPartyViewport.current
    if (viewport !== null) viewport.scrollTop = discoveryScroll.current[discoverySource]
  }, [catalogLoaded, discoverySource, thirdPartyLoaded])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (normalized.length === 0) return plugins
    return plugins.filter(plugin => `${installedPluginTitle(plugin, t)} ${installedPluginIdentifier(plugin)} ${plugin.name} ${plugin.version}`
      .toLocaleLowerCase().includes(normalized))
  }, [plugins, query, t])

  const filteredCatalog = useMemo(() => {
    if (catalogFilter === 'all') return catalog
    return catalog.filter(plugin => plugin.category === catalogFilter)
  }, [catalog, catalogFilter])

  const loadMoreOnScroll = (source: DiscoverySource, element: HTMLDivElement): void => {
    discoveryScroll.current[source] = element.scrollTop
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 140) return
    if (source === 'github' && catalogHasMore && !catalogLoadingRef.current) {
      void loadCatalogPage(catalogPage + 1, catalogSearch, false)
    }
    if (source === 'thirdParty' && thirdPartyHasMore && !thirdPartyLoadingRef.current) {
      void loadThirdPartyPage(
        thirdPartyPage + 1,
        thirdPartySearch,
        thirdPartyCategory,
        thirdPartySort,
        false,
      )
    }
  }

  if (!open) return null

  const review = async (): Promise<void> => {
    if (source.trim().length === 0 || busy !== undefined) return
    setBusy('review')
    setError(undefined)
    setReport(undefined)
    try {
      const reply = await bridge.request({ action: 'review', source: source.trim() })
      setReport(reply.report)
      setLogs((await bridge.request({ action: 'logs' })).records)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const chooseDirectory = async (): Promise<void> => {
    if (busy !== undefined) return
    setBusy('select-directory')
    setError(undefined)
    try {
      const reply = await bridge.request({ action: 'selectDirectory' })
      if (reply.path !== undefined) {
        setSource(reply.path)
        setReport(undefined)
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const install = async (force: boolean): Promise<void> => {
    if (report?.reviewId === undefined || !report.installable || busy !== undefined) return
    setBusy('install')
    setError(undefined)
    try {
      await bridge.request({ action: 'install', reviewId: report.reviewId, force })
      setReport(undefined)
      setSource('')
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(undefined)
    }
  }

  const cancelReview = async (): Promise<void> => {
    if (report?.reviewId === undefined || busy !== undefined) return
    setBusy('cancel-review')
    setError(undefined)
    try {
      await bridge.request({ action: 'cancelReview', reviewId: report.reviewId })
      setReport(undefined)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const reviewRepository = async (plugin: CommunityPlugin): Promise<void> => {
    if (!plugin.installable || busy !== undefined) return
    setTab('review')
    setSource(plugin.htmlUrl)
    setBusy(`catalog:${plugin.repository}`)
    setError(undefined)
    setReport(undefined)
    try {
      const reply = await bridge.request({ action: 'reviewRepository', repository: plugin.repository })
      setSource(reply.report.source)
      setReport(reply.report)
      setLogs((await bridge.request({ action: 'logs' })).records)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const reviewThirdParty = async (plugin: ThirdPartyPlugin): Promise<void> => {
    if (busy !== undefined) return
    setTab('review')
    setSource(plugin.repositoryUrl)
    setBusy(`third-party:${plugin.id}`)
    setError(undefined)
    setReport(undefined)
    try {
      const reply = await bridge.request({ action: 'reviewThirdParty', id: plugin.id })
      setSource(reply.report.source)
      setReport(reply.report)
      setLogs((await bridge.request({ action: 'logs' })).records)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const reviewUpdate = async (plugin: InstalledPlugin): Promise<void> => {
    if (plugin.latestVersion === undefined || busy !== undefined) return
    setTab('review')
    setBusy(`update:${plugin.name}`)
    setError(undefined)
    setReport(undefined)
    try {
      const reply = await bridge.request({ action: 'reviewUpdate', package: plugin.name })
      setSource(reply.report.source)
      setReport(reply.report)
      setLogs((await bridge.request({ action: 'logs' })).records)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const remove = async (plugin: InstalledPlugin): Promise<void> => {
    if (busy !== undefined) return
    setBusy(`remove:${plugin.name}`)
    setError(undefined)
    try {
      await bridge.request({ action: 'remove', package: plugin.name })
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(undefined)
    }
  }

  return (
    <div className={css.scrim} data-plugin-library-overlay>
      <section className={css.surface} aria-label={t('title')}>
        <header className={css.header}>
          <div>
            <h1>{t('title')}</h1>
            <p>{t('subtitle')}</p>
          </div>
          <button type="button" className={css.close} aria-label={t('close')} onClick={() => { controller.hide() }}>
            <IconCloseOutline16 />
          </button>
        </header>

        <nav className={css.tabs} aria-label={t('title')}>
          {(['installed', 'review', 'discovery', 'logs'] as const).map(id => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => { setTab(id) }}
            >
              {t(id)}
              {id === 'installed' ? <span>{plugins.length}</span> : null}
            </button>
          ))}
        </nav>

        {error !== undefined ? <p className={css.error} role="alert">{t('loadFailed', { message: error })}</p> : null}

        <div className={css.body} aria-busy={busy !== undefined}>
          {tab === 'installed' && (
            <section className={css.installed}>
              <div className={css.toolbar}>
                <label className={css.search}>
                  <IconSearchOutline16 aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    aria-label={t('installed')}
                    placeholder={t('installed')}
                    onChange={(event) => { setQuery(event.currentTarget.value) }}
                  />
                </label>
                <div className={css.viewSwitch} aria-label={t('installed')}>
                  <button type="button" aria-pressed={cardView === 'detailed'} onClick={() => { setCardView('detailed') }}>{t('detailed')}</button>
                  <button type="button" aria-pressed={cardView === 'compact'} onClick={() => { setCardView('compact') }}>{t('compact')}</button>
                </div>
              </div>
              {busy === 'load' ? <p className={css.note}>{t('loading')}</p> : null}
              {busy !== 'load' && plugins.length === 0 ? <p className={css.note}>{t('empty')}</p> : null}
              {filtered.length > 0 ? (
                <ul className={css.pluginGrid} data-view={cardView}>
                  {filtered.map((plugin) => {
                    const title = installedPluginTitle(plugin, t)
                    const identifier = installedPluginIdentifier(plugin)
                    return <li key={plugin.name} className={css.pluginCard}>
                      <span className={css.pluginIcon} aria-hidden="true"><IconCordisPluginOutline14 size={18} /></span>
                      <div className={css.pluginIdentity}>
                        <strong title={plugin.name}>{title}</strong>
                        {title !== identifier ? <span>{identifier}</span> : null}
                        <span>{plugin.version}</span>
                      </div>
                      <div className={css.pluginActions}>
                        {plugin.latestVersion !== undefined ? (
                          <button
                            type="button"
                            className={css.update}
                            disabled={busy !== undefined}
                            onClick={() => { void reviewUpdate(plugin) }}
                          >
                            {busy === `update:${plugin.name}`
                              ? t('reviewingUpdate')
                              : t('update', { version: plugin.latestVersion })}
                          </button>
                        ) : null}
                        {installedPluginRemovable(plugin) ? (
                          <button
                            type="button"
                            className={css.remove}
                            disabled={busy !== undefined}
                            onClick={() => { void remove(plugin) }}
                          >
                            <IconTrashOutline16 size={14} />
                            {busy === `remove:${plugin.name}` ? t('removing') : t('remove')}
                          </button>
                        ) : <span className={css.defaultInstalled}>{t('defaultInstalled')}</span>}
                      </div>
                    </li>
                  })}
                </ul>
              ) : null}
            </section>
          )}

          {(tab === 'review' || tab === 'discovery') && (
            <section className={tab === 'review' ? css.review : css.discoveryPage}>
              {tab === 'review' ? <>
                <label htmlFor="plugin-library-source">{t('sourceLabel')}</label>
                <div className={css.sourceRow}>
                  <input
                    id="plugin-library-source"
                    value={source}
                    placeholder={t('sourcePlaceholder')}
                    onChange={(event) => {
                      setSource(event.currentTarget.value)
                      setReport(undefined)
                    }}
                  />
                  <button type="button" className={css.chooseSource} disabled={busy !== undefined} onClick={() => { void chooseDirectory() }}>
                    {busy === 'select-directory' ? t('choosingDirectory') : t('chooseDirectory')}
                  </button>
                  <button type="button" disabled={busy !== undefined || source.trim().length === 0} onClick={() => { void review() }}>
                    {busy === 'review' ? t('reviewing') : t('startReview')}
                  </button>
                </div>
                <p className={css.notice}>{t('reviewNotice')}</p>
                {report === undefined ? <p className={css.note}>{busy?.startsWith('catalog:') === true || busy?.startsWith('third-party:') === true ? t('reviewingCommunity') : t('noReview')}</p> : (
                  <div className={css.reviewResult}>
                    <div className={css.reviewHeading}>
                      <div>
                        <span className={css.categoryBadge} data-category={report.category}>
                          {categoryLabel(report.category, t)}
                        </span>
                        <strong>
                          {report.requiresForceInstall
                            ? t('reviewRisk')
                            : report.installable ? t('reviewReady') : t('reviewRejected')}
                        </strong>
                        <code>{report.source}</code>
                      </div>
                      {report.installable && report.reviewId !== undefined ? (
                        <div className={css.reviewActions}>
                          {report.requiresForceInstall ? (
                            <button
                              type="button"
                              className={css.cancelInstall}
                              disabled={busy !== undefined}
                              onClick={() => { void cancelReview() }}
                            >
                              {t('cancelInstall')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy !== undefined}
                            onClick={() => { void install(report.requiresForceInstall) }}
                          >
                            {busy === 'install'
                              ? report.requiresForceInstall ? t('forceInstalling') : t('installing')
                              : report.requiresForceInstall ? t('forceInstall') : t('install')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {report.risks.length > 0 ? (
                      <div className={css.riskList} role="alert">
                        <strong>{t('riskItems')}</strong>
                        <ul>{report.risks.map(risk => <li key={risk}>{risk}</li>)}</ul>
                        <p>{t('forceNotice')}</p>
                      </div>
                    ) : null}
                    <ul>{report.findings.map(finding => <li key={finding}>{finding}</li>)}</ul>
                    {report.installable ? (
                      <span className={css.expiry}>{t('reviewExpiry', { time: new Date(report.expiresAt).toLocaleTimeString() })}</span>
                    ) : null}
                  </div>
                )}
              </> : (
                <section className={css.catalog} aria-label={t('communityTitle')}>
                  <div className={css.catalogHeading}>
                    <div>
                      <h2>
                        {t('communityTitle')}
                        {discoverySource === 'thirdParty' && thirdPartyCatalogTotal > 0 ? (
                          <span>{t('pluginCount', { count: thirdPartyCatalogTotal.toLocaleString() })}</span>
                        ) : null}
                      </h2>
                      <p>{t('communityDescription')}</p>
                    </div>
                    <a
                      href={discoverySource === 'github' ? 'https://github.com/topics/dsh-plugin' : 'https://deepseek1024.com/plugins'}
                      rel="noreferrer"
                    >
                      {discoverySource === 'github' ? t('openTopic') : t('openThirdParty')}
                    </a>
                  </div>
                  <div className={css.discoveryTabs} aria-label={t('communitySources')}>
                    <button
                      type="button"
                      aria-pressed={discoverySource === 'github'}
                      onClick={() => { setDiscoverySource('github') }}
                    >
                      {t('githubTopicTab')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={discoverySource === 'thirdParty'}
                      onClick={() => { setDiscoverySource('thirdParty') }}
                    >
                      {t('thirdPartyTab')}
                    </button>
                  </div>
                  {discoverySource === 'github' ? <>
                    <p className={css.discoveryNote}>{t('githubTopicDescription')}</p>
                    <form
                      className={css.discoverySearch}
                      onSubmit={(event) => {
                        event.preventDefault()
                        const nextSearch = catalogSearchInput.trim()
                        setCatalogSearch(nextSearch)
                        setCatalogFilter('all')
                        void loadCatalogPage(1, nextSearch, true)
                      }}
                    >
                      <label>
                        <IconSearchOutline16 aria-hidden="true" />
                        <input
                          type="search"
                          value={catalogSearchInput}
                          aria-label={t('searchGitHub')}
                          placeholder={t('searchGitHub')}
                          onChange={(event) => { setCatalogSearchInput(event.currentTarget.value) }}
                        />
                      </label>
                      <button type="submit" disabled={catalogLoading}>{t('search')}</button>
                    </form>
                    <div className={css.catalogFilters} aria-label={t('communityFilter')}>
                      {([
                        ['profile-bundle', 'categoryBundle'],
                        ['needs-adapter', 'categoryAdapter'],
                        ['external-project', 'categoryExternal'],
                        ['blocked', 'categoryBlocked'],
                        ['all', 'allCategories'],
                      ] as const).map(([id, key]) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={catalogFilter === id}
                          onClick={() => { setCatalogFilter(id) }}
                        >
                          {t(key)}
                          <span>{id === 'all' ? catalog.length : catalog.filter(plugin => plugin.category === id).length}</span>
                        </button>
                      ))}
                    </div>
                    {catalogError !== undefined ? <p className={css.catalogError} role="status">{t('communityFailed', { message: catalogError })}</p> : null}
                    <div
                      ref={catalogViewport}
                      className={css.catalogViewport}
                      onScroll={(event) => { loadMoreOnScroll('github', event.currentTarget) }}
                    >
                      {catalogLoading && catalog.length === 0 ? <p className={css.note}>{t('communityLoading')}</p> : null}
                      {!catalogLoading && catalogLoaded && filteredCatalog.length === 0 ? <p className={css.note}>{t('communityEmpty')}</p> : null}
                      {filteredCatalog.length > 0 ? (
                        <ul className={css.catalogGrid}>
                          {filteredCatalog.map(plugin => (
                            <li key={plugin.repository} className={css.catalogCard}>
                              <div className={css.catalogCardHeading}>
                                <strong title={plugin.repository}>{plugin.repository}</strong>
                                <span className={css.categoryBadge} data-category={plugin.category}>
                                  {categoryLabel(plugin.category, t)}
                                </span>
                              </div>
                              <p>{plugin.description ?? t('noDescription')}</p>
                              <div className={css.catalogMeta}>
                                <span>★ {plugin.stars.toLocaleString()}</span>
                                {plugin.language !== undefined ? <span>{plugin.language}</span> : null}
                                <a href={plugin.htmlUrl} rel="noreferrer">{t('viewRepository')}</a>
                                {plugin.installable ? (
                                  <button
                                    type="button"
                                    disabled={busy !== undefined}
                                    onClick={() => { void reviewRepository(plugin) }}
                                  >
                                    {busy === `catalog:${plugin.repository}` ? t('reviewing') : t('reviewThis')}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className={css.loadMore}>
                        {catalogLoading && catalog.length > 0 ? <span>{t('loadingMore')}</span> : null}
                        {!catalogLoading && catalogHasMore ? (
                          <button
                            type="button"
                            onClick={() => { void loadCatalogPage(catalogPage + 1, catalogSearch, false) }}
                          >
                            {t('loadMore')}
                          </button>
                        ) : null}
                        {!catalogLoading && catalogLoaded && !catalogHasMore ? <span>{t('allLoaded')}</span> : null}
                      </div>
                    </div>
                  </> : <>
                    <p className={css.discoveryNote}>{t('thirdPartyDescription')}</p>
                    <div className={css.catalogFilters} aria-label={t('thirdPartyCategories')}>
                      <button
                        type="button"
                        disabled={thirdPartyLoading}
                        aria-pressed={thirdPartyCategory === ''}
                        onClick={() => {
                          setThirdPartyCategory('')
                          void loadThirdPartyPage(1, thirdPartySearch, '', thirdPartySort, true)
                        }}
                      >
                        {t('allCategories')}
                        <span>{thirdPartyCatalogTotal.toLocaleString()}</span>
                      </button>
                      {thirdPartyCategories.map(category => (
                        <button
                          key={category.id}
                          type="button"
                          disabled={thirdPartyLoading}
                          aria-pressed={thirdPartyCategory === category.id}
                          onClick={() => {
                            setThirdPartyCategory(category.id)
                            void loadThirdPartyPage(1, thirdPartySearch, category.id, thirdPartySort, true)
                          }}
                        >
                          {t('languageCode') === 'zh' ? category.chineseName : category.englishName}
                          <span>{category.count.toLocaleString()}</span>
                        </button>
                      ))}
                    </div>
                    <div className={css.sortTabs} aria-label={t('thirdPartySort')}>
                      {([
                        ['stars', 'sortStars'],
                        ['npmDownloads7d', 'sortNpm'],
                        ['installs', 'sortInstalls'],
                        ['newest', 'sortNewest'],
                        ['active', 'sortActive'],
                      ] as const).map(([id, key]) => (
                        <button
                          key={id}
                          type="button"
                          disabled={thirdPartyLoading}
                          aria-pressed={thirdPartySort === id}
                          onClick={() => {
                            setThirdPartySort(id)
                            void loadThirdPartyPage(1, thirdPartySearch, thirdPartyCategory, id, true)
                          }}
                        >
                          {t(key)}
                        </button>
                      ))}
                    </div>
                    <form
                      className={css.discoverySearch}
                      onSubmit={(event) => {
                        event.preventDefault()
                        const nextSearch = thirdPartySearchInput.trim()
                        setThirdPartySearch(nextSearch)
                        void loadThirdPartyPage(1, nextSearch, thirdPartyCategory, thirdPartySort, true)
                      }}
                    >
                      <label>
                        <IconSearchOutline16 aria-hidden="true" />
                        <input
                          type="search"
                          value={thirdPartySearchInput}
                          aria-label={t('searchThirdParty')}
                          placeholder={t('searchThirdParty')}
                          onChange={(event) => { setThirdPartySearchInput(event.currentTarget.value) }}
                        />
                      </label>
                      <button type="submit" disabled={thirdPartyLoading}>{t('search')}</button>
                    </form>
                    {thirdPartyError !== undefined ? <p className={css.catalogError} role="status">{t('thirdPartyFailed', { message: thirdPartyError })}</p> : null}
                    <div
                      ref={thirdPartyViewport}
                      className={css.catalogViewport}
                      onScroll={(event) => { loadMoreOnScroll('thirdParty', event.currentTarget) }}
                    >
                      {thirdPartyLoading && thirdPartyCatalog.length === 0 ? <p className={css.note}>{t('thirdPartyLoading')}</p> : null}
                      {!thirdPartyLoading && thirdPartyLoaded && thirdPartyCatalog.length === 0 ? <p className={css.note}>{t('thirdPartyEmpty')}</p> : null}
                      {thirdPartyCatalog.length > 0 ? (
                        <ul className={css.catalogGrid}>
                          {thirdPartyCatalog.map(plugin => (
                            <li key={plugin.id} className={css.catalogCard}>
                              <div className={css.catalogCardHeading}>
                                <strong title={`${plugin.repository}/${plugin.name}`}>{plugin.name}</strong>
                                <span className={css.sourceBadge}>
                                  {(() => {
                                    const category = thirdPartyCategories.find(item => item.id === plugin.categoryId)
                                    if (category === undefined) return plugin.categoryId
                                    return t('languageCode') === 'zh' ? category.chineseName : category.englishName
                                  })()}
                                </span>
                              </div>
                              <p>{t('languageCode') === 'zh' ? plugin.chineseDescription : plugin.englishDescription}</p>
                              <div className={css.catalogMeta}>
                                <span>★ {plugin.stars.toLocaleString()}</span>
                                <a href={plugin.repositoryUrl} rel="noreferrer">{t('viewRepository')}</a>
                                <a href={plugin.detailUrl} rel="noreferrer">{t('viewDetails')}</a>
                                <button
                                  type="button"
                                  disabled={busy !== undefined}
                                  onClick={() => { void reviewThirdParty(plugin) }}
                                >
                                  {busy === `third-party:${plugin.id}` ? t('reviewing') : t('reviewThis')}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className={css.loadMore}>
                        {thirdPartyLoading && thirdPartyCatalog.length > 0 ? <span>{t('loadingMore')}</span> : null}
                        {!thirdPartyLoading && thirdPartyHasMore ? (
                          <button
                            type="button"
                            onClick={() => {
                              void loadThirdPartyPage(
                                thirdPartyPage + 1,
                                thirdPartySearch,
                                thirdPartyCategory,
                                thirdPartySort,
                                false,
                              )
                            }}
                          >
                            {t('loadMore')}
                          </button>
                        ) : null}
                        {!thirdPartyLoading && thirdPartyLoaded && !thirdPartyHasMore ? (
                          <span>{t('allResultsLoaded', { count: thirdPartyTotal.toLocaleString() })}</span>
                        ) : null}
                      </div>
                    </div>
                  </>}
                </section>
              )}
            </section>
          )}

          {tab === 'logs' && (
            <section>
              {logs.length === 0 ? <p className={css.note}>{t('noLogs')}</p> : (
                <ol className={css.logs}>
                  {logs.map(record => (
                    <li key={record.id}>
                      <time>{new Date(record.timestamp).toLocaleString()}</time>
                      <strong>{record.action}</strong>
                      <span className={css.logSubject}>{record.subject}</span>
                      <span data-status={record.status}>{statusLabel(record.status, t)}</span>
                      <p>{record.message}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  )
}
