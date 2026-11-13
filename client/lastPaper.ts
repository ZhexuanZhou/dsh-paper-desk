/** Per-library selection survives the plugin being unmounted by the Harness. */
const PREFIX = 'paperdesk:last-paper:'
const PAPER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function readLastPaper(libraryPath: string, storage?: Pick<Storage, 'getItem'>): string | null {
  if (!libraryPath) return null
  try {
    const value = (storage ?? globalThis.localStorage).getItem(PREFIX + libraryPath)
    return value && PAPER_ID.test(value) ? value : null
  } catch { return null }
}

export function writeLastPaper(libraryPath: string, paperId: string | null, storage?: Pick<Storage, 'setItem' | 'removeItem'>): void {
  if (!libraryPath || (paperId !== null && !PAPER_ID.test(paperId))) return
  try {
    const store = storage ?? globalThis.localStorage
    if (paperId === null) store.removeItem(PREFIX + libraryPath)
    else store.setItem(PREFIX + libraryPath, paperId)
  } catch { /* Unavailable local storage must not prevent reading. */ }
}
