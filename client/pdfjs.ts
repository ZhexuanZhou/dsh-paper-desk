/**
 * Lazy loader for the pdf.js browser build served by the PaperDesk Host.
 *
 * The `pdfjs-dist` package is **not** bundled into the client: the Host serves
 * the installed package at `/api/paper-desk/pdfjs/<relPath>` and the viewer
 * imports `build/pdf.mjs` at runtime. A dynamic import with a non-literal
 * argument is deliberately used so esbuild leaves it untouched (never
 * static-import pdf.js from this module).
 *
 * Contract: DESIGN-VIEWER.md §2.
 */

/** Base URL of the Host asset endpoint. */
export const PDFJS_BASE = '/api/paper-desk/pdfjs'

/** Minimal structural type of the parts of `PDFDocumentProxy` the viewer needs. */
export interface PdfDocumentLike {
  numPages: number
  getPage(page: number): Promise<PdfPageLike>
  destroy(): Promise<void>
}

/** Minimal structural type of the parts of `PDFPageProxy` the viewer needs. */
export interface PdfPageLike {
  getViewport(params: { scale: number; rotation?: number }): PdfViewportLike
  render(params: Record<string, unknown>): { promise: Promise<void>; cancel(): void }
  streamTextContent?(params?: Record<string, unknown>): unknown
  getTextContent(params?: Record<string, unknown>): Promise<unknown>
  cleanup?(): void
}

/** Minimal structural type of `PageViewport`. */
export interface PdfViewportLike {
  width: number
  height: number
  scale: number
}

/** The subset of the pdf.js module surface this plugin relies on. */
export interface PdfjsModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocumentLike> }
  GlobalWorkerOptions: { workerSrc: string }
  TextLayer: new (options: Record<string, unknown>) => {
    render(): Promise<void>
    update?(options: Record<string, unknown>): Promise<void>
  }
  version: string
}

/** Module cache keyed by normalised asset base, so remounts reuse the same import. */
const moduleCache = new Map<string, Promise<PdfjsModule>>()

/** Normalise an asset base: trim, drop trailing slashes. */
function normaliseBase(base?: string): string {
  const raw = base === undefined ? PDFJS_BASE : base.trim()
  const value = raw.length > 0 ? raw : PDFJS_BASE
  return value.replace(/\/+$/, '')
}

/**
 * Absolute URL of a pdf.js asset.
 * Directory assets keep their trailing slash (`cmaps/`, `standard_fonts/`, `wasm/`).
 */
export function pdfjsAsset(relPath: string, base?: string): string {
  const root = normaliseBase(base)
  const clean = relPath.replace(/^\/+/, '')
  return clean.length > 0 ? `${root}/${clean}` : root
}

/**
 * Load the pdf.js browser module from the Host (cached per asset base) and point
 * its worker at the served worker build.
 */
export function loadPdfjs(base?: string): Promise<PdfjsModule> {
  const key = normaliseBase(base)
  const cached = moduleCache.get(key)
  if (cached !== undefined) return cached

  const pending = (async (): Promise<PdfjsModule> => {
    const url = pdfjsAsset('build/pdf.mjs', key)
    // Dynamic, non-literal import: esbuild must keep this as `import(url)` so the
    // browser fetches the ES module from the Host instead of bundling pdf.js.
    const moduleUnknown: unknown = await import(/* webpackIgnore: true */ /* @vite-ignore */ url)
    const module = moduleUnknown as PdfjsModule
    if (
      module === null ||
      typeof module !== 'object' ||
      typeof module.getDocument !== 'function' ||
      module.GlobalWorkerOptions === undefined
    ) {
      throw new Error(`pdf.js module at ${url} did not export the expected API`)
    }
    module.GlobalWorkerOptions.workerSrc = pdfjsAsset('build/pdf.worker.mjs', key)
    return module
  })()

  moduleCache.set(key, pending)
  // A failed import must not poison the cache: retry (the viewer's retry button)
  // has to be able to load again after the route/network recovers.
  pending.catch(() => {
    if (moduleCache.get(key) === pending) moduleCache.delete(key)
  })
  return pending
}
