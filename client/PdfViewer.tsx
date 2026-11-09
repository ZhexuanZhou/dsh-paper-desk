/**
 * In-app pdf.js viewer with selectable text layer, floating selection toolbar
 * and persisted annotation overlays.
 *
 * Pure presentational: every visible string comes from `labels`; the component
 * never performs network I/O (the parent passes `src`/`annotations`), never
 * imports `api.ts`, and keeps its own scoped CSS/`pdf_viewer.css` <link>
 * inside module-level ref-counted helpers so they are removed on unmount.
 *
 * Contract: DESIGN-VIEWER.md §3.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import type { AnnotationItem, AnnotationKind, AnnotationRect } from '../src/types.js'
import { loadPdfjs, pdfjsAsset } from './pdfjs.js'
import type { PdfDocumentLike, PdfjsModule } from './pdfjs.js'

/* ── labels / props (contract — do not change) ───────────────────────────── */

export interface PdfViewerLabels {
  loading: string
  loadError: string
  retry: string
  page: string
  of: string
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
  src: string
  assetBase?: string
  annotations: readonly AnnotationItem[]
  labels: PdfViewerLabels
  onCreate: (payload: PdfSelectionPayload & { kind: AnnotationKind; comment?: string }) => void | Promise<void>
  onAsk: (payload: PdfSelectionPayload & { question: string }) => void | Promise<void>
  onFocusAnnotation?: (id: string) => void
  onPageChange?: (page: number) => void
  focusPage?: number
  /** Bump to re-apply focusPage even when the page number is unchanged. */
  focusNonce?: number
  focusAnnotationId?: string | null
  lowTextHint?: string
}

/* ── constants ───────────────────────────────────────────────────────────── */

/** pdf.js viewport units: 1 CSS px per 1/96 in, i.e. PDF pt → CSS px. */
const CSS_UNITS = 96 / 72
const MIN_ZOOM = 0.25
const MAX_ZOOM = 5
/** Horizontal breathing room around pages inside the scroll area. */
const PAGE_GUTTER = 16
const MAX_DPR = 3
/** Host validator bound (`ANNOTATION_LIMITS`) mirrored client-side. */
const MAX_QUOTE = 4000
const MAX_RECTS = 60
/** Render pages comfortably before they enter the viewport. */
const RENDER_MARGIN = '900px 0px'
const STYLE_ATTR = 'paper-desk-viewer'

/* ── scoped styles (injected once, removed on unmount) ───────────────────── */

const VIEWER_CSS = `
.pdv-root {
  container-type: size;
  container-name: pdv;
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 12px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}
.pdv-root *, .pdv-root *::before, .pdv-root *::after { box-sizing: border-box; }
.pdv-root ::selection { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); }
.pdv-root :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-radius: 5px; }

/* ── toolbar ────────────────────────────────────────────────────────────── */
.pdv-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.pdv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  min-width: 26px;
  padding: 0 8px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.pdv-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent));
  color: var(--dsw-alias-label-primary);
}
.pdv-btn:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent));
}
.pdv-btn:disabled { opacity: .42; cursor: default; }
.pdv-btn[aria-pressed="true"] {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
}
.pdv-pageBox {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 2px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.pdv-pageInput {
  width: 42px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.pdv-pageInput:focus { border-color: var(--dsw-alias-brand-primary); outline: none; }
.pdv-pageTotal { white-space: nowrap; }
.pdv-spacer { flex: 1 1 auto; }
.pdv-pct {
  min-width: 42px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

/* ── scroll area / pages ────────────────────────────────────────────────── */
.pdv-scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--dsw-alias-bg-layer-2);
}
.pdv-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.pdv-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 26%, transparent);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}
.pdv-scroll::-webkit-scrollbar-track { background: transparent; }
.pdv-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100%;
  padding: 14px 0 56px;
}
.pdv-pageWrap {
  display: flex;
  justify-content: center;
  width: 100%;
  padding: 9px ${PAGE_GUTTER}px;
  scroll-margin-top: 10px;
}
.pdv-page {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 2px;
  background: #fff;
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent),
    0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
}
.pdv-canvas { position: absolute; top: 0; left: 0; display: block; }

/* Selectable text layer: pdf.js builds spans in here. The scoped rules below
   are only a fallback for the moment before web/pdf_viewer.css has loaded —
   the authoritative positioning/font rules come from pdf_viewer.css. */
.pdv-textHost { position: absolute; inset: 0; z-index: 1; }
.pdv-textHost .textLayer { position: absolute; inset: 0; overflow: clip; text-align: initial; line-height: 1; }
.pdv-textHost .textLayer span,
.pdv-textHost .textLayer br {
  position: absolute;
  color: transparent;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  -webkit-user-select: text;
  user-select: text;
}

/* ── annotation overlays ───────────────────────────────────────────────── */
.pdv-annotLayer { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.pdv-mark {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  pointer-events: auto;
  cursor: pointer;
}
.pdv-mark-highlight {
  background: color-mix(in srgb, var(--pdv-annot-color) 35%, transparent);
  mix-blend-mode: multiply;
}
.pdv-mark-underline { border-bottom: 2px solid var(--pdv-annot-color); }
.pdv-annotMarker {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--pdv-annot-color);
  color: var(--dsw-alias-label-primary-foreground, #fff);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--dsw-alias-label-primary) 32%, transparent);
  pointer-events: auto;
  cursor: pointer;
}
.pdv-flash { animation: pdv-flash 900ms ease-out 2; }
@keyframes pdv-flash {
  0% { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
  100% { outline: 2px solid transparent; outline-offset: 6px; }
}
.pdv-lowText {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 3;
  max-width: 82%;
  padding: 4px 10px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
}
.pdv-docHint {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}

/* ── floating selection toolbar ────────────────────────────────────────── */
.pdv-selbar {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: 0 6px 22px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
  transform: translate(-50%, -100%);
}
.pdv-selbar.pdv-below { transform: translate(-50%, 8px); }
.pdv-selbar button {
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.pdv-selbar button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent));
}
.pdv-selbar button:disabled { opacity: .45; cursor: default; }

/* ── ask popover ───────────────────────────────────────────────────────── */
.pdv-ask {
  position: absolute;
  z-index: 11;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 280px;
  max-width: calc(100% - 24px);
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: 0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent);
  transform: translate(-50%, -100%);
}
.pdv-ask.pdv-below { transform: translate(-50%, 8px); }
.pdv-askTitle { color: var(--dsw-alias-label-primary); font-weight: 600; }
.pdv-askInput {
  width: 100%;
  min-height: 66px;
  max-height: 180px;
  padding: 6px 8px;
  resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.pdv-askInput:focus { border-color: var(--dsw-alias-brand-primary); outline: none; }
.pdv-askActions { display: flex; justify-content: flex-end; gap: 6px; }
.pdv-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));
  color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base));
}
.pdv-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)) 88%, var(--dsw-alias-label-primary));
  color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base));
}

/* ── loading / error ───────────────────────────────────────────────────── */
.pdv-center {
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--dsw-alias-label-secondary);
}
.pdv-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 25%, transparent);
  border-top-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: pdv-spin 900ms linear infinite;
}
@keyframes pdv-spin { to { transform: rotate(360deg); } }
.pdv-errorTitle { color: var(--dsw-alias-state-error-primary); font-weight: 600; }
.pdv-errorDetail {
  max-width: 82%;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  text-align: center;
  word-break: break-word;
}
`

/** Ref-counted `<style>` injection (shared by concurrently mounted viewers). */
let viewerStyleRefs = 0
let viewerStyleEl: HTMLStyleElement | null = null

function acquireViewerStyle(): () => void {
  if (viewerStyleEl === null) {
    const existing = document.head.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ATTR}"]`)
    if (existing !== null) {
      viewerStyleEl = existing
    } else {
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', STYLE_ATTR)
      style.textContent = VIEWER_CSS
      document.head.appendChild(style)
      viewerStyleEl = style
    }
  }
  viewerStyleRefs += 1
  let released = false
  return () => {
    if (released) return
    released = true
    viewerStyleRefs -= 1
    if (viewerStyleRefs <= 0 && viewerStyleEl !== null) {
      viewerStyleEl.remove()
      viewerStyleEl = null
      viewerStyleRefs = 0
    }
  }
}

interface ViewerCssLink {
  element: HTMLLinkElement
  refs: number
}

/** Ref-counted `<link>` to the served `web/pdf_viewer.css` (its `.textLayer` rules). */
const viewerCssLinks = new Map<string, ViewerCssLink>()

function acquireViewerCss(href: string): () => void {
  let entry = viewerCssLinks.get(href)
  if (entry === undefined) {
    const existing = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[data-plugin-pdfjs-css]'),
    ).find((link) => link.getAttribute('data-plugin-pdfjs-css') === href)
    const element = existing ?? document.createElement('link')
    if (existing === undefined) {
      element.rel = 'stylesheet'
      element.href = href
      element.setAttribute('data-plugin-pdfjs-css', href)
      document.head.appendChild(element)
    }
    entry = { element, refs: 0 }
    viewerCssLinks.set(href, entry)
  }
  entry.refs += 1
  let released = false
  return () => {
    if (released) return
    released = true
    entry.refs -= 1
    if (entry.refs <= 0) {
      entry.element.remove()
      viewerCssLinks.delete(href)
    }
  }
}

/* ── internal types/helpers ──────────────────────────────────────────────── */

interface PageSize {
  /** Viewport width at scale 1, PDF points (rotation included). */
  width: number
  /** Viewport height at scale 1, PDF points (rotation included). */
  height: number
}

/**
 * pdf.js `PDFDocumentLoadingTask` surface the viewer uses to abort an in-flight
 * fetch on unmount (not part of the public `PdfjsModule` contract).
 */
interface LoadingTaskLike {
  promise: Promise<PdfDocumentLike>
  destroy?: () => Promise<unknown>
}

interface PageView {
  wrap: HTMLDivElement
  pageEl: HTMLDivElement
  canvas: HTMLCanvasElement
  textHost: HTMLDivElement
  /** Bumped whenever an in-flight render becomes stale. */
  token: number
  renderedKey?: string
  pendingKey?: string
  renderTask?: { promise: Promise<void>; cancel(): void }
}

interface ZoomAnchor {
  page: number
  /** Viewport-top offset inside the page, as a fraction of the page height. */
  frac: number
}

interface SelectionState {
  page: number
  rects: AnnotationRect[]
  quote: string
  /** Toolbar anchor, relative to the viewer root. */
  x: number
  y: number
  below: boolean
  /** Ask popover anchor, relative to the viewer root. */
  askX: number
  askY: number
  askBelow: boolean
}

type Status = 'loading' | 'ready' | 'error'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function clampZoom(value: number): number {
  return clamp(value, MIN_ZOOM, MAX_ZOOM)
}

function currentDpr(): number {
  const raw = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return Math.max(1, Math.min(MAX_DPR, Number.isFinite(raw) && raw > 0 ? raw : 1))
}

function renderKey(zoom: number): string {
  return `${(zoom * CSS_UNITS).toFixed(4)}|${currentDpr()}`
}

function normaliseQuote(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE)
}

function cssEscape(value: string): string {
  if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

/** Scroll `element` into view inside `scroller` without touching ancestor scroll. */
function scrollPageIntoView(scroller: HTMLElement, element: HTMLElement, align: 'start' | 'center'): void {
  const scrollRect = scroller.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  if (elementRect.height <= 0 && elementRect.width <= 0) return
  const offset = align === 'center' ? Math.max(0, (scrollRect.height - elementRect.height) / 2) : 8
  const top = scroller.scrollTop + (elementRect.top - scrollRect.top) - offset
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

function annotationKindLabel(labels: PdfViewerLabels, kind: AnnotationKind): string {
  switch (kind) {
    case 'highlight':
      return labels.highlight
    case 'underline':
      return labels.underline
    case 'note':
      return labels.note
    default:
      return labels.ask
  }
}

/**
 * Annotation ink colours. These describe document content (like the PDF paper
 * itself), not UI chrome, so they map onto host state/brand tokens rather than
 * hard-coded palette values where a fitting token exists.
 */
function annotationColor(color: AnnotationItem['color']): string {
  switch (color) {
    case 'yellow':
      return 'var(--dsw-alias-state-warn-primary)'
    case 'green':
      return 'var(--dsw-alias-state-success-primary)'
    case 'blue':
      return 'var(--dsw-alias-brand-primary)'
    case 'pink':
      return 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 58%, var(--dsw-alias-state-warn-primary))'
    default:
      return 'color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-state-error-primary))'
  }
}

function annotationRank(kind: AnnotationKind): number {
  switch (kind) {
    case 'highlight':
      return 0
    case 'underline':
      return 1
    default:
      return 2
  }
}

/* ── small local icons (no external icon imports in this file) ──────────── */

function ToolbarIcon({ name }: { name: 'prev' | 'next' | 'zoomIn' | 'zoomOut' }): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'prev' ? <path d="M10 3 5 8l5 5" /> : null}
      {name === 'next' ? <path d="m6 3 5 5-5 5" /> : null}
      {name === 'zoomIn' ? <path d="M8 3.2v9.6M3.2 8h9.6" /> : null}
      {name === 'zoomOut' ? <path d="M3.2 8h9.6" /> : null}
    </svg>
  )
}

/** Absolute-positioned overlays for one page's persisted annotations. */
function renderAnnotationNodes(
  items: readonly AnnotationItem[],
  labels: PdfViewerLabels,
  flashId: string | null,
  onFocus: ((id: string) => void) | undefined,
): ReactElement[] {
  const nodes: ReactElement[] = []
  for (const item of items) {
    const color = annotationColor(item.color)
    const label = annotationKindLabel(labels, item.kind)
    const flashing = flashId === item.id
    if (item.kind === 'note' || item.kind === 'question') {
      const last = item.rects[item.rects.length - 1]
      if (last === undefined) continue
      const style = {
        left: `${(last.x + last.w) * 100}%`,
        top: `${(last.y + last.h) * 100}%`,
        '--pdv-annot-color': color,
      } as CSSProperties
      nodes.push(
        <button
          key={`${item.id}:marker`}
          type="button"
          className={`pdv-annotMarker pdv-annotMarker-${item.kind}${flashing ? ' pdv-flash' : ''}`}
          data-annotation-id={item.id}
          style={style}
          aria-label={label}
          title={item.comment.length > 0 ? item.comment : item.quote.length > 0 ? item.quote : label}
          onClick={(event) => {
            event.stopPropagation()
            onFocus?.(item.id)
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {item.kind === 'question' ? (
              <path d="M6.1 5.9a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.7.5-.7 1v.2M8 12.2v.1" />
            ) : (
              <path d="M3.5 3.1h9v7.2H7.4l-2.7 2.3v-2.3H3.5z" />
            )}
          </svg>
        </button>,
      )
      continue
    }
    item.rects.forEach((rect, rectIndex) => {
      const style = {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        '--pdv-annot-color': color,
      } as CSSProperties
      nodes.push(
        <button
          key={`${item.id}:${rectIndex}`}
          type="button"
          className={`pdv-mark pdv-mark-${item.kind}${flashing ? ' pdv-flash' : ''}`}
          data-annotation-id={item.id}
          style={style}
          aria-label={label}
          title={item.quote.length > 0 ? item.quote : label}
          onClick={(event) => {
            event.stopPropagation()
            onFocus?.(item.id)
          }}
        />,
      )
    })
  }
  return nodes
}

/* ── component ───────────────────────────────────────────────────────────── */

export function PdfViewer(props: PdfViewerProps): ReactElement {
  const { annotations, assetBase, focusAnnotationId, focusNonce, focusPage, labels, lowTextHint, src } = props

  /* DOM refs (imperative pdf.js work stays out of React's virtual DOM). */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pdfjsRef = useRef<PdfjsModule | null>(null)
  const docRef = useRef<PdfDocumentLike | null>(null)
  const loadingTaskRef = useRef<LoadingTaskLike | null>(null)
  const pagesRef = useRef<Map<number, PageView>>(new Map())
  const visibleRef = useRef<Set<number>>(new Set())
  /** Invalidation counter for all in-flight async render work. */
  const epochRef = useRef(0)
  /** Debounce fit-width during host/sidebar animations. */
  const resizeTimerRef = useRef<number | null>(null)
  const zoomRef = useRef(1)
  const pageSizesRef = useRef<readonly PageSize[]>([])
  const fitModeRef = useRef(true)
  const currentPageRef = useRef(1)
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null)
  const pageInputFocusedRef = useRef(false)
  const copyTimerRef = useRef<number | null>(null)
  const lastFocusedAnnotationRef = useRef<string | null>(null)

  const [status, setStatus] = useState<Status>('loading')
  const [errorText, setErrorText] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [numPages, setNumPages] = useState(0)
  const [pageSizes, setPageSizes] = useState<PageSize[]>([])
  const [zoom, setZoom] = useState(1)
  const [fitMode, setFitMode] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageText, setPageText] = useState('1')
  const [lowTextPages, setLowTextPages] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)

  const onPageChangeRef = useRef<PdfViewerProps['onPageChange']>(props.onPageChange)
  onPageChangeRef.current = props.onPageChange
  const onCreateRef = useRef<PdfViewerProps['onCreate']>(props.onCreate)
  onCreateRef.current = props.onCreate
  const onAskRef = useRef<PdfViewerProps['onAsk']>(props.onAsk)
  onAskRef.current = props.onAsk
  const onFocusAnnotationRef = useRef<PdfViewerProps['onFocusAnnotation']>(props.onFocusAnnotation)
  onFocusAnnotationRef.current = props.onFocusAnnotation

  useEffect(() => {
    pageSizesRef.current = pageSizes
  }, [pageSizes])

  useEffect(() => {
    fitModeRef.current = fitMode
  }, [fitMode])

  /* ── CSS / pdf_viewer.css injection (once, removed on unmount) ────────── */
  useEffect(() => {
    const releaseStyle = acquireViewerStyle()
    const releaseCss = acquireViewerCss(pdfjsAsset('web/pdf_viewer.css', assetBase))
    return () => {
      releaseStyle()
      releaseCss()
    }
  }, [assetBase])

  /* ── pdf.js document load / destroy ───────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    epochRef.current += 1
    const epoch = epochRef.current

    setStatus('loading')
    setErrorText('')
    setNumPages(0)
    setPageSizes([])
    pageSizesRef.current = []
    setLowTextPages(new Set<number>())
    setSelection(null)
    setAskOpen(false)
    setQuestion('')
    setCopied(false)
    setFlashId(null)
    lastFocusedAnnotationRef.current = null
    currentPageRef.current = 1
    setCurrentPage(1)
    setPageText('1')
    visibleRef.current.clear()
    pagesRef.current.clear()
    loadingTaskRef.current = null
    fitModeRef.current = true
    setFitMode(true)
    zoomAnchorRef.current = null

    void (async () => {
      try {
        const pdfjs = await loadPdfjs(assetBase)
        if (cancelled || epoch !== epochRef.current) return
        const documentTask = pdfjs.getDocument({
          url: src,
          cMapUrl: pdfjsAsset('cmaps/', assetBase),
          cMapPacked: true,
          standardFontDataUrl: pdfjsAsset('standard_fonts/', assetBase),
          wasmUrl: pdfjsAsset('wasm/', assetBase),
        }) as LoadingTaskLike
        loadingTaskRef.current = documentTask
        const doc = await documentTask.promise
        if (cancelled || epoch !== epochRef.current) {
          loadingTaskRef.current = null
          void doc.destroy().catch(() => undefined)
          return
        }
        const firstPage = await doc.getPage(1)
        if (cancelled || epoch !== epochRef.current) {
          loadingTaskRef.current = null
          void doc.destroy().catch(() => undefined)
          return
        }
        const firstViewport = firstPage.getViewport({ scale: 1 })
        const baseSize: PageSize = { width: firstViewport.width, height: firstViewport.height }
        const sizes: PageSize[] = Array.from({ length: doc.numPages }, () => baseSize)

        docRef.current = doc
        pdfjsRef.current = pdfjs

        // Initial zoom: fit width, using the still-mounted loading shell width.
        const rootWidth = rootRef.current?.clientWidth ?? 0
        const available = rootWidth - PAGE_GUTTER * 2
        const initialZoom = available > 80 ? clampZoom(available / (baseSize.width * CSS_UNITS)) : 1
        zoomRef.current = initialZoom
        setZoom(initialZoom)

        setPageSizes(sizes)
        pageSizesRef.current = sizes
        setNumPages(doc.numPages)
        setStatus('ready')

        // Placeholder boxes for pages with a different aspect ratio: fetch scale-1
        // viewports in small batches so scrollbar/extent stay stable. Cheap: reading
        // a viewport does not rasterise the page.
        for (let start = 2; start <= doc.numPages; start += 12) {
          if (cancelled || epoch !== epochRef.current) return
          const end = Math.min(doc.numPages, start + 11)
          const batch: Promise<void>[] = []
          for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
            batch.push(
              doc
                .getPage(pageNumber)
                .then((page) => {
                  const viewport = page.getViewport({ scale: 1 })
                  sizes[pageNumber - 1] = { width: viewport.width, height: viewport.height }
                })
                .catch(() => undefined),
            )
          }
          await Promise.all(batch)
          if (cancelled || epoch !== epochRef.current) return
          setPageSizes(sizes.slice())
        }
      } catch (error) {
        if (cancelled || epoch !== epochRef.current) return
        const message = error instanceof Error ? error.message : String(error)
        setErrorText(message)
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      epochRef.current += 1
      for (const view of pagesRef.current.values()) {
        view.token += 1
        try {
          view.renderTask?.cancel()
        } catch {
          // Render task already settled.
        }
        view.textHost.replaceChildren()
      }
      pagesRef.current.clear()
      visibleRef.current.clear()
      const task = loadingTaskRef.current
      loadingTaskRef.current = null
      const doc = docRef.current
      docRef.current = null
      pdfjsRef.current = null
      if (task?.destroy !== undefined) void task.destroy().catch(() => undefined)
      else if (doc !== null) void doc.destroy().catch(() => undefined)
    }
  }, [src, assetBase, attempt])

  /* ── current-page tracking (most visible page) ────────────────────────── */
  const updateCurrentPage = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const scrollRect = scroller.getBoundingClientRect()
    let bestPage = 0
    let bestVisible = 0
    for (const [page, view] of pagesRef.current) {
      const rect = view.pageEl.getBoundingClientRect()
      const visible = Math.min(rect.bottom, scrollRect.bottom) - Math.max(rect.top, scrollRect.top)
      if (visible > bestVisible) {
        bestVisible = visible
        bestPage = page
      }
    }
    if (bestPage < 1 || bestVisible <= 0) return
    if (bestPage === currentPageRef.current) return
    currentPageRef.current = bestPage
    setCurrentPage(bestPage)
    onPageChangeRef.current?.(bestPage)
  }, [])

  /* ── zoom helpers ─────────────────────────────────────────────────────── */
  const captureZoomAnchor = useCallback((): ZoomAnchor | null => {
    const scroller = scrollerRef.current
    const view = pagesRef.current.get(currentPageRef.current)
    if (scroller === null || view === undefined) return null
    const scrollRect = scroller.getBoundingClientRect()
    const pageRect = view.pageEl.getBoundingClientRect()
    if (pageRect.height <= 0) return null
    return { page: currentPageRef.current, frac: (scrollRect.top - pageRect.top) / pageRect.height }
  }, [])

  const applyZoom = useCallback(
    (next: number, anchor: boolean) => {
      const target = clampZoom(next)
      if (Math.abs(target - zoomRef.current) < 0.0005) return
      if (anchor) zoomAnchorRef.current = captureZoomAnchor()
      zoomRef.current = target
      setZoom(target)
    },
    [captureZoomAnchor],
  )

  const computeFitZoom = useCallback((sizes: readonly PageSize[]): number => {
    let widest = 0
    for (const size of sizes) {
      if (size.width > widest) widest = size.width
    }
    if (widest <= 0) return 1
    const scroller = scrollerRef.current
    const available = scroller === null ? 0 : scroller.clientWidth - PAGE_GUTTER * 2
    return clampZoom(available > 80 ? available / (widest * CSS_UNITS) : 1)
  }, [])

  /* ── page render / release ────────────────────────────────────────────── */
  const releasePage = useCallback((pageNumber: number) => {
    const view = pagesRef.current.get(pageNumber)
    if (view === undefined) return
    view.token += 1
    try {
      view.renderTask?.cancel()
    } catch {
      // Render task already settled.
    }
    view.renderTask = undefined
    view.pendingKey = undefined
    view.renderedKey = undefined
    view.textHost.replaceChildren()
    view.canvas.width = 0
    view.canvas.height = 0
    view.canvas.style.width = ''
    view.canvas.style.height = ''
  }, [])

  const renderPage = useCallback(async (pageNumber: number): Promise<void> => {
    const view = pagesRef.current.get(pageNumber)
    const doc = docRef.current
    const pdfjs = pdfjsRef.current
    if (view === undefined || doc === null || pdfjs === null) return

    const key = renderKey(zoomRef.current)
    if (view.renderedKey === key || view.pendingKey === key) return

    const epoch = epochRef.current
    const token = view.token + 1
    view.token = token
    view.pendingKey = key
    try {
      view.renderTask?.cancel()
    } catch {
      // Render task already settled.
    }
    view.renderTask = undefined
    view.textHost.replaceChildren()

    try {
      const page = await doc.getPage(pageNumber)
      if (epoch !== epochRef.current || token !== view.token) return

      const scale = zoomRef.current * CSS_UNITS
      const dpr = currentDpr()
      const viewport = page.getViewport({ scale })
      const canvas = view.canvas
      // Back the canvas with device pixels; draw at CSS size viewport.width/height.
      canvas.width = Math.max(1, Math.round(viewport.width * dpr))
      canvas.height = Math.max(1, Math.round(viewport.height * dpr))
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const task = page.render({
        canvas,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
        intent: 'display',
      })
      view.renderTask = task
      await task.promise
      if (epoch !== epochRef.current || token !== view.token) return
      view.renderedKey = key
      view.renderTask = undefined

      // Selectable text layer (pdf.js TextLayer + served web/pdf_viewer.css).
      // A fresh `.textLayer` container per render means a stale, cancelled layer
      // can only ever write into its own detached node.
      const container = document.createElement('div')
      container.className = 'textLayer'
      container.dataset.pdvPage = String(pageNumber)
      view.textHost.replaceChildren(container)
      try {
        const source =
          typeof page.streamTextContent === 'function'
            ? page.streamTextContent({ includeMarkedContent: true, disableNormalization: true })
            : await page.getTextContent({ includeMarkedContent: true, disableNormalization: true })
        if (epoch !== epochRef.current || token !== view.token) return
        const textLayer = new pdfjs.TextLayer({ textContentSource: source, container, viewport })
        await textLayer.render()
        if (epoch !== epochRef.current || token !== view.token) return
        const hasText = (container.textContent ?? '').trim().length > 0
        setLowTextPages((previous) => {
          const isLow = !hasText
          if (previous.has(pageNumber) === isLow) return previous
          const next = new Set(previous)
          if (isLow) next.add(pageNumber)
          else next.delete(pageNumber)
          return next
        })
      } catch {
        // Text layer failure is not fatal: the raster page stays usable.
      }
    } catch (error) {
      if (epoch !== epochRef.current || token !== view.token) return
      const name = (error as { name?: string } | null)?.name
      // RenderingCancelledException is expected on zoom/unmount; keep the
      // placeholder and let the next observation retry.
      if (name !== 'RenderingCancelledException') {
        view.pendingKey = undefined
      }
    } finally {
      if (token === view.token) view.pendingKey = undefined
    }
  }, [])

  /* ── page registration (stable ref callback; children queried from DOM) ─ */
  const registerPage = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return
    const page = Number(element.dataset.pdvPage)
    if (!Number.isFinite(page) || page < 1) return
    const pageEl = element.querySelector<HTMLDivElement>('.pdv-page')
    const canvas = element.querySelector<HTMLCanvasElement>('.pdv-canvas')
    const textHost = element.querySelector<HTMLDivElement>('.pdv-textHost')
    if (pageEl === null || canvas === null || textHost === null) return
    const existing = pagesRef.current.get(page)
    if (existing !== undefined && existing.wrap === element) {
      existing.pageEl = pageEl
      existing.canvas = canvas
      existing.textHost = textHost
      return
    }
    if (existing !== undefined) {
      existing.token += 1
      try {
        existing.renderTask?.cancel()
      } catch {
        // Render task already settled.
      }
      existing.textHost.replaceChildren()
      existing.canvas.width = 0
      existing.canvas.height = 0
    }
    pagesRef.current.set(page, {
      wrap: element,
      pageEl,
      canvas,
      textHost,
      token: 0,
    })
  }, [])

  /* ── lazy rendering via IntersectionObserver ──────────────────────────── */
  useEffect(() => {
    const scroller = scrollerRef.current
    if (status !== 'ready' || scroller === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement
          const page = Number(target.dataset.pdvPage)
          if (!Number.isFinite(page) || page < 1) continue
          if (entry.isIntersecting) {
            visibleRef.current.add(page)
            void renderPage(page)
          } else {
            visibleRef.current.delete(page)
            releasePage(page)
          }
        }
        updateCurrentPage()
      },
      { root: scroller, rootMargin: RENDER_MARGIN, threshold: 0 },
    )
    for (const view of pagesRef.current.values()) observer.observe(view.wrap)
    return () => observer.disconnect()
  }, [status, numPages, attempt, renderPage, releasePage, updateCurrentPage])

  /* ── continuous scroll: current page + dismiss floating tools ─────────── */
  useEffect(() => {
    const scroller = scrollerRef.current
    if (status !== 'ready' || scroller === null) return
    let frame = 0
    const onScroll = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        updateCurrentPage()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    updateCurrentPage()
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [status, updateCurrentPage])

  /* ── re-render visible pages when zoom changes; free far pages ────────── */
  useEffect(() => {
    if (status !== 'ready') return
    const key = renderKey(zoom)
    for (const [page, view] of pagesRef.current) {
      if (view.renderedKey === key || view.pendingKey === key) continue
      if (visibleRef.current.has(page)) {
        view.token += 1
        try {
          view.renderTask?.cancel()
        } catch {
          // Render task already settled.
        }
        view.renderTask = undefined
        view.pendingKey = undefined
        view.renderedKey = undefined
        view.textHost.replaceChildren()
      } else {
        releasePage(page)
      }
    }
    for (const page of visibleRef.current) void renderPage(page)
  }, [zoom, status, renderPage, releasePage])

  /* ── fit-width (initial + on resize) ──────────────────────────────────── */
  useEffect(() => {
    if (status !== 'ready' || !fitMode || pageSizes.length === 0) return
    applyZoom(computeFitZoom(pageSizes), true)
  }, [status, fitMode, pageSizes, applyZoom, computeFitZoom])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (status !== 'ready' || scroller === null) return
    const observer = new ResizeObserver(() => {
      if (!fitModeRef.current) return
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        applyZoom(computeFitZoom(pageSizesRef.current), true)
      }, 140)
    })
    observer.observe(scroller)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
    }
  }, [status, applyZoom, computeFitZoom])

  /* ── preserve the reading position across zoom changes ────────────────── */
  useEffect(() => {
    const anchor = zoomAnchorRef.current
    if (anchor === null) return
    zoomAnchorRef.current = null
    const scroller = scrollerRef.current
    const view = pagesRef.current.get(anchor.page)
    if (scroller === null || view === undefined) return
    const scrollRect = scroller.getBoundingClientRect()
    const pageRect = view.pageEl.getBoundingClientRect()
    scroller.scrollTop += anchor.frac * pageRect.height - (pageRect.top - scrollRect.top)
  }, [zoom])

  /* ── focusPage / focusAnnotationId (external rail clicks) ─────────────── */
  useEffect(() => {
    if (status !== 'ready' || focusPage === undefined) return
    const page = Math.round(focusPage)
    if (!Number.isFinite(page) || page < 1 || page > numPages) return
    const scroller = scrollerRef.current
    const view = pagesRef.current.get(page)
    if (scroller === null || view === undefined) return
    scrollPageIntoView(scroller, view.pageEl, 'start')
    currentPageRef.current = page
    setCurrentPage(page)
  }, [focusPage, focusNonce, status, numPages])

  useEffect(() => {
    if (focusAnnotationId === undefined || focusAnnotationId === null || focusAnnotationId.length === 0) {
      lastFocusedAnnotationRef.current = null
      return
    }
    if (status !== 'ready' || lastFocusedAnnotationRef.current === focusAnnotationId) return
    const root = rootRef.current
    if (root === null) return
    const element = root.querySelector<HTMLElement>(
      `[data-annotation-id="${cssEscape(focusAnnotationId)}"]`,
    )
    if (element === null) return
    lastFocusedAnnotationRef.current = focusAnnotationId
    const scroller = scrollerRef.current
    if (scroller !== null) scrollPageIntoView(scroller, element, 'center')
    setFlashId(focusAnnotationId)
    const timer = window.setTimeout(() => setFlashId(null), 1700)
    return () => window.clearTimeout(timer)
  }, [focusAnnotationId, status, annotations])

  /* ── page input sync ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (pageInputFocusedRef.current) return
    setPageText(String(currentPage))
  }, [currentPage])

  /* ── selection capture ────────────────────────────────────────────────── */
  const captureSelection = useCallback(() => {
    const root = rootRef.current
    if (root === null) return
    const domSelection = window.getSelection()
    if (domSelection === null || domSelection.rangeCount === 0 || domSelection.isCollapsed) return
    const range = domSelection.getRangeAt(0)
    const startNode = range.startContainer
    const startElement = startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement
    const textLayer = startElement?.closest?.('.textLayer') ?? null
    if (!(textLayer instanceof HTMLElement) || !root.contains(textLayer)) return
    const page = Number(textLayer.dataset.pdvPage)
    if (!Number.isFinite(page)) return
    const view = pagesRef.current.get(page)
    if (view === undefined) return
    const pageRect = view.pageEl.getBoundingClientRect()
    if (pageRect.width <= 0 || pageRect.height <= 0) return
    const rootRect = root.getBoundingClientRect()

    const rects: AnnotationRect[] = []
    let anchorRect: DOMRect | null = null
    const rawRects = range.getClientRects()
    for (let index = 0; index < rawRects.length && rects.length < MAX_RECTS; index += 1) {
      const raw = rawRects[index]
      if (raw === undefined || raw.width < 0.5 || raw.height < 0.5) continue
      const left = Math.max(raw.left, pageRect.left)
      const top = Math.max(raw.top, pageRect.top)
      const right = Math.min(raw.right, pageRect.right)
      const bottom = Math.min(raw.bottom, pageRect.bottom)
      if (right - left < 0.5 || bottom - top < 0.5) continue
      rects.push({
        x: clamp01((left - pageRect.left) / pageRect.width),
        y: clamp01((top - pageRect.top) / pageRect.height),
        w: clamp01((right - left) / pageRect.width),
        h: clamp01((bottom - top) / pageRect.height),
      })
      if (anchorRect === null) anchorRect = raw
    }
    if (rects.length === 0 || anchorRect === null) return
    const quote = normaliseQuote(domSelection.toString())
    if (quote.length === 0) return

    const rootWidth = rootRect.width
    const centerX = anchorRect.left + anchorRect.width / 2 - rootRect.left
    const selTop = anchorRect.top - rootRect.top
    const selBottom = anchorRect.bottom - rootRect.top
    const half = Math.min(150, Math.max(60, rootWidth / 2 - 8))
    const askHalf = Math.min(140, Math.max(60, rootWidth / 2 - 8))
    const toolbarAbove = selTop >= 56
    const askAbove = selTop >= 190
    setSelection({
      page,
      rects,
      quote,
      x: clamp(centerX, half + 4, Math.max(half + 4, rootWidth - half - 4)),
      y: toolbarAbove ? selTop - 8 : selBottom + 8,
      below: !toolbarAbove,
      askX: clamp(centerX, askHalf + 4, Math.max(askHalf + 4, rootWidth - askHalf - 4)),
      askY: askAbove ? selTop - 8 : selBottom + 12,
      askBelow: !askAbove,
    })
    setAskOpen(false)
    setQuestion('')
    setCopied(false)
  }, [])

  const handleSelectionEnd = useCallback(() => {
    // Let the browser finalise the Selection before reading its ranges.
    window.setTimeout(captureSelection, 0)
  }, [captureSelection])

  const dismissSelection = useCallback((clearNative: boolean) => {
    setSelection(null)
    setAskOpen(false)
    setQuestion('')
    setCopied(false)
    if (clearNative) {
      const domSelection = window.getSelection()
      if (domSelection !== null && domSelection.rangeCount > 0) domSelection.removeAllRanges()
    }
  }, [])

  /* ── Escape / scroll / click-away dismissal ───────────────────────────── */
  useEffect(() => {
    if (selection === null && !askOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      dismissSelection(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [selection, askOpen, dismissSelection])

  useEffect(() => {
    if (selection === null && !askOpen) return
    const scroller = scrollerRef.current
    if (scroller === null) return
    const onScroll = () => dismissSelection(false)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [selection, askOpen, dismissSelection])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('.pdv-selbar, .pdv-ask') !== null) return
    if (selection !== null || askOpen) dismissSelection(false)
  }

  /* ── toolbar / selection actions ──────────────────────────────────────── */
  const goToPage = (value: number) => {
    const target = clamp(Math.round(value), 1, Math.max(1, numPages))
    const scroller = scrollerRef.current
    const view = pagesRef.current.get(target)
    if (scroller !== null && view !== undefined) scrollPageIntoView(scroller, view.pageEl, 'start')
    currentPageRef.current = target
    setCurrentPage(target)
    setPageText(String(target))
  }

  const commitPageInput = () => {
    const parsed = Number.parseInt(pageText, 10)
    goToPage(Number.isFinite(parsed) ? parsed : currentPageRef.current)
  }

  const handlePageInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitPageInput()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setPageText(String(currentPageRef.current))
      event.currentTarget.blur()
    }
  }

  const changeZoom = (factor: number) => {
    fitModeRef.current = false
    setFitMode(false)
    applyZoom(zoomRef.current * factor, true)
  }

  const chooseFitWidth = () => {
    fitModeRef.current = true
    setFitMode(true)
    applyZoom(computeFitZoom(pageSizesRef.current), true)
  }

  const chooseActualSize = () => {
    fitModeRef.current = false
    setFitMode(false)
    applyZoom(1, true)
  }

  const runCreate = async (kind: AnnotationKind) => {
    if (selection === null || busy) return
    const payload: PdfSelectionPayload & { kind: AnnotationKind; comment?: string } = {
      page: selection.page,
      rects: selection.rects,
      quote: selection.quote,
      kind,
    }
    if (kind === 'note') payload.comment = ''
    setBusy(true)
    try {
      await onCreateRef.current(payload)
    } catch {
      // The parent owns error reporting/toasts.
    }
    setBusy(false)
    dismissSelection(true)
  }

  const openAsk = () => {
    if (selection === null) return
    setAskOpen(true)
    setQuestion('')
    setCopied(false)
  }

  const cancelAsk = () => {
    setAskOpen(false)
    setQuestion('')
  }

  const submitAsk = async () => {
    if (selection === null || busy) return
    const text = question.trim()
    if (text.length === 0) return
    setBusy(true)
    try {
      await onAskRef.current({
        page: selection.page,
        rects: selection.rects,
        quote: selection.quote,
        question: text,
      })
    } catch {
      // The parent owns error reporting/toasts.
    }
    setBusy(false)
    dismissSelection(true)
  }

  const copyQuote = async () => {
    if (selection === null) return
    let ok = false
    try {
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(selection.quote)
        ok = true
      }
    } catch {
      ok = false
    }
    if (!ok) return
    setCopied(true)
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null
      setCopied(false)
    }, 1600)
  }

  /* ── grouped annotation overlays ──────────────────────────────────────── */
  const annotationsByPage = useMemo(() => {
    const map = new Map<number, AnnotationItem[]>()
    for (const item of annotations) {
      const list = map.get(item.page)
      if (list === undefined) map.set(item.page, [item])
      else list.push(item)
    }
    for (const list of map.values()) {
      list.sort((left, right) => annotationRank(left.kind) - annotationRank(right.kind))
    }
    return map
  }, [annotations])

  /* ── render ───────────────────────────────────────────────────────────── */
  if (status === 'loading') {
    return (
      <div className="pdv-root pdv-center" ref={rootRef} role="status" aria-live="polite" aria-busy="true">
        <span className="pdv-spinner" aria-hidden="true" />
        <span>{labels.loading}</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="pdv-root pdv-center" ref={rootRef} role="alert">
        <div className="pdv-errorTitle">{labels.loadError}</div>
        {errorText.length > 0 ? <div className="pdv-errorDetail">{errorText}</div> : null}
        <button type="button" className="pdv-btn pdv-primary" onClick={() => setAttempt((value) => value + 1)}>
          {labels.retry}
        </button>
      </div>
    )
  }

  const viewportScale = zoom * CSS_UNITS
  const zoomPercent = Math.round(zoom * 100)

  return (
    <div className="pdv-root" ref={rootRef} onPointerDown={handleRootPointerDown}>
      <div className="pdv-toolbar" role="toolbar">
        <button
          type="button"
          className="pdv-btn"
          aria-label={labels.prev}
          title={labels.prev}
          disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          <ToolbarIcon name="prev" />
        </button>
        <div className="pdv-pageBox">
          <input
            className="pdv-pageInput"
            aria-label={labels.page}
            inputMode="numeric"
            value={pageText}
            onChange={(event) => setPageText(event.target.value)}
            onFocus={() => {
              pageInputFocusedRef.current = true
            }}
            onBlur={() => {
              pageInputFocusedRef.current = false
              setPageText(String(currentPageRef.current))
            }}
            onKeyDown={handlePageInputKeyDown}
          />
          <span className="pdv-pageTotal">
            {labels.of} {numPages}
          </span>
        </div>
        <button
          type="button"
          className="pdv-btn"
          aria-label={labels.next}
          title={labels.next}
          disabled={currentPage >= numPages}
          onClick={() => goToPage(currentPage + 1)}
        >
          <ToolbarIcon name="next" />
        </button>
        <span className="pdv-spacer" />
        <button
          type="button"
          className="pdv-btn"
          aria-label={labels.zoomOut}
          title={labels.zoomOut}
          onClick={() => changeZoom(1 / 1.25)}
        >
          <ToolbarIcon name="zoomOut" />
        </button>
        <span className="pdv-pct" aria-live="polite">
          {zoomPercent}%
        </span>
        <button
          type="button"
          className="pdv-btn"
          aria-label={labels.zoomIn}
          title={labels.zoomIn}
          onClick={() => changeZoom(1.25)}
        >
          <ToolbarIcon name="zoomIn" />
        </button>
        <button
          type="button"
          className="pdv-btn"
          aria-label={labels.fitWidth}
          title={labels.fitWidth}
          aria-pressed={fitMode}
          onClick={chooseFitWidth}
        >
          {labels.fitWidth}
        </button>
        <button
          type="button"
          className="pdv-btn"
          aria-label={labels.actualSize}
          title={labels.actualSize}
          onClick={chooseActualSize}
        >
          {labels.actualSize}
        </button>
      </div>

      {lowTextHint !== undefined && lowTextHint.length > 0 ? (
        <div className="pdv-docHint" role="status">
          {lowTextHint}
        </div>
      ) : null}

      <div className="pdv-scroll" ref={scrollerRef} onMouseUp={handleSelectionEnd} onKeyUp={handleSelectionEnd}>
        <div className="pdv-pages">
          {pageSizes.map((size, index) => {
            const page = index + 1
            const pageStyle = {
              width: `${size.width * viewportScale}px`,
              height: `${size.height * viewportScale}px`,
              '--scale-factor': String(viewportScale),
              '--user-unit': '1',
              '--total-scale-factor': String(viewportScale),
              '--scale-round-x': '1px',
              '--scale-round-y': '1px',
            } as CSSProperties
            const lowText = lowTextPages.has(page)
            return (
              <div className="pdv-pageWrap" key={page} data-pdv-page={page} ref={registerPage}>
                <div className="pdv-page" style={pageStyle}>
                  <canvas className="pdv-canvas" width={0} height={0} />
                  <div className="pdv-textHost" />
                  <div className="pdv-annotLayer">
                    {renderAnnotationNodes(
                      annotationsByPage.get(page) ?? [],
                      labels,
                      flashId,
                      onFocusAnnotationRef.current,
                    )}
                  </div>
                  {lowText ? <div className="pdv-lowText">{labels.textLayerUnavailable}</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selection !== null && !askOpen ? (
        <div
          className={`pdv-selbar${selection.below ? ' pdv-below' : ''}`}
          style={{ left: `${selection.x}px`, top: `${selection.y}px` }}
          role="toolbar"
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            aria-label={labels.highlight}
            disabled={busy}
            onClick={() => {
              void runCreate('highlight')
            }}
          >
            {labels.highlight}
          </button>
          <button
            type="button"
            aria-label={labels.underline}
            disabled={busy}
            onClick={() => {
              void runCreate('underline')
            }}
          >
            {labels.underline}
          </button>
          <button
            type="button"
            aria-label={labels.note}
            disabled={busy}
            onClick={() => {
              void runCreate('note')
            }}
          >
            {labels.note}
          </button>
          <button type="button" aria-label={labels.ask} disabled={busy} onClick={openAsk}>
            {labels.ask}
          </button>
          <button
            type="button"
            aria-label={copied ? labels.copied : labels.copy}
            onClick={() => void copyQuote()}
          >
            {copied ? labels.copied : labels.copy}
          </button>
        </div>
      ) : null}

      {selection !== null && askOpen ? (
        <div
          className={`pdv-ask${selection.askBelow ? ' pdv-below' : ''}`}
          style={{ left: `${selection.askX}px`, top: `${selection.askY}px` }}
          role="dialog"
          aria-modal="false"
          aria-label={labels.askTitle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="pdv-askTitle">{labels.askTitle}</div>
          <textarea
            className="pdv-askInput"
            aria-label={labels.askPlaceholder}
            placeholder={labels.askPlaceholder}
            value={question}
            autoFocus
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submitAsk()
              }
            }}
          />
          <div className="pdv-askActions">
            <button type="button" className="pdv-btn" onClick={cancelAsk}>
              {labels.cancel}
            </button>
            <button
              type="button"
              className="pdv-btn pdv-primary"
              disabled={busy || question.trim().length === 0}
              onClick={() => void submitAsk()}
            >
              {labels.askSubmit}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
