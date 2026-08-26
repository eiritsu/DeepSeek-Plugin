/**
 * Dynamic model-discovery enrichment backed by models.dev with a persisted
 * last-good snapshot and the installed pi-ai catalog as its offline fallback.
 * Exact provider/model declarations or exact-id shared capabilities are
 * required; route names, wire protocols, and model-name patterns are never
 * capability evidence.
 *
 * @module @deepseek-ai/dsh-model-catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import type { ModelModality } from '@deepseek-ai/dsh-llm'

/** Default dynamic catalog endpoint used by Hermes/pi model generation. */
export const DEFAULT_CATALOG_URL = 'https://models.dev/api.json'
/** Default interval between successful remote catalog checks. */
export const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Default upper bound for one remote catalog request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
/** Default maximum received catalog bytes. */
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** Runtime configuration for dynamic model-catalog refresh. */
export interface Config {
  /** JSON catalog URL using the models.dev provider/model representation. */
  catalogURL?: string
  /** Milliseconds a successful persisted snapshot remains fresh. */
  refreshIntervalMs?: number
  /** Milliseconds before one remote catalog request aborts. */
  requestTimeoutMs?: number
  /** Maximum bytes accepted from one remote catalog response. */
  maxResponseBytes?: number
}

/** Validated plugin configuration. */
export const Config: schema<Config> = schema.object({
  catalogURL: schema.string().default(DEFAULT_CATALOG_URL),
  refreshIntervalMs: schema.number().step(1).min(1).default(DEFAULT_REFRESH_INTERVAL_MS),
  requestTimeoutMs: schema.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxResponseBytes: schema.number().step(1).min(1).default(DEFAULT_MAX_RESPONSE_BYTES),
})

const modalitySchema = z.enum(['text', 'image', 'audio', 'video', 'pdf'])
const declarationSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  input: z.array(modalitySchema).min(1),
})
const catalogCacheSchema = z.object({
  checkedAt: z.number().int().nonnegative(),
  declarations: z.array(declarationSchema),
})
type CatalogDeclaration = z.infer<typeof declarationSchema>
type CatalogCache = z.infer<typeof catalogCacheSchema>

interface CatalogModelRef {
  id: string
  ownedBy?: string
}

const catalogDomainSpec = defineDomain({
  name: 'model_catalog_pi_ai',
  version: 0,
  global: { schema: catalogCacheSchema, initial: { checkedAt: 0, declarations: [] } },
  tables: {},
})

const providerIds = new Set<string>(getBuiltinProviders())
const ambiguous = Symbol('ambiguous-model-modalities')

/** Whether pi-ai ships a catalog under this exact provider owner. */
function isBuiltinProvider(owner: string): owner is BuiltinProvider {
  return providerIds.has(owner)
}

/** Whether two declarations name the same ordered modalities. */
function sameModalities(left: readonly ModelModality[], right: readonly ModelModality[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Normalize a models.dev input list to the complete catalog modality vocabulary. */
function supportedModalities(value: unknown): ModelModality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const input: ModelModality[] = []
  if (value.includes('text')) input.push('text')
  if (value.includes('image')) input.push('image')
  if (value.includes('audio')) input.push('audio')
  if (value.includes('video')) input.push('video')
  if (value.includes('pdf')) input.push('pdf')
  return input.length === 0 ? undefined : input
}

function sameModelId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/** Parse exact provider/model declarations from one models.dev document. */
function parseCatalog(value: unknown): CatalogDeclaration[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dynamic model catalog must be a provider object')
  }
  const declarations: CatalogDeclaration[] = []
  for (const [provider, rawProvider] of Object.entries(value)) {
    if (typeof rawProvider !== 'object' || rawProvider === null || Array.isArray(rawProvider)) continue
    const models = (rawProvider as { models?: unknown }).models
    if (typeof models !== 'object' || models === null || Array.isArray(models)) continue
    for (const [id, rawModel] of Object.entries(models)) {
      if (typeof rawModel !== 'object' || rawModel === null || Array.isArray(rawModel)) continue
      const modalities = supportedModalities(
        (rawModel as { modalities?: { input?: unknown } }).modalities?.input,
      )
      if (modalities !== undefined) declarations.push({ provider, id, input: modalities })
    }
  }
  return declarations
}

/** Read a response under the configured actual-byte ceiling. */
async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok) throw new Error(`dynamic model catalog returned HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('dynamic model catalog returned no body')
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    received += chunk.value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw new Error(`dynamic model catalog exceeded ${maxBytes} bytes`)
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

/** Exact dynamic-catalog lookup with pi-ai fallback for uncovered ids. */
class DynamicCatalog {
  private cache: CatalogCache
  private inflight: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly global: DomainGlobal<CatalogCache>,
    private readonly config: Required<Config>,
  ) {
    this.cache = global.get()
  }

  /** Refresh stale metadata once and retain the persisted snapshot on failure. */
  async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (Date.now() - this.cache.checkedAt < this.config.refreshIntervalMs) return
    this.inflight ??= this.fetchAndStore().finally(() => { this.inflight = undefined })
    try {
      await this.inflight
    } catch (error) {
      this.ctx.logger.warn(`dynamic model catalog refresh failed; using last-good metadata: ${String(error)}`)
    }
    signal?.throwIfAborted()
  }

  /** Resolve one discovered model from dynamic declarations, then pi-ai. */
  modalities(model: CatalogModelRef): readonly ModelModality[] | undefined {
    const remote = this.cache.declarations.filter(candidate => sameModelId(candidate.id, model.id))
    if (remote.length > 0) return this.resolveDeclarations(remote, model.ownedBy)
    if (model.ownedBy !== undefined && isBuiltinProvider(model.ownedBy)) {
      return getBuiltinModels(model.ownedBy).find(candidate => sameModelId(candidate.id, model.id))?.input
    }
    return this.consensus(getBuiltinProviders().flatMap(provider =>
      getBuiltinModels(provider)
        .filter(candidate => sameModelId(candidate.id, model.id))
        .map(candidate => candidate.input),
    ))
  }

  private async fetchAndStore(): Promise<void> {
    const response = await fetch(this.config.catalogURL, {
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { accept: 'application/json' },
    })
    const declarations = parseCatalog(await readBoundedJson(response, this.config.maxResponseBytes))
    const cache = { checkedAt: Date.now(), declarations }
    await this.global.set(cache)
    this.cache = cache
  }

  private resolveDeclarations(
    declarations: readonly CatalogDeclaration[],
    owner: string | undefined,
  ): readonly ModelModality[] | undefined {
    if (owner !== undefined) {
      const owned = declarations.filter(candidate => candidate.provider === owner)
      if (owned.length > 0) return this.consensus(owned.map(candidate => candidate.input))
    }
    return this.consensus(declarations.map(candidate => candidate.input))
  }

  private consensus(
    candidates: readonly (readonly ModelModality[])[],
  ): readonly ModelModality[] | undefined {
    let current: readonly ModelModality[] | typeof ambiguous | undefined
    for (const candidate of candidates) {
      if (current === ambiguous) break
      if (current === undefined) current = candidate
      else if (!sameModalities(current, candidate)) current = ambiguous
    }
    return current === ambiguous ? undefined : current
  }
}

/** Cordis plugin name. */
export const name = 'model-catalog'
/** Services required by dynamic enrichment and durable last-good storage. */
export const inject = ['llm', 'storageDomain']

/** Register dynamic exact-catalog modality enrichment. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(catalogDomainSpec)
  ctx.effect(() => () => domain.close(), 'modelCatalogPiAi.domainClose')
  const catalog = new DynamicCatalog(ctx, domain.global, {
    catalogURL: config.catalogURL ?? DEFAULT_CATALOG_URL,
    refreshIntervalMs: config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  })
  ctx.llm.registerModelDiscoveryEnricher(async ({ request, models }) => {
    await catalog.refresh(request.signal)
    return models.flatMap((model) => {
      if (model.inputModalities !== undefined) return []
      const modalities = catalog.modalities(model)
      return modalities === undefined ? [] : [{ id: model.id, inputModalities: [...modalities] }]
    })
  })
  ctx.llm.registerModelInputResolver(async ({ provider, model, ownedBy, signal }) => {
    await catalog.refresh(signal)
    return catalog.modalities({ id: model, ownedBy: ownedBy ?? provider })
  })
}
