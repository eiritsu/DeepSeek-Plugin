import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const harness = resolve(import.meta.dirname, '../DeepSeek Harness')

export default defineConfig({
  resolve: {
    alias: [
      { find: '@deepseek-ai/cordis', replacement: resolve(harness, 'vendor/cordis/src/index.ts') },
      { find: '@deepseek-ai/cosmokit', replacement: resolve(harness, 'vendor/cosmokit/src/index.ts') },
      { find: '@deepseek-ai/schemastery', replacement: resolve(harness, 'vendor/schemastery/src/index.ts') },
      { find: '@deepseek-ai/dsh-api-remotes/client', replacement: resolve(harness, 'packages/api/remotes/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-connection/client', replacement: resolve(harness, 'packages/client/connection/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-locale/client', replacement: resolve(harness, 'packages/client/locale/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-runtime/client', replacement: resolve(harness, 'packages/client/runtime/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-ui-layout/client', replacement: resolve(harness, 'packages/client/ui-layout/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-ui-settings/client', replacement: resolve(harness, 'packages/client/ui-settings/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-ui-sidebar/client', replacement: resolve(harness, 'packages/client/ui-sidebar/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-ui-slots', replacement: resolve(harness, 'packages/client/ui-slots/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/*/tests/**/*.spec.{ts,tsx}'],
  },
})
