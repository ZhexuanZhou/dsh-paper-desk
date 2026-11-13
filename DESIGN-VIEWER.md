# PaperDesk in-app PDF viewer + annotations — contract

Replaces the native browser PDF `<iframe>` in the 阅读 tab with a themed in-app
viewer built on **pdf.js**, and adds text-layer annotations
(highlight / underline / note / question) that work on top of the PDF text layer.

Everything here is additional to `DESIGN.md`. Read `src/types.ts`
(`Annotation*`) and `client/api.ts` (annotation + `pdfjsUrl` methods) first.

---

## 1. Host assets and endpoints (Lead-owned, already specified here)

pdf.js runs in the browser loaded from the Host on demand:

* `GET /api/paper-desk/pdfjs/<relPath>` — read-only static assets from the
  installed `pdfjs-dist` package. Allowed roots: `build/`, `cmaps/`,
  `standard_fonts/`, `wasm/`, `web/`. Traversal rejected. Content types:
  `.mjs/.js → text/javascript`, `.css → text/css`, `.bcmap → application/octet-stream`,
  `.ttf/.otf → font/ttf|font/otf`, `.wasm → application/wasm`, `.json → application/json`.
* `GET  /api/paper-desk/annotations?id=<paperId>` → `AnnotationDocument`
* `POST /api/paper-desk/annotations?id=<paperId>` body `NewAnnotation` → `AnnotationDocument`
* `PATCH /api/paper-desk/annotations?id=<paperId>&annotationId=<id>` body `AnnotationPatch` → `AnnotationDocument`
* `DELETE /api/paper-desk/annotations?id=<paperId>&annotationId=<id>` → `AnnotationDocument`

Annotations live in `papers/<id>/annotations.json` (atomic, sync-friendly).
`rects` are **normalised page coordinates** (0..1, top-left origin) so they survive
zoom/DPR/other devices. An empty document is `{schemaVersion:1,paperId,updatedAt,items:[]}`.

## 2. `client/pdfjs.ts` (owner: pdf-viewer)

```ts
export interface PdfjsModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocumentLike> }
  GlobalWorkerOptions: { workerSrc: string }
  TextLayer: new (options: Record<string, unknown>) => { render(): Promise<void>; update?(options: Record<string, unknown>): Promise<void> }
  version: string
}
export interface PdfDocumentLike {
  numPages: number
  getPage(page: number): Promise<PdfPageLike>
  destroy(): Promise<void>
}
export interface PdfPageLike {
  getViewport(params: { scale: number; rotation?: number }): PdfViewportLike
  render(params: Record<string, unknown>): { promise: Promise<void>; cancel(): void }
  streamTextContent?(params?: Record<string, unknown>): unknown
  getTextContent(params?: Record<string, unknown>): Promise<unknown>
  cleanup?(): void
}
export interface PdfViewportLike { width: number; height: number; scale: number }
export function loadPdfjs(base?: string): Promise<PdfjsModule>
export const PDFJS_BASE: string           // '/api/paper-desk/pdfjs'
export function pdfjsAsset(relPath: string, base?: string): string
```

`loadPdfjs` dynamic-imports `pdfjsAsset('build/pdf.mjs')` (esbuild leaves dynamic
`import(variable)` intact — do not static-import pdfjs into the bundle), sets
`GlobalWorkerOptions.workerSrc = pdfjsAsset('build/pdf.worker.mjs')`, caches the
module promise. The served `build/pdf.mjs` is the modern browser build; do not use
`legacy/` in the browser.

## 3. `client/PdfViewer.tsx` (owner: pdf-viewer)

A **pure presentational** component: no `fetch`, no `api.ts` import, no locale
service. Every visible string comes from `labels`.

```ts
export interface PdfViewerLabels {
  loading: string
  loadError: string
  retry: string
  page: string            // "page"
  of: string              // "of"
  zoomIn: string
  zoomOut: string
  fitWidth: string
  actualSize: string
  prev: string
  next: string
  highlight: string
  underline: string
  note: string
  ask: string
  copy: string
  copied: string
  cancel: string
  askTitle: string
  askPlaceholder: string
  askSubmit: string
  textLayerUnavailable: string
}

export interface PdfSelectionPayload {
  page: number
  rects: AnnotationRect[]
  quote: string
}

export interface PdfViewerProps {
  /** `/api/paper-desk/file?id=…` */
  src: string
  /** Base URL for pdf.js assets; defaults to PDFJS_BASE. */
  assetBase?: string
  annotations: readonly AnnotationItem[]
  labels: PdfViewerLabels
  /** Create a highlight / underline / note from a text selection. */
  onCreate: (payload: PdfSelectionPayload & { kind: AnnotationKind; comment?: string }) => void | Promise<void>
  /** Ask the agent about a selection. */
  onAsk: (payload: PdfSelectionPayload & { question: string }) => void | Promise<void>
  /** Called when the user clicks an annotation overlay (rail focuses it). */
  onFocusAnnotation?: (id: string) => void
  /** Page to scroll to when changed externally (e.g. rail click). */
  focusPage?: number
  /** Annotation id to flash/scroll to when changed externally. */
  focusAnnotationId?: string | null
  /** Rendered when a PDF has no selectable text (scanned). */
  lowTextHint?: string
}
```

Behaviour requirements:

* Continuous vertical scroll; lazily render pages near the viewport with
  `IntersectionObserver`; keep a placeholder box of the right aspect ratio so the
  scrollbar and page numbers stay stable.
* Render each page into a `<canvas>` at `scale * devicePixelRatio` and draw at CSS
  `viewport.width/height`; cancel in-flight renders on unmount/zoom.
* Build the selectable text layer with pdf.js `TextLayer` into a container with
  class `textLayer` (pdf.js viewer CSS), and inject `web/pdf_viewer.css` **once**
  via `<link href={pdfjsAsset('web/pdf_viewer.css', assetBase)}>` inside a
  `<style>`-free effect that removes the link on unmount. Scope interference:
  the viewer root has `container-type: size` and a fixed class prefix `pdv-`.
* Text selection → floating toolbar anchored above the selection with:
  高亮 / 划线 / 备注 / 提问 / 复制. Escape or click-away dismisses it. Actions:
  - highlight / underline / note → `onCreate({ page, rects, quote, kind })`
    (note also passes an empty comment; the rail opens the comment editor),
  - ask → small popover with a textarea (labels.askTitle/askPlaceholder) and a
    submit button → `onAsk({ page, rects, quote, question })`,
  - copy → `navigator.clipboard.writeText(quote)` with a transient `copied` label.
* Draw saved annotations as absolutely-positioned overlays inside each page box,
  using `rects` × page CSS size: highlights = translucent background
  (`color-mix` of the annotation color at ~35%), underlines = 2px bottom border,
  notes/questions = a small marker dot/speech glyph at the rect's end. Clicking an
  overlay calls `onFocusAnnotation(id)`. Use a `data-annotation-id` attribute.
* `focusPage` / `focusAnnotationId` props scroll smoothly to the page; the page
  that is currently most visible is reported via an optional `onPageChange?(page: number)`
  (add it to the props interface).
* Toolbar: page number input (`<input>` + Enter), total pages, zoom out / percent /
  zoom in, fit-width, actual size. Page indicator uses labels.page/of.
* Styling: only host theme tokens (`--dsw-alias-*`), page background stays white
  (PDFs are white; use `#fff` for the page canvas only — literal white is allowed
  for document paper), surrounding canvas area `--dsw-alias-bg-layer-2`, text
  `--dsw-alias-label-primary`. No literal palette colors for chrome. Dark mode:
  page stays white (like every PDF reader), chrome follows tokens.
* Empty selection / no text layer: still allow `onCreate` for a note? No — show
  `textLayerUnavailable` hint instead when the page has no text items.
* Memory: destroy the pdf document on unmount; never keep canvases of pages far
  outside the viewport (release and re-render on return, annotations overlay is
  cheap and can stay).
* The component must render safely before the module loads (loading state) and on
  load failure (error + retry).
* No imports outside `react` and `./pdfjs.js` (+ type-only imports from
  `../src/types.js`).

## 4. Reader integration (owner: client-ui, Lead-reviewed)

In `client/ReaderView.tsx`, the 阅读 tab becomes:

```
┌ PDF viewer (flex 1) ───────────────────────────────┬ 批注 rail 280px ─────┐
│  [page][zoom][fit]                                 │ 高亮 12 · 提问 3      │
│  page canvas + text layer + annotation overlays    │ p.4 “…” [编辑][删除] │
│  selection toolbar                                 │ p.9 “…” [问 Agent]    │
└────────────────────────────────────────────────────┴──────────────────────┘
```

* One-click agent assist (`client/agent.ts` `startPaperSession`) must **send** the
  prepared prompt, not merely prefill it: `connectWorkspace` → `openSession` →
  `sessions.using(id, {source:'controllerOperation'}, ref =>
  ref.binding.session.beginSubmission({mode:'queue', text: prompt, attachments: []}))`.
  Fall back to `startSession(workspaceId, {prompt})` (prefill) when the session
  service is unavailable, and show a toast in that case.
* Rail actions: click row → viewer focuses page/annotation; edit comment inline
  (`api.updateAnnotation`); delete (`api.deleteAnnotation`); 问 Agent
  (`api.assist(paperId, 'quote', undefined, {quote, page, question})` then
  `startPaperSession`).
* Annotation data is loaded in `App.tsx` together with the paper detail
  (`api.annotations(id)`) and passed down; every create/update/delete replaces the
  document with the response. Keep this state in `App`.
* Remove the `<iframe>`/`pdfUrl` usage from the 阅读 tab (the URL prop may stay for
  fallback), remove the PDF-size hint from Settings if present, and make the
  sidebar panellist icon match the shell's line-art glyphs (18px, viewBox 16,
  `stroke="currentColor"`, `strokeWidth` 1.3, **explicit `fill="none"` on the svg
  and on every shape**, no gradient/opacity tricks).
