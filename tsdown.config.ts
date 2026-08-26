import { defineConfig } from 'tsdown'

export default defineConfig(({ env }) => {
  void env
  return {
    workspace: ['packages/*/*'],
    entry: '',
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }
})
