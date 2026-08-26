import { describe, expect, it } from 'vitest'
import {
  commandHelpArguments,
  helpDeclaresReadOnly,
  isDirectReadOnlyCommand,
  normalizeLarkCommand,
} from '../src/command-risk.ts'

describe('Lark CLI command risk classification', () => {
  it('recognizes fixed read-only commands without metadata lookup', () => {
    expect(isDirectReadOnlyCommand(['api', 'GET', '/open-apis/calendar/v4/calendars'])).toBe(true)
    expect(isDirectReadOnlyCommand(['auth', 'status', '--json'])).toBe(true)
    expect(isDirectReadOnlyCommand(['schema', 'calendar.events.get'])).toBe(true)
    expect(isDirectReadOnlyCommand(['api', 'POST', '/open-apis/calendar/v4/calendars'])).toBe(false)
    expect(isDirectReadOnlyCommand(['auth', 'login'])).toBe(false)
    expect(isDirectReadOnlyCommand(['im', '--help'])).toBe(true)
    expect(isDirectReadOnlyCommand(['calendar', 'events', 'create', '-h'])).toBe(true)
  })

  it('normalizes deprecated calendar list commands', () => {
    expect(normalizeLarkCommand(['calendar', '+event-list', '--json']))
      .toEqual(['calendar', '+agenda', '--json'])
    expect(normalizeLarkCommand(['calendar', '+agenda', '--json']))
      .toEqual(['calendar', '+agenda', '--json'])
  })

  it('builds help commands without carrying operation arguments', () => {
    expect(commandHelpArguments(['calendar', '+agenda', '--start', '2026-08-26', '--json']))
      .toEqual(['calendar', '+agenda', '--help'])
    expect(commandHelpArguments(['calendar', 'events', 'get', '--event-id', 'event-id']))
      .toEqual(['calendar', 'events', 'get', '--help'])
    expect(commandHelpArguments(['skills', 'install', 'owner/repo']))
      .toEqual(['skills', 'install', '--help'])
  })

  it('accepts only the official read risk declaration', () => {
    expect(helpDeclaresReadOnly('Usage:\n  lark-cli calendar +agenda\n\nRisk: read\n', '')).toBe(true)
    expect(helpDeclaresReadOnly('', 'Risk: write\n')).toBe(false)
    expect(helpDeclaresReadOnly('Risk: high-risk-write\n', '')).toBe(false)
    expect(helpDeclaresReadOnly('No risk metadata', '')).toBe(false)
  })
})
