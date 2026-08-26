/** Real Loader composition for the model-catalog bundle. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import * as ModelCatalogPiAi from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllGlobals()
})

const TestDiscovery = {
  name: 'test-model-discovery',
  inject: ['llm'],
  apply(ctx: Context): void {
    ctx.llm.registerModelDiscovery('llm-test', () => Promise.resolve<readonly LlmDiscoveredModel[]>([
      { id: 'gpt-5.6-luna', ownedBy: 'custom' },
      { id: 'text-model', ownedBy: 'openai', inputModalities: ['text'] },
    ]))
  },
}

describe('model-catalog real Loader composition', () => {
  it('enriches a mixed endpoint through ordinary cordis.yml mounting', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-composition-'))
    const configPath = join(root, 'cordis.yml')
    const storagePath = join(root, 'storage')
    await writeFile(configPath, [
      '- id: storage',
      "  name: 'test-storage'",
      '- id: storage-json',
      "  name: 'test-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(storagePath)}`,
      '- id: storage-domain',
      "  name: 'test-storage-domain'",
      '  config:',
      '    backend: json',
      '- id: llm',
      "  name: 'test-llm-service'",
      '- id: discovery',
      "  name: 'test-model-discovery'",
      '- id: model-catalog',
      "  name: '@deepseek-ai/dsh-model-catalog'",
      '  config:',
      '    refreshIntervalMs: 60000',
      '',
    ].join('\n'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({})))) )

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-llm-service', LlmRuntime],
      ['test-storage', Storage],
      ['test-storage-json', StorageJson],
      ['test-storage-domain', StorageDomain],
      ['test-model-discovery', TestDiscovery],
      ['@deepseek-ai/dsh-model-catalog', ModelCatalogPiAi],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    await expect(ctx.llm.discoverModels('llm-test', { provider: 'gateway' })).resolves.toEqual([
      { id: 'gpt-5.6-luna', ownedBy: 'custom', inputModalities: ['text', 'image'] },
      { id: 'text-model', ownedBy: 'openai', inputModalities: ['text'] },
    ])
  })

  it('supplies runtime image capability to a newly declared pi-ai model', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-model-catalog-runtime-'))
    const configPath = join(root, 'cordis.yml')
    const storagePath = join(root, 'storage')
    await writeFile(configPath, [
      '- id: storage',
      "  name: 'test-storage'",
      '- id: storage-json',
      "  name: 'test-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(storagePath)}`,
      '- id: storage-domain',
      "  name: 'test-storage-domain'",
      '  config:',
      '    backend: json',
      '- id: llm',
      "  name: 'test-llm-service'",
      '- id: pi-ai',
      "  name: 'test-llm-pi-ai'",
      '  config:',
      '    providers:',
      '      a6:',
      '        api: openai-responses',
      '        baseURL: https://gateway.example/v1',
      '        models:',
      '          - id: gemini-3.7-flash',
      '          - id: forced-text',
      '            input: [text]',
      '      google:',
      '        models:',
      '          - id: gemini-3.7-flash',
      '- id: model-catalog',
      "  name: '@deepseek-ai/dsh-model-catalog'",
      '  config:',
      '    refreshIntervalMs: 60000',
      '',
    ].join('\n'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      google: {
        models: {
          'gemini-3.7-flash': { modalities: { input: ['text', 'image', 'audio', 'video', 'pdf'] } },
          'forced-text': { modalities: { input: ['text', 'image', 'audio', 'video', 'pdf'] } },
        },
      },
    })))))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-llm-service', LlmRuntime],
      ['test-llm-pi-ai', LlmPiAi],
      ['test-storage', Storage],
      ['test-storage-json', StorageJson],
      ['test-storage-domain', StorageDomain],
      ['@deepseek-ai/dsh-model-catalog', ModelCatalogPiAi],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    await expect(ctx.llm.resolveModelInfo('a6', 'gemini-3.7-flash')).resolves.toMatchObject({
      inputModalities: ['text', 'image'],
    })
    await expect(ctx.llm.prepareCall({ provider: 'a6', model: 'gemini-3.7-flash' }))
      .resolves.toMatchObject({ inputModalities: ['text', 'image'] })
    await expect(ctx.llm.resolveModelInfo('a6', 'forced-text')).resolves.toMatchObject({
      inputModalities: ['text'],
    })
    await expect(ctx.llm.resolveModelInfo('google', 'gemini-3.7-flash')).resolves.toMatchObject({
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    })
  })
})
