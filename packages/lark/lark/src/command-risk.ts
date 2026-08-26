/** Read-only classification helpers for official Lark CLI commands. */

const DIRECT_READ_ONLY_COMMANDS = new Set([
  'api GET',
  'auth list',
  'auth scopes',
  'auth status',
  'skills list',
  'skills read',
])
const TWO_SEGMENT_COMMAND_GROUPS = new Set(['auth', 'config', 'event', 'skills'])

/** Normalize deprecated model-facing command names to official CLI commands. */
export function normalizeLarkCommand(args: readonly string[]): string[] {
  if (args[0] === 'calendar' && args[1] === '+event-list') {
    return ['calendar', '+agenda', ...args.slice(2)]
  }
  return [...args]
}

/** Return whether a command is intrinsically read-only without CLI metadata lookup. */
export function isDirectReadOnlyCommand(args: readonly string[]): boolean {
  if (args.includes('--help') || args.includes('-h')) return true
  if (args[0] === 'doctor' || args[0] === 'schema') return true
  return DIRECT_READ_ONLY_COMMANDS.has(args.slice(0, 2).join(' '))
}

/** Build a side-effect-free help invocation for the dispatched command path. */
export function commandHelpArguments(args: readonly string[]): string[] | undefined {
  const firstFlag = args.findIndex(value => value.startsWith('-'))
  const positional = args.slice(0, firstFlag < 0 ? args.length : firstFlag)
  const [group, command] = positional
  if (group === undefined || group === 'api') return undefined
  if (command === undefined) return [group, '--help']
  if (command.startsWith('+') || TWO_SEGMENT_COMMAND_GROUPS.has(group)) return [group, command, '--help']
  return [...positional.slice(0, 3), '--help']
}

/** Return whether official CLI help declares the command read-only. */
export function helpDeclaresReadOnly(stdout: string, stderr: string): boolean {
  return /(?:^|\n)Risk:\s*read\s*(?:\n|$)/u.test(`${stdout}\n${stderr}`)
}
