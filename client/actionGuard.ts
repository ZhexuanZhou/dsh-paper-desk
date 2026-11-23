/** Read at completion time: an import can finish after the user starts a draft. */
export interface EditorNavigationControls {
  /** Pause future autosaves and capture the saved baseline; false if already clean. */
  pause(): boolean
  resume(): void
  discard(): Promise<boolean>
}
export function createActionGuard(isDirty: () => boolean, onBlocked: (action: () => void) => void): (action: () => void) => void {
  return (action) => {
    if (isDirty()) onBlocked(action)
    else action()
  }
}
