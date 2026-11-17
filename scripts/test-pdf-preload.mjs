import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await mkdtemp(path.join(tmpdir(), 'pdf-preload-'))
let count = 0
const check = (name, value, expected) => { assert.deepEqual(value, expected, name); count++; console.log(`ok ${name}`) }
try {
  const file = path.join(root, 'preload.mjs')
  await build({ entryPoints: ['client/pdfPreload.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file })
  const { PdfPreloader, nextPdfPreloadWindow: windowFor, pdfPreviewSize, PDF_PREVIEW_PIXELS } = await import(pathToFileURL(file))
  const first = windowFor(1, 60)
  check('initial preparation covers ten pages', first, { start: 1, end: 10 })
  check('page seven does not start another batch', windowFor(7, 60, first), first)
  const second = windowFor(8, 60, first)
  check('page eight starts the next batch', second, { start: 1, end: 20 })
  check('page seventeen retains the current window', windowFor(17, 60, second), second)
  check('page eighteen slides the bounded cache forward', windowFor(18, 60, second), { start: 11, end: 30 })
  check('a distant jump prepares around the target', windowFor(48, 60, second), { start: 41, end: 60 })
  check('backward jumps rebuild the appropriate window', windowFor(4, 60, { start: 41, end: 60 }), first)
  check('short documents never request absent pages', windowFor(1, 3), { start: 1, end: 3 })
  check('the last partial batch stops at the document end', windowFor(48, 53), { start: 41, end: 53 })
  for (const [width, height] of [[612, 792], [10000, 10000], [100000, 10], [10, 100000]]) {
    const size = pdfPreviewSize(width, height)
    check(`preview allocation is bounded for ${width}x${height}`, size.width * size.height <= PDF_PREVIEW_PIXELS && Math.max(size.width, size.height) <= 1024, true)
  }
  check('small pages are not unnecessarily enlarged', pdfPreviewSize(64, 32), { width: 64, height: 32, scale: 1 })

  const queue = [], calls = [], released = [], aborted = []
  let pending = null, active = 0, peak = 0, busy = false, latest
  const cache = new PdfPreloader({
    schedule: (callback, retry) => { const entry = { callback, retry, cancelled: false }; queue.push(entry); return () => { entry.cancelled = true } },
    busy: () => busy,
    release: (value) => released.push(value.page),
    changed: (state) => { latest = state },
    load: (page, signal) => new Promise((resolve, reject) => {
      calls.push(page); active++; peak = Math.max(peak, active)
      let done = false
      const settle = (error) => { if (done) return; done = true; active--; pending = null; error ? reject(error) : resolve({ page }) }
      pending = { page, finish: () => settle(), fail: () => settle(new Error('bad page')) }
      signal.addEventListener('abort', () => { aborted.push(page); settle(new Error('aborted')) }, { once: true })
    }),
  })
  const run = async () => { const entry = queue.shift(); if (entry && !entry.cancelled) entry.callback(); await setImmediate() }
  const drain = async () => {
    for (let attempt = 0; (queue.length || pending) && attempt < 100; attempt++) {
      if (pending) { pending.finish(); await setImmediate() }
      else await run()
    }
    assert.equal(queue.length, 0); assert.equal(pending, null)
  }
  cache.update(1, 60)
  const foreground = cache.beginForeground()
  await run()
  check('foreground work cancels scheduled background jobs', calls, [])
  foreground(); await run()
  check('preloading starts only after foreground yields', calls, [1])
  const foregroundAgain = cache.beginForeground()
  check('new foreground work immediately aborts active preloading', aborted, [1])
  await setImmediate()
  check('no new preload runs while foreground is active', queue.length, 0)
  foregroundAgain(); await drain()
  check('idle preparation completes the first batch', latest.ready, [1,2,3,4,5,6,7,8,9,10])
  check('only one background request can run at once', peak, 1)
  cache.update(8, 60); await drain()
  check('second batch becomes ready before the current batch ends', latest.ready.length, 20)
  cache.update(18, 60)
  check('obsolete previews are released at the window boundary', released, [1,2,3,4,5,6,7,8,9,10])
  await drain()
  check('cache remains bounded after forward reading', latest.ready, Array.from({ length: 20 }, (_, i) => i + 11))
  cache.update(48, 60); busy = true; await run()
  check('scrolling or layout work prevents background starts', pending, null)
  check('busy retries yield rather than spin immediately', queue.at(-1).retry, true)
  busy = false; await run()
  check('a distant target takes priority over old queued pages', pending.page, 48)
  cache.setPaused(true); await setImmediate()
  check('pointer selection pauses the active task', aborted.at(-1), 48)
  cache.setPaused(false); await run()
  pending.fail(); await setImmediate(); await drain()
  check('one broken prefetch page does not block the rest', latest.ready.length, 19)
  check('failed prefetch never claims that page is cached', cache.get(48), undefined)
  cache.dispose()
  check('dispose releases every remaining cached preview', released.length, 49)

  let finishLate, lateReleased = 0, scheduled
  const late = new PdfPreloader({ schedule: (fn) => { scheduled = fn; return () => {} }, busy: () => false,
    load: () => new Promise((resolve) => { finishLate = resolve }), release: () => lateReleased++ })
  late.update(1, 10); scheduled(); await setImmediate(); late.dispose(); finishLate('old-document'); await setImmediate()
  check('late results from an old document are discarded and released', [late.get(1), lateReleased], [undefined, 1])
  console.log(`${count} PDF preload checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
