/** Assemble the Lark UI faces into the single side-loadable bundle package. */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ui = resolve(root, 'packages/client/ui-lark/lib')
const host = resolve(root, 'packages/lark/lark/lib')

copyFileSync(resolve(ui, 'index.js'), resolve(host, 'ui.js'))
const developmentId = '@deepseek-ai/dsh-client-ui-lark'
const sideLoadId = '@deepseek-ai/dsh-lark/ui'
const client = readFileSync(resolve(ui, 'client.js'), 'utf8')
if (!client.includes(developmentId)) {
  throw new Error(`Lark client bundle does not register its development package id: ${developmentId}`)
}
writeFileSync(resolve(host, 'client.js'), client.replaceAll(developmentId, sideLoadId))
writeFileSync(resolve(host, 'ui.package.json'), `${JSON.stringify({
  name: '@deepseek-ai/dsh-lark/ui',
  type: 'module',
  exports: {
    './client': './client.js',
    './package.json': './ui.package.json',
  },
  dsh: {
    client: {
      inject: [
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-settings',
      ],
      platform: 'web',
    },
  },
}, null, 2)}\n`)
