/** Package-owned invariant companion for the Lark Settings contribution. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-lark'
/** Cordis companion plugin name. */
export const name = 'ui-lark-invariant'
/** Required services. */
export const inject = ['invariants']
/** Slot registration already has fail-loud ownership. */
const install: InvariantInstaller = () => {}
/** Register package ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
