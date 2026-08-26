import { isBuiltin } from 'node:module'

const library = {
  entry: [
    'lib/types/index.js',
    'lib/types/auth-status.js',
    'lib/types/conversation.js',
    'lib/types/invariant.js',
    'lib/types/permissions.js',
    'lib/types/command-risk.js',
    'lib/types/pending-user-auth.js',
  ],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => isBuiltin(specifier) || !specifier.startsWith('.'),
  },
}

export default ({ env }: { env?: Record<string, unknown> }) => env?.DSH_BUILD_FACE === 'client'
  ? { entry: '' }
  : library
