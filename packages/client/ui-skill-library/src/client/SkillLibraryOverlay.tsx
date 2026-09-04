/** Full-frame SkillHub skill and skill-package marketplace. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconCloseOutline16, IconSearchOutline16, IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fetchSkillPackages, fetchSkills, packageUrl, skillUrl, type SkillHubPackage, type SkillHubSkill } from './api.ts'
import type { SkillHubBridge } from './bridge.ts'
import type { SkillLibraryController } from './controller.ts'
import css from './SkillLibraryOverlay.module.css'

export interface SkillLibraryOverlayInjected { readonly controller: SkillLibraryController; readonly bridge: SkillHubBridge }
export type SkillLibraryOverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<'skillLibrary'> & InjectFace<SkillLibraryOverlayInjected>
type Tab = 'installed' | 'review' | 'discovery' | 'logs'
type MarketTab = 'skills' | 'packages'
type SkillSort = 'score' | 'trending' | 'downloads' | 'newest'

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Render paged SkillHub data with an internal scroll viewport and prefetch. */
export function SkillLibraryOverlay({ controller, bridge, t }: SkillLibraryOverlayProps) {
  const open = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [tab, setTab] = useState<Tab>('installed')
  const [marketTab, setMarketTab] = useState<MarketTab>('skills')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SkillSort>('score')
  const [category, setCategory] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [apiKeyFilter, setApiKeyFilter] = useState<'all' | 'required' | 'none'>('all')
  const [items, setItems] = useState<readonly (SkillHubSkill | SkillHubPackage)[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [downloading, setDownloading] = useState<string>()
  const viewport = useRef<HTMLDivElement>(null)
  const requestVersion = useRef(0)
  const loadingRef = useRef(false)
  const pageSize = marketTab === 'skills' ? 24 : 20
  const hasMore = total > 0 && page * pageSize < total
  const categoryOptions = [...new Set(items.map(item => 'displayName' in item ? item.scene : item.category).filter((value): value is string => typeof value === 'string' && value.length > 0))].sort()
  const visibleItems = useMemo(() => {
    if (marketTab !== 'skills' || apiKeyFilter === 'all') return items
    return items.filter(item => 'name' in item && (apiKeyFilter === 'required' ? item.requiresApiKey === true : item.requiresApiKey !== true))
  }, [apiKeyFilter, items, marketTab])

  const load = async (nextPage: number, reset: boolean): Promise<void> => {
    if (loadingRef.current) return
    loadingRef.current = true
    const version = reset ? requestVersion.current + 1 : requestVersion.current
    if (reset) requestVersion.current = version
    setLoading(true)
    setError(undefined)
    try {
      const result = marketTab === 'skills'
        ? await fetchSkills({ page: nextPage, pageSize, query, sort, category, source: sourceFilter }, new AbortController().signal)
        : await fetchSkillPackages({ page: nextPage, pageSize, query, scene: category }, new AbortController().signal)
      if (version !== requestVersion.current) return
      setItems(current => reset ? result.items : [...current, ...result.items.filter(item => !current.some(existing => 'slug' in existing && 'slug' in item && existing.slug === item.slug))])
      setPage(nextPage)
      setTotal(result.total)
      if (reset && viewport.current !== null) viewport.current.scrollTop = 0
    } catch (reason) {
      if (version === requestVersion.current) setError(message(reason))
    } finally {
      loadingRef.current = false
      if (version === requestVersion.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || tab !== 'discovery') return
    void load(1, true)
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') controller.hide() }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [open, tab, marketTab, query, sort, category, sourceFilter])

  const onScroll = (element: HTMLDivElement): void => {
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 180 && hasMore && !loadingRef.current) void load(page + 1, false)
  }

  const download = async (skill: SkillHubSkill): Promise<void> => {
    setDownloading(skill.slug)
    setError(undefined)
    try {
      await bridge.request({ action: 'downloadSkill', slug: skill.slug })
    } catch (reason) {
      setError(message(reason))
    } finally {
      setDownloading(undefined)
    }
  }

  if (!open) return null
  const isSkill = (item: SkillHubSkill | SkillHubPackage): item is SkillHubSkill => 'name' in item
  return <div className={css.scrim} data-skill-library-overlay>
    <section className={css.surface} aria-label={t('title')}>
      <header className={css.header}><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div><button type="button" className={css.close} aria-label={t('close')} onClick={() => { controller.hide() }}><IconCloseOutline16 /></button></header>
      <nav className={css.tabs} aria-label={t('title')}>
        {(['installed', 'review', 'discovery', 'logs'] as const).map(id => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id) }}>{t(id)}</button>)}
      </nav>
      <div className={css.body} aria-busy={loading}>
        {error !== undefined ? <p className={css.error} role="alert">{t('failed', { message: error })}</p> : null}
        {tab === 'installed' ? <section className={css.panel}><h2>{t('installed')}</h2><p>{t('installedEmpty')}</p></section> : null}
        {tab === 'review' ? <section className={css.panel}><h2>{t('review')}</h2><p>{t('reviewEmpty')}</p></section> : null}
        {tab === 'logs' ? <section className={css.panel}><h2>{t('logs')}</h2><p>{t('logsEmpty')}</p></section> : null}
        {tab === 'discovery' ? <section className={css.catalog}>
          <nav className={css.marketTabs} aria-label={t('discovery')}>
            {(['skills', 'packages'] as const).map(id => <button key={id} type="button" aria-current={marketTab === id ? 'page' : undefined} onClick={() => { setMarketTab(id); setItems([]); setPage(1); setTotal(0) }}>{t(id)}</button>)}
          </nav>
          {marketTab === 'skills' ? <div className={css.skillSortTabs} aria-label={t('skillSort')}>
            {(['score', 'trending', 'downloads', 'newest'] as const).map(id => <button key={id} type="button" aria-current={sort === id ? 'page' : undefined} onClick={() => { setSort(id) }}>{t(id === 'score' ? 'sortScore' : id === 'trending' ? 'sortTrending' : id === 'downloads' ? 'sortDownloads' : 'sortNewest')}</button>)}
          </div> : null}
          <div className={css.toolbar}><form className={css.search} onSubmit={event => { event.preventDefault(); setQuery(queryInput.trim()) }}><IconSearchOutline16 aria-hidden="true" /><input type="search" value={queryInput} aria-label={t(marketTab === 'skills' ? 'searchSkills' : 'searchPackages')} placeholder={t(marketTab === 'skills' ? 'searchSkills' : 'searchPackages')} onChange={event => { setQueryInput(event.currentTarget.value) }} /></form>{marketTab === 'skills' ? <><select aria-label={t('allSources')} value={sourceFilter} onChange={event => { setSourceFilter(event.currentTarget.value) }}><option value="all">{t('allSources')}</option><option value="official">{t('officialSource')}</option><option value="community">{t('communitySource')}</option></select><select aria-label={t('apiKeyFilter')} value={apiKeyFilter} onChange={event => { setApiKeyFilter(event.currentTarget.value as typeof apiKeyFilter) }}><option value="all">{t('apiKeyAll')}</option><option value="none">{t('apiKeyNone')}</option><option value="required">{t('apiKeyRequired')}</option></select></> : null}<select aria-label={t('allCategories')} value={category} onChange={event => { setCategory(event.currentTarget.value) }}><option value="">{t('allCategories')}</option>{categoryOptions.map(option => <option key={option} value={option}>{option}</option>)}</select></div>
          <div className={css.viewport} ref={viewport} onScroll={event => { onScroll(event.currentTarget) }}>
            {loading && items.length === 0 ? <p className={css.note}>{t('loading')}</p> : null}
            {!loading && visibleItems.length === 0 ? <p className={css.note}>{t('empty')}</p> : null}
            {visibleItems.length > 0 ? <ul className={css.grid}>{visibleItems.map(item => isSkill(item) ? <li key={item.slug} className={css.card}><div className={css.cardHeading}>{item.iconUrl ? <img className={css.icon} src={item.iconUrl} alt="" /> : <span className={css.icon}><IconSkillOutline16 size={20} /></span>}<strong title={item.name}>{item.name}</strong>{item.category ? <span className={css.badge}>{item.category}</span> : null}</div><p>{item.descriptionZh ?? item.description ?? ''}</p><div className={css.meta}><span>☆ {item.stars.toLocaleString()}</span><span>⇩ {item.downloads.toLocaleString()}</span><span>{item.publisher ?? item.source ?? t('sourceSkillHub')}</span></div><div className={css.actions}><a href={skillUrl(item.slug)} target="_blank" rel="noreferrer">{t('open')}</a><button type="button" onClick={() => { download(item) }}>{downloading === item.slug ? t('downloading') : t('download')}</button></div></li> : <li key={item.slug} className={css.card}><div className={css.cardHeading}><span className={css.icon}><IconSkillOutline16 size={20} /></span><strong title={item.displayName}>{item.displayName}</strong></div><p>{item.summary ?? ''}</p><div className={css.meta}><span>{item.scene ?? item.subScene ?? ''}</span><span>{t('sourceSkillHub')}</span></div><div className={css.actions}><a href={packageUrl(item.slug)} target="_blank" rel="noreferrer">{t('open')}</a></div></li>)}</ul> : null}
            <div className={css.loadMore}>{loading && visibleItems.length > 0 ? <span>{t('loadingMore')}</span> : null}{!loading && hasMore && visibleItems.length > 0 ? <button type="button" onClick={() => { void load(page + 1, false) }}>{t('loadMore')}</button> : null}{!loading && !hasMore && visibleItems.length > 0 ? <span>{t('allLoaded')}</span> : null}</div>
          </div>
          <div className={css.pager}><button type="button" disabled={page <= 1 || loading} onClick={() => { void load(page - 1, true) }}>{t('previous')}</button><span>{t('page', { page })}</span><button type="button" disabled={!hasMore || loading} onClick={() => { void load(page + 1, true) }}>{t('next')}</button></div>
        </section> : null}
      </div>
    </section>
  </div>
}
