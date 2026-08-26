/** Build-time substitutions permitted in browser plugin artifacts. */
export function clientBuildEnvironmentDefines(environment: NodeJS.ProcessEnv): Record<string, string> {
  const defines: Record<string, string> = { 'process.env': '{}' }
  for (const [name, value] of Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))) {
    if (!name.startsWith('DSH_CLIENT_') || value === undefined) continue
    defines[`process.env.${name}`] = JSON.stringify(value)
  }
  return defines
}
