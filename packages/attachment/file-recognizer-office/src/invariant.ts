/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-file-recognizer-office`.
 * @module @deepseek-ai/dsh-file-recognizer-office/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-file-recognizer-office'
/** Cordis companion plugin name. */
export const name = 'file-recognizer-office-invariant'
/** Services required before package ownership can be reserved. */
export const inject = ['invariants', 'attachments']
/** No runtime invariant: the effect-scoped recognizer registration owns no observable relation beyond its tested disposer. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
