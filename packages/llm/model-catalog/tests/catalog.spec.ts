import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as ModelCatalogPiAi from '../src/index.ts'

let context: Context | undefined
let storageRoot: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (storageRoot !== undefined) await rm(storageRoot, { recursive: true, force: true })
  storageRoot = undefined
  vi.unstubAllGlobals()
})

async function mountRuntime(ctx: Context): Promise<void> {
  storageRoot = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-'))
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: storageRoot })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LlmRuntime)
}

describe('pi-ai model-discovery catalog', () => {
  it('uses exact owners or exact-id consensus and withdraws enrichment on disposal', async () => {
    const ctx = new Context()
    context = ctx
    await mountRuntime(ctx)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      xai: { models: { 'grok-4.6': { modalities: { input: ['text', 'image', 'audio', 'video', 'pdf'] } } } },
      gateway: { models: { 'grok-4.6': { modalities: { input: ['pdf', 'video', 'audio', 'image', 'text'] } } } },
    })))))
    ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([
      { id: 'gpt-5.6-luna', ownedBy: 'custom' },
      { id: 'gpt-5.6-terra', ownedBy: 'openai' },
      { id: 'unknown-model', ownedBy: 'openai' },
      { id: 'gpt-5.6-sol' },
      { id: 'grok-4.6', ownedBy: 'custom' },
      { id: 'gpt-5.3-codex-spark', ownedBy: 'custom' },
    ]))
    ctx.llm.registerModelDiscovery('llm-xai', () => Promise.resolve([
      { id: 'grok-4.6', ownedBy: 'xai' },
    ]))
    ctx.llm.registerModelDiscovery('llm-openai', () => Promise.resolve([
      { id: 'gpt-5.3-codex-spark', ownedBy: 'openai' },
    ]))
    ctx.llm.registerModelDiscovery('llm-codex', () => Promise.resolve([
      { id: 'gpt-5.3-codex-spark', ownedBy: 'openai-codex' },
    ]))
    ctx.llm.registerModelDiscovery('llm-explicit', () => Promise.resolve([
      { id: 'gpt-5.6-luna', ownedBy: 'custom', inputModalities: ['text'] },
    ]))
    const plugin = await ctx.plugin(ModelCatalogPiAi, { refreshIntervalMs: 60_000 })

    await expect(ctx.llm.discoverModels('llm-example', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.6-luna', ownedBy: 'custom', inputModalities: ['text', 'image'] },
      { id: 'gpt-5.6-terra', ownedBy: 'openai', inputModalities: ['text', 'image'] },
      { id: 'unknown-model', ownedBy: 'openai' },
      { id: 'gpt-5.6-sol', inputModalities: ['text', 'image'] },
      { id: 'grok-4.6', ownedBy: 'custom', inputModalities: ['text', 'image', 'audio', 'video', 'pdf'] },
      { id: 'gpt-5.3-codex-spark', ownedBy: 'custom' },
    ])
    await expect(ctx.llm.discoverModels('llm-xai', { provider: 'gateway' })).resolves.toEqual([
      { id: 'grok-4.6', ownedBy: 'xai', inputModalities: ['text', 'image', 'audio', 'video', 'pdf'] },
    ])
    await expect(ctx.llm.discoverModels('llm-openai', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.3-codex-spark', ownedBy: 'openai', inputModalities: ['text', 'image'] },
    ])
    await expect(ctx.llm.discoverModels('llm-codex', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.3-codex-spark', ownedBy: 'openai-codex', inputModalities: ['text'] },
    ])
    await expect(ctx.llm.discoverModels('llm-explicit', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.6-luna', ownedBy: 'custom', inputModalities: ['text'] },
    ])
    await expect(ctx.llm.resolveModelInput('gateway', 'grok-4.6'))
      .resolves.toEqual(['text', 'image', 'audio', 'video', 'pdf'])
    await expect(ctx.llm.resolveModelInput('openai-codex', 'gpt-5.3-codex-spark'))
      .resolves.toEqual(['text'])
    await expect(ctx.llm.resolveModelInput('gateway', 'unknown-model')).resolves.toBeUndefined()

    await plugin.dispose()
    await expect(ctx.llm.resolveModelInput('gateway', 'grok-4.6')).resolves.toBeUndefined()
    await expect(ctx.llm.discoverModels('llm-example', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.6-luna', ownedBy: 'custom' },
      { id: 'gpt-5.6-terra', ownedBy: 'openai' },
      { id: 'unknown-model', ownedBy: 'openai' },
      { id: 'gpt-5.6-sol' },
      { id: 'grok-4.6', ownedBy: 'custom' },
      { id: 'gpt-5.3-codex-spark', ownedBy: 'custom' },
    ])
  })

  it('declares one parseable Profile Bundle patch', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(parsed).toEqual([{
      insert: [{
        id: 'model-catalog',
        name: '@deepseek-ai/dsh-model-catalog',
        config: {
          catalogURL: 'https://models.dev/api.json',
          refreshIntervalMs: 86_400_000,
          requestTimeoutMs: 15_000,
          maxResponseBytes: 8_388_608,
        },
      }],
    }])
  })
})
