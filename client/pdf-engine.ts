/**
 * PDF raster backend selection for the in-app viewer.
 *
 * pdf.js 6.5+ can rasterise pages in a dedicated **renderer worker**
 * (`build/pdf.renderer.mjs`): the worker executes the operator list
 * (`showText`, `measureText`, images…) into `ImageBitmap` frames that the main
 * thread only has to `drawImage` onto the page canvas. The document, text layer,
 * annotation coordinates and selection stay on the main thread exactly as
 * before, so nothing in the PDF's visual geometry changes.
 *
 * Why not a second engine (PDFium/EmbedPDF)? A dual-engine setup would need a
 * second document copy plus coordinate/rotation normalisation between the two
 * engines; the pdf.js renderer worker solves the same main-thread long-task
 * problem with zero new dependencies, identical page coordinates and no risk of
 * bitmap/text-layer misalignment.
 *
 * Feature flag (first match wins, all optional):
 *   1. `globalThis.__PAPERDESK_PDF_RENDERER__ = 'worker' | 'main' | 'auto'`
 *   2. URL query `?pdfRenderer=worker|main|auto` (handy for a live A/B test)
 *   3. `localStorage['paperdesk:pdf-renderer']`
 *   4. default: `auto` — renderer worker when the browser supports it.
 *
 * Setting `main` (or a browser without `OffscreenCanvas`/`document.fonts`)
 * fully restores the previous main-thread pdf.js rendering path.
 */

import { pdfjsAsset } from './pdfjs.js'
import type { PdfjsModule } from './pdfjs.js'

/** Effective rendering mode. */
export type PdfRendererMode = 'worker' | 'main'

/** Configured preference; `auto` resolves to `worker` when supported. */
export type PdfRendererPreference = PdfRendererMode | 'auto'

export interface PdfRendererSupport {
  worker: boolean
  /** Human-readable reason when `worker` is false. */
  reason: string
}

export type PdfRendererPreferenceSource = 'global' | 'query' | 'storage' | 'default'

export interface PdfRendererConfig {
  /** Mode the viewer should use. */
  mode: PdfRendererMode
  /** Raw preference before support detection. */
  preference: PdfRendererPreference
  source: PdfRendererPreferenceSource
  support: PdfRendererSupport
  /** URL of the renderer worker when `mode === 'worker'`, else null. */
  rendererSrc: string | null
}

export const PDF_RENDERER_GLOBAL_KEY = '__PAPERDESK_PDF_RENDERER__'
export const PDF_RENDERER_STORAGE_KEY = 'paperdesk:pdf-renderer'
export const PDF_RENDERER_QUERY_KEY = 'pdfRenderer'

/** The subset of `GlobalWorkerOptions` used for renderer-worker setup. */
interface GlobalWorkerOptionsLike {
  workerSrc: string
  rendererSrc?: string
  rendererPorts?: Worker[]
}

function isPreference(value: unknown): value is PdfRendererPreference {
  return value === 'worker' || value === 'main' || value === 'auto'
}

function readGlobalPreference(): PdfRendererPreference | null {
  const value = (globalThis as Record<string, unknown>)[PDF_RENDERER_GLOBAL_KEY]
  return isPreference(value) ? value : null
}

function readQueryPreference(): PdfRendererPreference | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return null
  try {
    const value = new URLSearchParams(window.location.search).get(PDF_RENDERER_QUERY_KEY)
    return isPreference(value) ? value : null
  } catch {
    return null
  }
}

function readStoragePreference(): PdfRendererPreference | null {
  try {
    const value = globalThis.localStorage?.getItem(PDF_RENDERER_STORAGE_KEY)
    return isPreference(value) ? value : null
  } catch {
    // Storage can throw in privacy modes; treat as unset.
    return null
  }
}

/** Resolve the configured preference and where it came from. */
export function resolvePdfRendererPreference(): {
  preference: PdfRendererPreference
  source: PdfRendererPreferenceSource
} {
  const globalValue = readGlobalPreference()
  if (globalValue !== null) return { preference: globalValue, source: 'global' }
  const queryValue = readQueryPreference()
  if (queryValue !== null) return { preference: queryValue, source: 'query' }
  const storageValue = readStoragePreference()
  if (storageValue !== null) return { preference: storageValue, source: 'storage' }
  return { preference: 'auto', source: 'default' }
}

/**
 * Whether pdf.js can use its renderer worker here. Mirrors
 * `RendererWorker.isAvailable` (same prerequisites) so the viewer's reported
 * mode is accurate before pdf.js silently falls back.
 */
export function detectPdfRendererSupport(): PdfRendererSupport {
  if (typeof Worker === 'undefined') return { worker: false, reason: 'Worker is unavailable' }
  if (typeof OffscreenCanvas === 'undefined') {
    return { worker: false, reason: 'OffscreenCanvas is unavailable' }
  }
  if (typeof document === 'undefined' || document.fonts === undefined) {
    return { worker: false, reason: 'document.fonts is unavailable' }
  }
  return { worker: true, reason: '' }
}

/**
 * Point the loaded pdf.js module at the served renderer worker (or clear it for
 * the main-thread fallback). Must run before `getDocument`; pdf.js decides once
 * per document whether worker rendering is available.
 */
export function configurePdfjsRenderer(
  pdfjs: PdfjsModule,
  assetBase?: string,
  preference?: PdfRendererPreference,
): PdfRendererConfig {
  const resolved = resolvePdfRendererPreference()
  const wanted = preference ?? resolved.preference
  const support = detectPdfRendererSupport()
  const mode: PdfRendererMode = wanted === 'main' || !support.worker ? 'main' : 'worker'
  const options = pdfjs.GlobalWorkerOptions as unknown as GlobalWorkerOptionsLike
  const rendererSrc = mode === 'worker' ? pdfjsAsset('build/pdf.renderer.mjs', assetBase) : null
  // An empty string is valid (`rendererSrc` only rejects non-strings) and makes
  // `RendererWorker.isAvailable` false, i.e. the legacy path.
  options.rendererSrc = rendererSrc === null ? '' : rendererSrc
  return {
    mode,
    preference: wanted,
    source: resolved.source,
    support,
    rendererSrc,
  }
}
