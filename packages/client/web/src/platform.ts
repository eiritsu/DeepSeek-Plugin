/** Module identities shared by the DSH browser shell and external bundles. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** Dynamic client modules whose factories are preloaded by the DSH shell. */
export const PRELOADED_CLIENT_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client'] as const
