/** Emit strict Typert descriptor/codec artifacts for the external Lark package. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve(import.meta.dirname, '../packages/lark/lark/lib')
mkdirSync(output, { recursive: true })

const schemas = `import { z } from 'zod'

const capabilityId = z.union([${[
  'calendar', 'im', 'docs', 'drive', 'markdown', 'base', 'sheets', 'slides', 'task',
  'wiki', 'contact', 'mail', 'meeting', 'attendance', 'approval', 'okr', 'apps',
].map(value => `z.literal(${JSON.stringify(value)})`).join(', ')}])
const identityStatus = z.object({
  status: z.string().readonly(),
  available: z.boolean().readonly(),
  verified: z.boolean().optional().readonly(),
}).readonly()
const capabilityStatus = z.object({
  id: capabilityId.readonly(),
  label: z.string().readonly(),
  state: z.union([z.literal('granted'), z.literal('missing'), z.literal('unknown')]).readonly(),
  missingScopes: z.array(z.string()).readonly(),
}).readonly()
const managementStatus = z.object({
  appId: z.string().readonly(),
  brand: z.union([z.literal('feishu'), z.literal('lark')]).readonly(),
  credentialMode: z.union([z.literal('none'), z.literal('managed'), z.literal('self-built')]).readonly(),
  secretConfigured: z.boolean().readonly(),
  secretWritable: z.boolean().readonly(),
  cliAvailable: z.boolean().readonly(),
  bot: identityStatus,
  user: identityStatus,
  capabilities: z.array(capabilityStatus).readonly(),
  permissionTemplate: z.string().readonly(),
  diagnostic: z.string().optional().readonly(),
}).readonly()
const applicationInput = z.object({
  appId: z.string().readonly(),
  brand: z.union([z.literal('feishu'), z.literal('lark')]).readonly(),
  appSecret: z.string().optional().readonly(),
}).readonly()
const authRequest = z.object({
  verificationUrl: z.string().readonly(),
  deviceCode: z.string().readonly(),
}).readonly()
const managedRegistrationRequest = z.object({
  verificationUrl: z.string().readonly(),
}).readonly()
`

const invocations = `[
  {
    id: '@deepseek-ai/dsh-lark#larkManagement/status',
    service: 'larkManagement', namespace: 'larkManagement', method: 'status',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#LarkManagementStatus', schema: managementStatus },
    sourceLocation: { file: 'packages/lark/lark/src/index.ts', line: 190, column: 3 },
  },
  {
    id: '@deepseek-ai/dsh-lark#larkManagement/saveApplication',
    service: 'larkManagement', namespace: 'larkManagement', method: 'saveApplication',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#LarkApplicationInput', schema: applicationInput } }],
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#void', schema: z.undefined() },
    sourceLocation: { file: 'packages/lark/lark/src/index.ts', line: 244, column: 3 },
  },
  {
    id: '@deepseek-ai/dsh-lark#larkManagement/clearSecret',
    service: 'larkManagement', namespace: 'larkManagement', method: 'clearSecret',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#void', schema: z.undefined() },
    sourceLocation: { file: 'packages/lark/lark/src/index.ts', line: 257, column: 3 },
  },
  {
    id: '@deepseek-ai/dsh-lark#larkManagement/beginManagedRegistration',
    service: 'larkManagement', namespace: 'larkManagement', method: 'beginManagedRegistration',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'brand', wire: 'brand', source: 'json', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#brand', schema: z.union([z.literal('feishu'), z.literal('lark')]) } }],
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#LarkManagedRegistrationRequest', schema: managedRegistrationRequest },
    sourceLocation: { file: 'packages/lark/lark/src/index.ts', line: 290, column: 3 },
  },
  {
    id: '@deepseek-ai/dsh-lark#larkManagement/completeManagedRegistration',
    service: 'larkManagement', namespace: 'larkManagement', method: 'completeManagedRegistration',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#void', schema: z.undefined() },
    sourceLocation: { file: 'packages/lark/lark/src/index.ts', line: 304, column: 3 },
  },
  {
    id: '@deepseek-ai/dsh-lark#larkManagement/beginUserAuth',
    service: 'larkManagement', namespace: 'larkManagement', method: 'beginUserAuth',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#LarkUserAuthRequest', schema: authRequest },
    sourceLocation: { file: 'packages/lark/lark/src/index.ts', line: 264, column: 3 },
  },
  {
    id: '@deepseek-ai/dsh-lark#larkManagement/completeUserAuth',
    service: 'larkManagement', namespace: 'larkManagement', method: 'completeUserAuth',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'deviceCode', wire: 'deviceCode', source: 'json', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#string', schema: z.string() } }],
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-lark#void', schema: z.undefined() },
    sourceLocation: { file: 'packages/lark/lark/src/index.ts', line: 278, column: 3 },
  },
]`

const header = '/* Generated by scripts/generate-typert.ts — do not edit. */\n'
const host = `${header}${schemas}\nexport const TYPERT = {\n  package: '@deepseek-ai/dsh-lark',\n  face: 'host',\n  schemas: [],\n  invocations: ${invocations},\n  model: { services: [], events: [], objects: [] },\n}\n`
const remote = `${header}${schemas}\nexport const TYPERT_REMOTE = {\n  package: '@deepseek-ai/dsh-lark',\n  descriptors: ${invocations},\n}\n\nexport default TYPERT_REMOTE\n`
const remoteTypes = `${header}import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { LarkApplicationInput, LarkManagedRegistrationRequest, LarkManagementStatus, LarkUserAuthRequest } from '@deepseek-ai/dsh-lark'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6c61726b4d616e6167656d656e74 {
    status: () => Promise<RemoteResult<LarkManagementStatus>>
    saveApplication: (input: LarkApplicationInput) => Promise<RemoteResult<void>>
    clearSecret: () => Promise<RemoteResult<void>>
    beginManagedRegistration: (brand: 'feishu' | 'lark') => Promise<RemoteResult<LarkManagedRegistrationRequest>>
    completeManagedRegistration: () => Promise<RemoteResult<void>>
    beginUserAuth: () => Promise<RemoteResult<LarkUserAuthRequest>>
    completeUserAuth: (deviceCode: string) => Promise<RemoteResult<void>>
  }
  interface TypertRemoteMap {
    'larkManagement/status': TypertRemoteNamespace$6c61726b4d616e6167656d656e74['status']
    'larkManagement/saveApplication': TypertRemoteNamespace$6c61726b4d616e6167656d656e74['saveApplication']
    'larkManagement/clearSecret': TypertRemoteNamespace$6c61726b4d616e6167656d656e74['clearSecret']
    'larkManagement/beginManagedRegistration': TypertRemoteNamespace$6c61726b4d616e6167656d656e74['beginManagedRegistration']
    'larkManagement/completeManagedRegistration': TypertRemoteNamespace$6c61726b4d616e6167656d656e74['completeManagedRegistration']
    'larkManagement/beginUserAuth': TypertRemoteNamespace$6c61726b4d616e6167656d656e74['beginUserAuth']
    'larkManagement/completeUserAuth': TypertRemoteNamespace$6c61726b4d616e6167656d656e74['completeUserAuth']
  }
  interface TypertRemoteNamespaceMap {
    larkManagement: TypertRemoteNamespace$6c61726b4d616e6167656d656e74
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
`

writeFileSync(resolve(output, 'typert.host.js'), host)
writeFileSync(resolve(output, 'typert.host.d.ts'), `${header}export declare const TYPERT: unknown\n`)
writeFileSync(resolve(output, 'typert.remote-client.js'), remote)
writeFileSync(resolve(output, 'typert.remote-client.d.ts'), remoteTypes)
writeFileSync(resolve(output, 'typert.remote-client.d.ts.map'), JSON.stringify({ version: 3, file: 'typert.remote-client.d.ts', sources: [], names: [], mappings: '' }))
