/** Assemble the Lark browser face into the side-loadable dual-face package. */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ui = resolve(root, 'packages/client/ui-lark/lib')
const host = resolve(root, 'packages/lark/lark/lib')

const developmentId = '@deepseek-ai/dsh-client-ui-lark'
const sideLoadId = '@deepseek-ai/dsh-lark'
const client = readFileSync(resolve(ui, 'client.js'), 'utf8')
if (!client.includes(developmentId)) {
  throw new Error(`Lark client bundle does not register its development package id: ${developmentId}`)
}
writeFileSync(resolve(host, 'client.js'), client.replaceAll(developmentId, sideLoadId))
