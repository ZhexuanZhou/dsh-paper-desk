/**
 * Debounced autosave queue for the notes editor.
 *
 * Uses a 400 ms debounce and one serialized write chain per editor, with
 * deduplication against the last persisted text. The editor owns its target
 * and passes writes through the App callback.
 *
 * Failure semantics: the editor keeps the draft in React state; the queue only
 * reports the error (toast). It deliberately does NOT re-arm the failed text:
 * a conflict must stop automatic retries until the user resolves it, and a
 * network error is retried by the next edit/flush or the explicit save.
 */
export const AUTOSAVE_DELAY_MS = 400

export interface AutosaveQueueOptions {
  delay?: number
  write: (text: string) => Promise<unknown>
  onError?: (error: unknown) => void
}

export interface AutosaveQueue {
  /** Debounced request to persist `text`; resets the 400 ms timer. */
  schedule(text: string): void
  /** Persist the pending text now (pagehide / before explicit save). */
  flush(): Promise<void>
  /** Drop pending work without writing (explicit save or discarded draft). */
  cancel(): void
  /** Baseline the queue against already-persisted content (reload/adoption). */
  markSaved(text: string | undefined): void
  hasPending(): boolean
  /** Wait for the in-flight chain (used to serialize explicit saves). */
  wait(): Promise<void>
  /** Drop pending work for good; the instance is not reusable afterwards. */
  dispose(): void
}

export function createAutosaveQueue(options: AutosaveQueueOptions): AutosaveQueue {
  const delay = options.delay ?? AUTOSAVE_DELAY_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: string | undefined
  let saved: string | undefined
  let chain: Promise<void> = Promise.resolve()
  let disposed = false

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const flush = (): Promise<void> => {
    clearTimer()
    const text = pending
    pending = undefined
    if (disposed || text === undefined || text === saved) return chain
    chain = chain.then(async () => {
      if (disposed || text === saved) return
      try {
        await options.write(text)
        saved = text
      } catch (error) {
        // The draft stays in the editor; explicit save or the next edit retries.
        options.onError?.(error)
      }
    })
    return chain
  }

  return {
    schedule(text: string): void {
      if (disposed) return
      if (text === saved) {
        pending = undefined
        clearTimer()
        return
      }
      pending = text
      clearTimer()
      timer = setTimeout(() => {
        void flush()
      }, delay)
    },
    flush,
    cancel(): void {
      clearTimer()
      pending = undefined
    },
    markSaved(text: string | undefined): void {
      saved = text
      if (pending === text) {
        pending = undefined
        clearTimer()
      }
    },
    hasPending(): boolean {
      return pending !== undefined
    },
    wait(): Promise<void> {
      return chain
    },
    dispose(): void {
      disposed = true
      clearTimer()
      pending = undefined
    },
  }
}
