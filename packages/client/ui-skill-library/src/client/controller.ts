/** Shared open state between the sidebar trigger and SkillHub overlay. */
export class SkillLibraryController {
  private open = false
  private readonly listeners = new Set<() => void>()

  /** Current overlay visibility for `useSyncExternalStore`. */
  readonly getSnapshot = (): boolean => this.open

  /** Subscribe to visibility changes. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Show the SkillHub marketplace. */
  show(): void { this.setOpen(true) }

  /** Hide the SkillHub marketplace. */
  hide(): void { this.setOpen(false) }

  private setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    for (const listener of this.listeners) listener()
  }
}
