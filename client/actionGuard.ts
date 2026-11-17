/** Read at completion time: an import can finish after the user starts a draft. */
export function createActionGuard(isDirty: () => boolean, onBlocked: (action: () => void) => void): (action: () => void) => void {
  return (action) => {
    if (isDirty()) onBlocked(action)
    else action()
  }
}
