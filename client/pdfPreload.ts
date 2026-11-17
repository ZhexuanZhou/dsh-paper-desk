export interface PdfPreloadWindow { start: number; end: number }
export const PDF_PRELOAD_BATCH = 10
export const PDF_PRELOAD_LEAD = 2
export const PDF_PRELOAD_CACHE_PAGES = 20
export const PDF_PREVIEW_PIXELS = 262144

/** Extend at page 8 of an initial ten; retain at most two batches. */
export function nextPdfPreloadWindow(page: number, total: number, previous: PdfPreloadWindow | null = null): PdfPreloadWindow {
  const current = Math.max(1, Math.min(total, page))
  if (previous && current >= previous.start && current <= previous.end) {
    if (current < previous.end - PDF_PRELOAD_LEAD || previous.end >= total) return previous
    const end = Math.min(total, previous.end + PDF_PRELOAD_BATCH)
    return { start: Math.max(previous.start, end - PDF_PRELOAD_CACHE_PAGES + 1), end }
  }
  const start = Math.floor((current - 1) / PDF_PRELOAD_BATCH) * PDF_PRELOAD_BATCH + 1
  const firstEnd = start + PDF_PRELOAD_BATCH - 1
  return { start, end: Math.min(total, firstEnd + (current >= firstEnd - PDF_PRELOAD_LEAD ? PDF_PRELOAD_BATCH : 0)) }
}

export function pdfPreviewSize(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, Math.sqrt(PDF_PREVIEW_PIXELS / (width * height)), 1024 / Math.max(width, height))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale }
}

export interface PdfPreloadStats extends PdfPreloadWindow { ready: number[]; active: number | null }
interface Options<T> {
  load: (page: number, signal: AbortSignal) => Promise<T>
  release: (value: T) => void
  schedule: (callback: () => void, retry: boolean) => () => void
  busy: () => boolean
  changed?: (state: PdfPreloadStats) => void
}

/** One background task, cancellable foreground priority, and a bounded page cache. */
export class PdfPreloader<T> {
  private range: PdfPreloadWindow | null = null
  private wanted: number[] = []
  private cache = new Map<number, T>()
  private failed = new Set<number>()
  private active: { page: number; controller: AbortController } | null = null
  private scheduled: (() => void) | null = null
  private foreground = 0
  private paused = false
  private disposed = false

  constructor(private readonly options: Options<T>) {}

  update(page: number, total: number): void {
    if (this.disposed || total < 1) return
    const range = nextPdfPreloadWindow(page, total, this.range)
    if (range.start !== this.range?.start || range.end !== this.range?.end) this.failed.clear()
    this.range = range
    this.wanted = []
    for (let value = page; value <= range.end; value++) this.wanted.push(value)
    for (let value = page - 1; value >= range.start; value--) this.wanted.push(value)
    const wanted = new Set(this.wanted)
    for (const [key, value] of this.cache) if (!wanted.has(key)) { this.cache.delete(key); this.options.release(value) }
    if (this.active && !wanted.has(this.active.page)) this.active.controller.abort()
    this.publish(); this.pump()
  }

  get(page: number): T | undefined { return this.cache.get(page) }

  beginForeground(): () => void {
    this.foreground++
    this.interrupt()
    let done = false
    return () => {
      if (done) return
      done = true; this.foreground--
      this.pump()
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) this.interrupt()
    else this.pump()
  }

  dispose(): void {
    this.disposed = true; this.interrupt()
    for (const value of this.cache.values()) this.options.release(value)
    this.cache.clear()
  }

  private interrupt(): void {
    this.scheduled?.(); this.scheduled = null
    this.active?.controller.abort()
  }

  private publish(): void {
    if (!this.disposed && this.range) this.options.changed?.({ ...this.range, ready: [...this.cache.keys()].sort((a, b) => a - b), active: this.active?.page ?? null })
  }

  private pump(retry = false): void {
    if (this.disposed || this.paused || this.foreground || this.active || this.scheduled) return
    if (!this.wanted.some((page) => !this.cache.has(page) && !this.failed.has(page))) return
    this.scheduled = this.options.schedule(() => {
      this.scheduled = null
      if (this.disposed || this.paused || this.foreground) return
      if (this.options.busy()) { this.pump(true); return }
      const page = this.wanted.find((value) => !this.cache.has(value) && !this.failed.has(value))
      if (page === undefined) return
      const job = { page, controller: new AbortController() }
      this.active = job; this.publish()
      void Promise.resolve().then(() => {
        if (job.controller.signal.aborted) throw new Error('Preload interrupted')
        return this.options.load(page, job.controller.signal)
      }).then((value) => {
        if (this.disposed || job.controller.signal.aborted || !this.wanted.includes(page)) this.options.release(value)
        else this.cache.set(page, value)
      }).catch(() => {
        if (!job.controller.signal.aborted) this.failed.add(page)
      }).finally(() => {
        if (this.active === job) this.active = null
        this.publish(); this.pump()
      })
    }, retry)
  }
}

/** No deadline forces a background render into an already busy frame. */
export function schedulePdfIdle(callback: () => void, retry = false): () => void {
  let idle: number | null = null, cancelled = false
  const timer = window.setTimeout(() => {
    if (cancelled) return
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => { if (!cancelled) callback() })
    else callback()
  }, retry ? 120 : 32)
  return () => {
    cancelled = true; window.clearTimeout(timer)
    if (idle !== null) window.cancelIdleCallback(idle)
  }
}
