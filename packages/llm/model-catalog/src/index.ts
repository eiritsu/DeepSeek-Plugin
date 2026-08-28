/**
 * Dynamic model-discovery and capacity enrichment backed by models.dev with a
 * persisted last-good snapshot and the installed pi-ai catalog as its offline
 * fallback.
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
import type {
  LegacyModelModality,
  LlmModelCapacity,
  LlmModelMetadataPatch,
  ModelModality,
} from '@deepseek-ai/dsh-llm'

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
  input: z.array(modalitySchema).min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
}).refine(declaration => declaration.input !== undefined
  || declaration.contextWindow !== undefined
  || declaration.maxOutputTokens !== undefined, {
  message: 'catalog declaration must contain supported metadata',
})
const providerSchema = z.object({
  id: z.string().min(1),
  api: z.string().min(1).optional(),
})
const catalogCacheSchema = z.object({
  format: z.union([z.literal(1), z.literal(2)]).optional(),
  checkedAt: z.number().int().nonnegative(),
  providers: z.array(providerSchema).optional(),
  declarations: z.array(declarationSchema),
})
type CatalogDeclaration = z.infer<typeof declarationSchema>
type CatalogCache = z.infer<typeof catalogCacheSchema>
type CatalogProvider = z.infer<typeof providerSchema>
type CatalogModality = z.infer<typeof modalitySchema>

interface CatalogModelRef {
  id: string
  ownedBy?: string
  baseURL?: string
}

const catalogDomainSpec = defineDomain({
  name: 'model_catalog_pi_ai',
  version: 0,
  global: {
    schema: catalogCacheSchema,
    initial: { format: 2 as const, checkedAt: 0, providers: [], declarations: [] },
  },
  tables: {},
})

const providerIds = new Set<string>(getBuiltinProviders())
const ambiguous = Symbol('ambiguous-model-metadata')

interface CatalogMetadata extends LlmModelCapacity {
  input?: readonly LegacyModelModality[]
  contextWindow?: number
  maxOutputTokens?: number
}

type CatalogResolution<T> = { covered: false } | { covered: true; value: T | undefined }

/** Whether pi-ai ships a catalog under this exact provider owner. */
function isBuiltinProvider(owner: string): owner is BuiltinProvider {
  return providerIds.has(owner)
}

/** Whether two declarations name the same ordered modalities. */
function sameModalities(left: readonly CatalogModality[], right: readonly CatalogModality[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Normalize a models.dev input list to modalities the current LLM request vocabulary accepts. */
function supportedModalities(value: unknown): LegacyModelModality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const input: LegacyModelModality[] = []
  if (value.includes('text')) input.push('text')
  if (value.includes('image')) input.push('image')
  if (value.includes('audio')) input.push('audio')
  if (value.includes('video')) input.push('video')
  if (value.includes('pdf')) input.push('pdf')
  return input.length === 0 ? undefined : input
}

/** Normalize one catalog capacity to a positive integer. */
function supportedCapacity(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : undefined
}

function sameModelId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/** Normalize an endpoint for exact provider-API comparison. */
function normalizedEndpoint(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.href.replace(/\/$/, '')
  } catch {
    return undefined
  }
}

/** Parse exact provider/model declarations from one models.dev document. */
function parseCatalog(value: unknown): {
  providers: CatalogProvider[]
  declarations: CatalogDeclaration[]
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dynamic model catalog must be a provider object')
  }
  const providers: CatalogProvider[] = []
  const declarations: CatalogDeclaration[] = []
  for (const [provider, rawProvider] of Object.entries(value)) {
    if (typeof rawProvider !== 'object' || rawProvider === null || Array.isArray(rawProvider)) continue
    const api = typeof (rawProvider as { api?: unknown }).api === 'string'
      && (rawProvider as { api: string }).api.length > 0
      ? (rawProvider as { api: string }).api
      : undefined
    providers.push({ id: provider, ...api === undefined ? {} : { api } })
    const models = (rawProvider as { models?: unknown }).models
    if (typeof models !== 'object' || models === null || Array.isArray(models)) continue
    for (const [id, rawModel] of Object.entries(models)) {
      if (typeof rawModel !== 'object' || rawModel === null || Array.isArray(rawModel)) continue
      const input = supportedModalities(
        (rawModel as { modalities?: { input?: unknown } }).modalities?.input,
      )
      const limit = (rawModel as { limit?: { context?: unknown; output?: unknown } }).limit
      const contextWindow = supportedCapacity(limit?.context)
      const maxOutputTokens = supportedCapacity(limit?.output)
      if (input !== undefined || contextWindow !== undefined || maxOutputTokens !== undefined) {
        declarations.push({
          provider,
          id,
          ...input === undefined ? {} : { input },
          ...contextWindow === undefined ? {} : { contextWindow },
          ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
        })
      }
    }
  }
  return { providers, declarations }
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
    const persisted = global.get()
    this.cache = persisted.format === 2
      ? persisted
      : { ...persisted, checkedAt: 0, providers: persisted.providers ?? [] }
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

  /** Resolve supported metadata from dynamic declarations, then pi-ai. */
  metadata(model: CatalogModelRef): CatalogMetadata {
    const remote = this.cache.declarations.filter(candidate => sameModelId(candidate.id, model.id))
    const owners = this.exactOwners(model, remote)
    const input = this.resolveField(remote, owners, candidate => candidate.input, sameModalities)
    const contextWindow = this.resolveField(
      remote,
      owners,
      candidate => candidate.contextWindow,
      (left, right) => left === right,
    )
    const maxOutputTokens = this.resolveField(
      remote,
      owners,
      candidate => candidate.maxOutputTokens,
      (left, right) => left === right,
    )
    const builtin = this.builtin(model, owners)
    const resolvedInput = input.covered ? supportedModalities(input.value) : builtin.input
    const resolvedContextWindow = contextWindow.covered ? contextWindow.value : builtin.contextWindow
    const resolvedMaxOutputTokens = maxOutputTokens.covered ? maxOutputTokens.value : builtin.maxOutputTokens
    return {
      ...resolvedInput === undefined ? {} : { input: resolvedInput },
      ...resolvedContextWindow === undefined ? {} : { contextWindow: resolvedContextWindow },
      ...resolvedMaxOutputTokens === undefined ? {} : { maxOutputTokens: resolvedMaxOutputTokens },
    }
  }

  private builtin(model: CatalogModelRef, owners: readonly string[]): CatalogMetadata {
    const owner = owners.length === 1 ? owners[0] : model.ownedBy
    if (owner !== undefined && isBuiltinProvider(owner)) {
      const hit = getBuiltinModels(owner).find(candidate => sameModelId(candidate.id, model.id))
      if (hit === undefined) return {}
      const input = supportedModalities(hit.input)
      return {
        ...input === undefined ? {} : { input },
        contextWindow: hit.contextWindow,
        maxOutputTokens: hit.maxTokens,
      }
    }
    const candidates = getBuiltinProviders().flatMap(provider =>
      getBuiltinModels(provider)
        .filter(candidate => sameModelId(candidate.id, model.id)),
    )
    const inputs = candidates.flatMap((candidate) => {
      const input = supportedModalities(candidate.input)
      return input === undefined ? [] : [input]
    })
    const input = this.consensus(inputs, sameModalities)
    const contextWindow = this.consensus(
      candidates.map(candidate => candidate.contextWindow),
      (left, right) => left === right,
    )
    const maxOutputTokens = this.consensus(
      candidates.map(candidate => candidate.maxTokens),
      (left, right) => left === right,
    )
    return {
      ...input === undefined ? {} : { input },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
    }
  }

  private async fetchAndStore(): Promise<void> {
    const response = await fetch(this.config.catalogURL, {
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { accept: 'application/json' },
    })
    const { providers, declarations } = parseCatalog(
      await readBoundedJson(response, this.config.maxResponseBytes),
    )
    const cache = { format: 2 as const, checkedAt: Date.now(), providers, declarations }
    await this.global.set(cache)
    this.cache = cache
  }

  private resolveField<T>(
    declarations: readonly CatalogDeclaration[],
    owners: readonly string[],
    select: (declaration: CatalogDeclaration) => T | undefined,
    equals: (left: T, right: T) => boolean,
  ): CatalogResolution<T> {
    if (owners.length > 0) {
      const ownerSet = new Set(owners)
      const owned = declarations.filter(candidate => ownerSet.has(candidate.provider))
      const values = owned.map(select).filter((value): value is T => value !== undefined)
      if (owned.length > 0) {
        return values.length === 0
          ? { covered: false }
          : { covered: true, value: this.consensus(values, equals) }
      }
    }
    const values = declarations.map(select).filter((value): value is T => value !== undefined)
    return values.length === 0
      ? { covered: false }
      : { covered: true, value: this.consensus(values, equals) }
  }

  private exactOwners(
    model: CatalogModelRef,
    declarations: readonly CatalogDeclaration[],
  ): string[] {
    if (model.ownedBy !== undefined
      && declarations.some(candidate => candidate.provider === model.ownedBy)) {
      return [model.ownedBy]
    }
    const endpoint = normalizedEndpoint(model.baseURL)
    if (endpoint === undefined) return []
    return (this.cache.providers ?? [])
      .filter(provider => normalizedEndpoint(provider.api) === endpoint)
      .map(provider => provider.id)
  }

  private consensus<T>(candidates: readonly T[], equals: (left: T, right: T) => boolean): T | undefined {
    let current: T | typeof ambiguous | undefined
    for (const candidate of candidates) {
      if (current === ambiguous) break
      if (current === undefined) current = candidate
      else if (!equals(current, candidate)) current = ambiguous
    }
    return current === ambiguous ? undefined : current
  }
}

/** Cordis plugin name. */
export const name = 'model-catalog'
/** Services required by dynamic enrichment and durable last-good storage. */
export const inject = ['llm', 'storageDomain']

/** Register dynamic exact-route modality and capacity enrichment. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(catalogDomainSpec)
  ctx.effect(() => () => domain.close(), 'modelCatalogPiAi.domainClose')
  const catalog = new DynamicCatalog(ctx, domain.global, {
    catalogURL: config.catalogURL ?? DEFAULT_CATALOG_URL,
    refreshIntervalMs: config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  })
  ctx.llm.registerModelMetadataEnricher('models.dev', async ({ provider, model, metadata, signal }) => {
    await catalog.refresh(signal)
    const resolved = catalog.metadata({ id: model, ownedBy: provider })
    const currentInput = resolved.input?.filter(
      (modality): modality is ModelModality => modality === 'text' || modality === 'image',
    )
    const patch: LlmModelMetadataPatch = {
      ...metadata.inputModalities === undefined && currentInput !== undefined
        ? { inputModalities: currentInput } : {},
      ...metadata.context === undefined && resolved.contextWindow !== undefined
        ? { contextWindow: resolved.contextWindow } : {},
      ...metadata.defaultMaxTokens === undefined && resolved.maxOutputTokens !== undefined
        ? { maxTokens: resolved.maxOutputTokens } : {},
    }
    return Object.keys(patch).length === 0 ? undefined : patch
  })
  ctx.llm.registerModelDiscoveryEnricher(async ({ request, models }) => {
    await catalog.refresh(request.signal)
    return models.flatMap((model) => {
      const metadata = catalog.metadata({
        ...model,
        ...request.baseURL === undefined ? {} : { baseURL: request.baseURL },
      })
      const patch = {
        id: model.id,
        ...model.contextWindow === undefined && metadata.contextWindow !== undefined
          ? { contextWindow: metadata.contextWindow } : {},
        ...model.maxTokens === undefined && metadata.maxOutputTokens !== undefined
          ? { maxTokens: metadata.maxOutputTokens } : {},
        ...model.inputModalities === undefined && metadata.input !== undefined
          ? { inputModalities: [...metadata.input] } : {},
      }
      return Object.keys(patch).length === 1 ? [] : [patch]
    })
  })
  ctx.llm.registerModelInputResolver(async ({ provider, model, ownedBy, baseURL, signal }) => {
    await catalog.refresh(signal)
    return catalog.metadata({
      id: model,
      ownedBy: ownedBy ?? provider,
      ...baseURL === undefined ? {} : { baseURL },
    }).input
  })
  ctx.llm.registerModelCapacityResolver(async ({ provider, model, ownedBy, baseURL, signal }) => {
    await catalog.refresh(signal)
    const { contextWindow, maxOutputTokens } = catalog.metadata({
      id: model,
      ownedBy: ownedBy ?? provider,
      ...baseURL === undefined ? {} : { baseURL },
    })
    return contextWindow === undefined && maxOutputTokens === undefined
      ? undefined
      : {
          ...contextWindow === undefined ? {} : { contextWindow },
          ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
        }
  })
}
