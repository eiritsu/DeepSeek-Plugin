/** Package-owned invariant companion for the Lark integration. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-lark'
/** Cordis companion plugin name. */
export const name = 'lark-invariant'
/** Services required before package ownership can be reserved. */
export const inject = ['invariants', 'larkManagement']
/** The Remote service and tool registry already fail loud on duplicate ownership. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
