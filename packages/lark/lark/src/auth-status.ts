interface JsonRecord { readonly [key: string]: unknown }

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

/**
 * Read the usable current-user Open ID from an official CLI auth response.
 *
 * @param status Parsed `lark-cli auth status --json` output.
 * @returns The authorized user's Open ID, or `undefined` when that identity is unavailable.
 */
export function authenticatedUserOpenId(status: unknown): string | undefined {
  const auth = record(status)
  const identities = record(auth?.identities)
  const user = record(identities?.user)
  if (user?.available !== true || user.verified === false) return undefined
  return typeof user.openId === 'string' && user.openId.length > 0 ? user.openId : undefined
}

/**
 * Compare an official CLI user identity with the scopes required by this plugin.
 *
 * @param status Parsed `lark-cli auth status --json` output.
 * @param requiredScopes User scopes requested by the current plugin version.
 * @returns Required scopes absent from the current user token.
 */
export function missingUserAuthorizationScopes(
  status: unknown,
  requiredScopes: readonly string[],
): string[] {
  const auth = record(status)
  const identities = record(auth?.identities)
  const user = record(identities?.user)
  const required = [...new Set(requiredScopes)]
  if (user?.available !== true || user.verified === false || typeof user.scope !== 'string') return required
  const granted = new Set(user.scope.split(/\s+/u).filter(scope => scope.length > 0))
  return required.filter(scope => !granted.has(scope))
}
