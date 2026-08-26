import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/PluginLibraryOverlay.module.css', import.meta.url)),
  'utf8',
)

function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('PluginLibraryOverlay.module.css', () => {
  it('uses the same fixed canvas contract as the settings modal', () => {
    const surface = declarations('.surface')
    expect(surface?.get('width')).toBe('800px')
    expect(surface?.get('height')).toBe('min(800px, calc(100vh - 48px))')
    expect(surface?.get('max-width')).toBe('calc(100vw - 48px)')
    expect(surface?.get('border-radius')).toBe('24px')
    expect(surface?.get('overflow')).toBe('hidden')
  })
})
