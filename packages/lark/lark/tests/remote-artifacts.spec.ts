import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Lark generated Remote artifacts', () => {
  it('publishes matching strict Host and Client descriptor sets', async () => {
    const host = await import('../lib/typert.host.js') as { TYPERT: { invocations: unknown[] } }
    const remote = await import('../lib/typert.remote-client.js') as { TYPERT_REMOTE: { descriptors: unknown[] } }
    expect(host.TYPERT.invocations).toHaveLength(7)
    const identity = (value: unknown[]) => value.map((entry) => {
      const descriptor = entry as { id: string; service: string; namespace: string; method: string }
      return {
        id: descriptor.id,
        service: descriptor.service,
        namespace: descriptor.namespace,
        method: descriptor.method,
      }
    })
    expect(identity(remote.TYPERT_REMOTE.descriptors)).toEqual(identity(host.TYPERT.invocations))
  })

  it('keeps the batch permission payload out of the browser component source', () => {
    const component = readFileSync(resolve(import.meta.dirname, '../../../client/ui-lark/src/client/LarkManagementSection.tsx'), 'utf8')
    expect(component).not.toContain('"scopes"')
    expect(component).not.toContain('permissionTemplate}')
  })

  it('assembles the browser bundle under the side-loaded package subpath', () => {
    const client = readFileSync(resolve(import.meta.dirname, '../lib/client.js'), 'utf8')
    expect(client).toContain('id: "@deepseek-ai/dsh-lark/ui"')
    expect(client).not.toContain('@deepseek-ai/dsh-client-ui-lark')
  })

  it('passes App Secret through stdin instead of environment or argv', () => {
    const host = readFileSync(resolve(import.meta.dirname, '../src/index.ts'), 'utf8')
    expect(host).toContain("'--app-secret-stdin'")
    expect(host).toContain('`${appSecret}\\n`')
    expect(host).toContain("LARKSUITE_CLI_BIN_DIR: join(resolveDshHome(), 'lark-cli-bin', 'v1.0.90')")
    expect(host).not.toContain('LARKSUITE_CLI_APP_SECRET:')
  })
})
