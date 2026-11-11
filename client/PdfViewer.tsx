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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_KEYMAP,
  KEY_ACTION_LABELS,
  KEY_ACTIONS,
  formatKeyBinding,
  loadKeyMap,
  matchesBinding,
} from './keymap.js'
import type { KeyAction, KeyMap } from './keymap.js'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import type { AnnotationColor, AnnotationItem, AnnotationKind, AnnotationRect } from '../src/types.js'
import { configurePdfjsRenderer } from './pdf-engine.js'
import { loadPdfjs, pdfjsAsset } from './pdfjs.js'
import type { PdfDocumentLike, PdfPageLike, PdfjsModule, PdfViewportLike } from './pdfjs.js'

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
  visualMode: string
  visualHint: string
  shortcuts: string
  shortcutsHint: string
  close: string
  keymapLabels: Record<KeyAction, string>
  /* Optional labels for the reader-UI extras (defaults in the viewer keep old
     integrators — and locales without new keys — working unchanged). */
  outline?: string
  noOutline?: string
  find?: string
  findPlaceholder?: string
  findNoResults?: string
  findPrev?: string
  findNext?: string
  hand?: string
  darkPaper?: string
  lightPaper?: string
  addToAi?: string
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
  onCreate: (payload: PdfSelectionPayload & { kind: AnnotationKind; comment?: string; color?: AnnotationColor }) => void | Promise<void>
  onAsk: (payload: PdfSelectionPayload & { question: string }) => void | Promise<void>
  /** Hand the selection to the AI chat composer (prefill, no automatic run). */
  onAddToAi?: (payload: PdfSelectionPayload) => void | Promise<void>
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
const MAX_DPR = 2
/** Host validator bound (`ANNOTATION_LIMITS`) mirrored client-side. */
const MAX_QUOTE = 4000
const MAX_RECTS = 60
/** Render pages comfortably before they enter the viewport. */
const RENDER_MARGIN = '700px 0px'
/** Keep recently rendered pages warm for fast back/forward flips. */
const RELEASE_DELAY_MS = 1200
const PREFETCH_IDLE_TIMEOUT_MS = 900
/** Only this many pages exist in the DOM around the current page. */
const PAGE_WINDOW = 2
const STYLE_ATTR = 'paper-desk-viewer'
const PAPER_TONE_STORAGE = 'paperdesk:paper-tone'
const HIGHLIGHT_COLOR_STORAGE = 'paperdesk:highlight-color'
/** Selection-menu highlight palette (>=3 colours required by the reader UX). */
const HIGHLIGHT_COLORS: readonly AnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']
const OUTLINE_MAX_NODES = 400
const LINK_MAX_PER_PAGE = 200
const FIND_DEBOUNCE_MS = 260
const FIND_MAX_PAGES = 4000

/** Defaults for the optional reader-UI labels, so older integrators keep working. */
const UI_DEFAULTS = {
  outline: 'Outline',
  noOutline: 'No outline in this PDF',
  find: 'Find in PDF',
  findPlaceholder: 'Search text…',
  findNoResults: 'No matches',
  findPrev: 'Previous match',
  findNext: 'Next match',
  hand: 'Pan tool',
  darkPaper: 'Dark paper',
  lightPaper: 'Light paper',
  addToAi: 'Add to AI',
} as const

type UiLabelKey = keyof typeof UI_DEFAULTS

function uiLabel(labels: PdfViewerLabels, key: UiLabelKey): string {
  const value = labels[key]
  return value !== undefined && value.length > 0 ? value : UI_DEFAULTS[key]
}

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
  overflow-anchor: none;
  background: var(--dsw-alias-bg-layer-2);
}
.pdv-scrollWrap { position: relative; display: flex; flex: 1 1 auto; min-height: 0; }
.pdv-scroll,
.pdv-scroll::-webkit-scrollbar { scrollbar-width: none; }
.pdv-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
.pdv-scrollRail {
  position: absolute;
  top: 4px;
  right: 4px;
  bottom: 4px;
  z-index: 9;
  width: 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 7%, transparent);
  opacity: .8;
  transition: opacity 120ms ease;
}
.pdv-scrollRail:hover,
.pdv-scrollRail[data-dragging='true'] { opacity: 1; }
.pdv-scrollRail[data-empty='true'] { display: none; }
.pdv-scrollThumb {
  position: absolute;
  left: 3px;
  right: 3px;
  top: 0;
  min-height: 48px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 46%, transparent);
  cursor: grab;
}
.pdv-scrollThumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 68%, transparent); }
.pdv-scrollRail[data-dragging='true'] .pdv-scrollThumb { cursor: grabbing; }
.pdv-scrollGhost {
  position: absolute;
  right: 24px;
  top: 0;
  min-width: 42px;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2));
  box-shadow: 0 4px 14px color-mix(in srgb, #000 18%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 11px;
  text-align: center;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-50%);
}
.pdv-scrollRail[data-dragging='true'] .pdv-scrollGhost { opacity: 1; }
.pdv-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100%;
  padding: 14px 0 56px;
}
.pdv-spacer { width: 100%; flex: 0 0 auto; }
.pdv-vim-hud {
  position: absolute;
  left: 50%;
  top: 52px;
  transform: translateX(-50%);
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 7px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2));
  box-shadow: var(--dsw-shadow-lv1, 0 4px 16px rgba(0,0,0,.16));
  color: var(--dsw-alias-label-primary);
  font-size: 11px;
}
.pdv-vim-hud strong { color: var(--dsw-alias-brand-primary); letter-spacing: .06em; }
.pdv-vim-hud span { color: var(--dsw-alias-label-secondary); }
.pdv-vim-help {
  position: absolute;
  right: 16px;
  top: 52px;
  z-index: 9;
  width: 260px;
  max-height: 60%;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2));
  box-shadow: var(--dsw-shadow-lv1, 0 8px 28px rgba(0,0,0,.18));
  color: var(--dsw-alias-label-primary);
  font-size: 11px;
}
.pdv-vim-help-head { display: flex; align-items: center; justify-content: space-between; }
.pdv-vim-help-head button { border: 0; background: transparent; color: inherit; font-size: 16px; cursor: pointer; }
.pdv-vim-help-hint { margin: 3px 0 7px; color: var(--dsw-alias-label-secondary); }
.pdv-vim-help dl { margin: 0; }
.pdv-vim-help-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0; }
.pdv-vim-help-row dt { color: var(--dsw-alias-label-secondary); }
.pdv-vim-help-row dd { margin: 0; }
.pdv-vim-help kbd {
  min-width: 24px;
  padding: 1px 5px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: center;
}
.pdv-root[data-resizing='true'] .pdv-textHost { content-visibility: hidden; }
.pdv-pageWrap {
  display: flex;
  justify-content: center;
  width: 100%;
  padding: 9px ${PAGE_GUTTER}px;
  scroll-margin-top: 10px;
  content-visibility: hidden;
  contain-intrinsic-size: auto 1200px;
}
.pdv-pageWrap[data-near='true'] { content-visibility: visible; }
.pdv-page {
  position: relative;
  flex: 0 0 auto;
  contain: layout paint;
  overflow: hidden;
  border-radius: 2px;
  background: #fff;
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent),
    0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
}
.pdv-canvas { position: absolute; top: 0; left: 0; display: block; }
.pdv-pageLoading {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font-size: 12px;
  background: #fff;
}
.pdv-pageWrap[data-rendered='true'] .pdv-pageLoading { display: none; }
.pdv-pageLoadingSpin {
  width: 14px;
  height: 14px;
  border: 1.5px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: pdvSpin .8s linear infinite;
}
@keyframes pdvSpin { to { transform: rotate(360deg); } }

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

/* ── outline drawer ─────────────────────────────────────────────────────── */
.pdv-outline {
  position: absolute;
  left: 8px;
  top: 8px;
  bottom: 8px;
  z-index: 8;
  display: flex;
  flex-direction: column;
  width: min(284px, calc(100% - 24px));
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: 0 8px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
}
.pdv-outlineHead {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 7px 9px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.pdv-outlineHead button {
  margin-left: auto;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}
.pdv-outlineHead button:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)); }
.pdv-outlineBody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px; }
.pdv-outlineRowWrap { display: flex; align-items: center; }
.pdv-outlineRow {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pdv-outlineRow:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)); }
.pdv-outlineRow[data-active='true'] { color: var(--dsw-alias-brand-primary); }
.pdv-outlineToggle {
  flex: 0 0 auto;
  width: 18px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  cursor: pointer;
}
.pdv-outlineTitle {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 4px 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.pdv-outlineEmpty { padding: 12px 10px; color: var(--dsw-alias-label-secondary); }

/* ── find bar ───────────────────────────────────────────────────────────── */
.pdv-findbar {
  position: absolute;
  top: 8px;
  right: 32px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: 0 6px 20px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
}
.pdv-findInput {
  width: 176px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.pdv-findInput:focus { border-color: var(--dsw-alias-brand-primary); outline: none; }
.pdv-findCount {
  min-width: 50px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.pdv-findbar button {
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}
.pdv-findbar button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)); }
.pdv-findbar button:disabled { opacity: .4; cursor: default; }
.pdv-textHost .textLayer span.pdv-findHit {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 52%, transparent);
  border-radius: 2px;
}
.pdv-textHost .textLayer span.pdv-findHitCurrent {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 85%, transparent);
  border-radius: 2px;
}

/* ── link layer ─────────────────────────────────────────────────────────── */
.pdv-linkLayer { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.pdv-link {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  pointer-events: auto;
  cursor: pointer;
}
.pdv-link:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary);
}

/* ── hand / pan ─────────────────────────────────────────────────────────── */
.pdv-root[data-hand='true'] .pdv-scroll { cursor: grab; }
.pdv-root[data-panning='true'] .pdv-scroll { cursor: grabbing; }
.pdv-root[data-hand='true'] .pdv-textHost,
.pdv-root[data-hand='true'] .pdv-annotLayer,
.pdv-root[data-hand='true'] .pdv-linkLayer { pointer-events: none; user-select: none; }
.pdv-root[data-hand='true'] .pdv-textHost .textLayer span { cursor: inherit; }

/* ── dark paper ─────────────────────────────────────────────────────────── */
.pdv-root[data-paper='dark'] .pdv-scroll { background: #14161a; }
.pdv-root[data-paper='dark'] .pdv-page { background: #14161a; box-shadow: 0 1px 2px #0008, 0 8px 24px #0006; }
.pdv-root[data-paper='dark'] .pdv-canvas { filter: invert(1) hue-rotate(180deg) brightness(.92) contrast(.95); }
.pdv-root[data-paper='dark'] .pdv-pageLoading { background: #14161a; color: var(--dsw-alias-label-secondary); }
.pdv-root[data-paper='dark'] .pdv-mark-highlight {
  background: color-mix(in srgb, var(--pdv-annot-color) 62%, transparent);
  mix-blend-mode: screen;
}
.pdv-root[data-paper='dark'] .pdv-lowText { background: #1c1f24; border-color: #3a3f46; }

/* ── floating selection toolbar ────────────────────────────────────────── */
.pdv-selbar {
  position: absolute;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px;
  max-width: calc(100% - 16px);
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
.pdv-selColors { display: flex; align-items: center; gap: 3px; padding: 0 4px; }
.pdv-selbar .pdv-selColor {
  width: 16px;
  height: 16px;
  min-width: 16px;
  padding: 0;
  border: 1px solid color-mix(in srgb, #000 20%, transparent);
  border-radius: 50%;
  background: var(--pdv-swatch);
}
.pdv-selbar .pdv-selColor[aria-pressed='true'] {
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-overlay, #fff), 0 0 0 3px var(--dsw-alias-brand-primary);
}
.pdv-selbar .pdv-selAi { display: inline-flex; align-items: center; gap: 3px; color: var(--dsw-alias-brand-primary); font-weight: 600; }

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
  previewKey?: string
  renderTask?: { promise: Promise<void>; cancel(): void }
}

/** One flattened outline entry (pdf.js outline tree → drawer rows). */
interface OutlineEntry {
  id: string
  title: string
  /** 1-based page, or null for external/unsupported destinations. */
  page: number | null
  /** External http(s) URL when the outline item is a web link. */
  url: string | null
  depth: number
  children: OutlineEntry[]
}

/** One clickable PDF link annotation, normalised to the page box. */
interface PageLink {
  id: string
  rect: AnnotationRect
  page: number | null
  url: string | null
}

interface FindPageMatch {
  page: number
  count: number
}

/** Structural view of the pdf.js document/page methods used by the new UI. */
interface OutlineDocumentLike {
  getOutline?(): Promise<unknown>
  getDestination?(name: string): Promise<unknown>
  getPageIndex?(ref: unknown): Promise<number>
}

interface LinkPageLike {
  getAnnotations?(): Promise<unknown>
}

interface LinkViewportLike {
  width: number
  height: number
  convertToViewportRectangle?(rect: number[]): number[]
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

function renderKey(zoom: number, dpr = currentDpr()): string {
  return `${(zoom * CSS_UNITS).toFixed(4)}|${dpr}`
}

/**
 * Surface whether pdf.js actually used its renderer worker for this page. The
 * attribute is diagnostic only (live A/B tests read it); rendering already
 * falls back to the main thread internally when the worker is unavailable.
 */
function recordRenderMode(view: PageView, task: unknown): void {
  const used = (task as { isWorkerRendering?: unknown } | null)?.isWorkerRendering === true
  view.wrap.dataset.render = used ? 'worker' : 'main'
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
function scrollPageIntoView(
  scroller: HTMLElement,
  element: HTMLElement,
  align: 'start' | 'center',
  behavior: ScrollBehavior = 'smooth',
): void {
  const scrollRect = scroller.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  if (elementRect.height <= 0 && elementRect.width <= 0) return
  const offset = align === 'center' ? Math.max(0, (scrollRect.height - elementRect.height) / 2) : 8
  const top = scroller.scrollTop + (elementRect.top - scrollRect.top) - offset
  scroller.scrollTo({ top: Math.max(0, top), behavior })
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

/* ── outline / find / links / tone helpers ──────────────────────────────── */

function loadStoredTone(): 'light' | 'dark' {
  try {
    return globalThis.localStorage?.getItem(PAPER_TONE_STORAGE) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function loadStoredHighlightColor(): AnnotationColor {
  try {
    const stored = globalThis.localStorage?.getItem(HIGHLIGHT_COLOR_STORAGE)
    if (stored !== null && stored !== undefined && (HIGHLIGHT_COLORS as readonly string[]).includes(stored)) {
      return stored as AnnotationColor
    }
  } catch {
    // ignore storage failures
  }
  return 'yellow'
}

function normaliseSearchText(text: string): string {
  return text.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1 && count < 999) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/** Mark matching text-layer spans on every currently mounted page. */
function applyFindHighlights(root: ParentNode, query: string, currentPage: number | null): void {
  const needle = normaliseSearchText(query)
  for (const layer of root.querySelectorAll<HTMLElement>('.textLayer')) {
    const page = Number(layer.dataset.pdvPage)
    for (const span of layer.querySelectorAll<HTMLElement>('span')) {
      span.classList.remove('pdv-findHit', 'pdv-findHitCurrent')
      if (needle.length === 0) continue
      const text = normaliseSearchText(span.textContent ?? '')
      if (text.length === 0 || !text.includes(needle)) continue
      span.classList.add('pdv-findHit')
      if (page === currentPage) span.classList.add('pdv-findHitCurrent')
    }
  }
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://example.invalid/')
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function openExternalUrl(url: string): void {
  if (!isSafeExternalUrl(url)) return
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    // Popup blocked; nothing else to do.
  }
}

/** Resolve an outline/link destination (named or explicit) to a 1-based page. */
async function resolveOutlineDest(doc: OutlineDocumentLike, dest: unknown): Promise<number | null> {
  let explicit = dest
  if (typeof explicit === 'string' && typeof doc.getDestination === 'function') {
    try {
      explicit = await doc.getDestination(explicit)
    } catch {
      return null
    }
  }
  if (!Array.isArray(explicit) || explicit.length === 0) return null
  const ref: unknown = explicit[0]
  if (typeof ref === 'number' && Number.isFinite(ref)) return Math.max(1, Math.round(ref) + 1)
  if (ref !== null && typeof ref === 'object' && typeof doc.getPageIndex === 'function') {
    try {
      const index = await doc.getPageIndex(ref)
      return Number.isFinite(index) ? Math.max(1, index + 1) : null
    } catch {
      return null
    }
  }
  return null
}

async function buildOutlineEntries(
  doc: OutlineDocumentLike,
  nodes: unknown,
  depth: number,
  prefix: string,
  budget: { left: number },
): Promise<OutlineEntry[]> {
  if (!Array.isArray(nodes) || budget.left <= 0) return []
  const entries: OutlineEntry[] = []
  for (let index = 0; index < nodes.length && budget.left > 0; index += 1) {
    const node: unknown = nodes[index]
    if (node === null || typeof node !== 'object') continue
    const raw = node as Record<string, unknown>
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (title.length === 0) continue
    budget.left -= 1
    const id = `${prefix}-${index}`
    const page = raw.dest === undefined || raw.dest === null ? null : await resolveOutlineDest(doc, raw.dest)
    const url = typeof raw.url === 'string' && isSafeExternalUrl(raw.url) ? raw.url : null
    const children = await buildOutlineEntries(doc, raw.items, depth + 1, id, budget)
    entries.push({ id, title, page, url, depth, children })
  }
  return entries
}

/** Count which pages contain `query` (page-level matches, no per-character spans). */
async function findPages(
  doc: PdfDocumentLike,
  query: string,
  isCancelled: () => boolean,
  textCache?: Map<number, string>,
): Promise<FindPageMatch[]> {
  const needle = normaliseSearchText(query)
  if (needle.length === 0) return []
  const matches: FindPageMatch[] = []
  const total = Math.min(doc.numPages, FIND_MAX_PAGES)
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    if (isCancelled()) return matches
    try {
      let text = textCache?.get(pageNumber)
      if (text === undefined) {
        const page = await doc.getPage(pageNumber)
        const content = (await page.getTextContent({ disableNormalization: false })) as {
          items?: readonly unknown[]
        }
        text = (content.items ?? [])
          .map((item) => {
            if (item !== null && typeof item === 'object' && typeof (item as { str?: unknown }).str === 'string') {
              return (item as { str: string }).str
            }
            return ''
          })
          .join(' ')
        textCache?.set(pageNumber, text)
      }
      if (isCancelled()) return matches
      const count = countOccurrences(normaliseSearchText(text), needle)
      if (count > 0) matches.push({ page: pageNumber, count })
    } catch {
      // A single broken page must not abort the whole search.
    }
  }
  return matches
}

/** Normalise a PDF-space link rectangle into the page box (0..1). */
function normaliseLinkRect(viewport: LinkViewportLike, rect: readonly number[]): AnnotationRect | null {
  if (rect.length < 4) return null
  let x1 = rect[0] ?? 0
  let y1 = rect[1] ?? 0
  let x2 = rect[2] ?? 0
  let y2 = rect[3] ?? 0
  if (typeof viewport.convertToViewportRectangle === 'function') {
    const converted = viewport.convertToViewportRectangle([x1, y1, x2, y2])
    if (Array.isArray(converted) && converted.length >= 4) {
      x1 = converted[0] ?? x1
      y1 = converted[1] ?? y1
      x2 = converted[2] ?? x2
      y2 = converted[3] ?? y2
    }
  }
  if (viewport.width <= 0 || viewport.height <= 0) return null
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)
  if (width <= 0 || height <= 0) return null
  return {
    x: clamp01(left / viewport.width),
    y: clamp01(top / viewport.height),
    w: clamp01(width / viewport.width),
    h: clamp01(height / viewport.height),
  }
}

/* ── small local icons (no external icon imports in this file) ──────────── */

type ToolbarIconName = 'prev' | 'next' | 'zoomIn' | 'zoomOut' | 'outline' | 'find' | 'hand' | 'moon' | 'sun' | 'ai'

function ToolbarIcon({ name }: { name: ToolbarIconName }): ReactElement {
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
      {name === 'outline' ? (
        <>
          <path d="M3.2 4h.1M3.2 8h.1M3.2 12h.1M6 4h7M6 8h7M6 12h5" />
        </>
      ) : null}
      {name === 'find' ? (
        <>
          <circle cx="7.2" cy="7.2" r="3.7" />
          <path d="m10 10 3.2 3.2" />
        </>
      ) : null}
      {name === 'hand' ? (
        <>
          <path d="M5.1 8.2V4.6a1 1 0 0 1 2 0v3.1" />
          <path d="M7.1 7.7V3.6a1 1 0 0 1 2 0v4.1" />
          <path d="M9.1 7.7V4.6a1 1 0 0 1 2 0v4.2" />
          <path d="M11.1 8.2v-1a1 1 0 0 1 2 0v3.1c0 2.1-1.7 3.7-3.8 3.7h-1c-1.2 0-2.2-.5-3-1.4L3 10.4a1 1 0 0 1 1.5-1.3l1.2 1.2" />
        </>
      ) : null}
      {name === 'moon' ? <path d="M12.6 9.4A5.2 5.2 0 0 1 6.6 3.4a5.3 5.3 0 1 0 6 6Z" /> : null}
      {name === 'sun' ? (
        <>
          <circle cx="8" cy="8" r="2.8" />
          <path d="M8 1.6v1.2M8 13.2v1.2M1.6 8h1.2M13.2 8h1.2M3.5 3.5l.9.9M11.6 11.6l.9.9M12.5 3.5l-.9.9M4.4 11.6l-.9.9" />
        </>
      ) : null}
      {name === 'ai' ? (
        <>
          <path d="M8 2.2 9.3 6l3.8 1.3-3.8 1.3L8 12.4 6.7 8.6 2.9 7.3 6.7 6Z" />
          <path d="M12.4 11.2v2M11.4 12.2h2" />
        </>
      ) : null}
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
  const observedWidthRef = useRef(0)
  const releaseTimersRef = useRef<Map<number, number>>(new Map())
  const previewUpgradeTimersRef = useRef<Map<number, number>>(new Map())
  const pageOffsetsRef = useRef<number[]>([])
  const pendingScrollPageRef = useRef<number | null>(null)
  const jumpGuardRef = useRef<{ page: number; until: number } | null>(null)
  const scrollingRef = useRef(false)
  const scrollIdleTimerRef = useRef<number | null>(null)
  const windowResizingRef = useRef(false)
  const windowResizeTimerRef = useRef<number | null>(null)
  const resizeCooldownRef = useRef(false)
  const resizeCooldownTimerRef = useRef<number | null>(null)
  const jumpCooldownRef = useRef(false)
  const jumpCooldownTimerRef = useRef<number | null>(null)
  const scrollRailRef = useRef<HTMLDivElement | null>(null)
  const scrollThumbRef = useRef<HTMLDivElement | null>(null)
  const scrollGhostRef = useRef<HTMLDivElement | null>(null)
  const scrollbarSyncFrameRef = useRef<number | null>(null)
  const scrollbarDraggingRef = useRef(false)
  const zoomRef = useRef(1)
  const pageSizesRef = useRef<readonly PageSize[]>([])
  const fitModeRef = useRef(true)
  const currentPageRef = useRef(1)
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null)
  const pageInputFocusedRef = useRef(false)
  const copyTimerRef = useRef<number | null>(null)
  const lastFocusedAnnotationRef = useRef<string | null>(null)
  const lastTextPointRef = useRef<{ x: number; y: number } | null>(null)
  const outlineLoadedRef = useRef(false)
  const linksLoadedRef = useRef<Set<number>>(new Set())
  const textCacheRef = useRef<Map<number, string>>(new Map())
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const findTimerRef = useRef<number | null>(null)
  const findQueryRef = useRef('')
  const findActivePageRef = useRef<number | null>(null)
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const handActiveRef = useRef(false)

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
  const [pageWindow, setPageWindow] = useState<{ start: number; end: number }>({ start: 1, end: 1 })
  const [qualityVersion, setQualityVersion] = useState(0)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [visualMode, setVisualMode] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [keymap, setKeymap] = useState<KeyMap>(() => loadKeyMap())
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [outlineLoaded, setOutlineLoaded] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineExpanded, setOutlineExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findMatches, setFindMatches] = useState<FindPageMatch[]>([])
  const [findIndex, setFindIndex] = useState(0)
  const [findBusy, setFindBusy] = useState(false)
  const [handMode, setHandMode] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [paperTone, setPaperTone] = useState<'light' | 'dark'>(() => loadStoredTone())
  const [highlightColor, setHighlightColor] = useState<AnnotationColor>(() => loadStoredHighlightColor())
  const [pageLinks, setPageLinks] = useState<ReadonlyMap<number, PageLink[]>>(() => new Map<number, PageLink[]>())
  const visualModeRef = useRef(false)
  visualModeRef.current = visualMode
  const keymapRef = useRef<KeyMap>(keymap)
  keymapRef.current = keymap
  findQueryRef.current = findQuery
  {
    const active = findMatches.length > 0
      ? findMatches[Math.min(Math.max(findIndex, 0), findMatches.length - 1)]
      : undefined
    findActivePageRef.current = active?.page ?? null
  }
  const handActive = handMode || spaceHeld
  handActiveRef.current = handActive

  const onPageChangeRef = useRef<PdfViewerProps['onPageChange']>(props.onPageChange)
  onPageChangeRef.current = props.onPageChange
  const onCreateRef = useRef<PdfViewerProps['onCreate']>(props.onCreate)
  onCreateRef.current = props.onCreate
  const onAskRef = useRef<PdfViewerProps['onAsk']>(props.onAsk)
  onAskRef.current = props.onAsk
  const onFocusAnnotationRef = useRef<PdfViewerProps['onFocusAnnotation']>(props.onFocusAnnotation)
  onFocusAnnotationRef.current = props.onFocusAnnotation
  const onAddToAiRef = useRef<PdfViewerProps['onAddToAi']>(props.onAddToAi)
  onAddToAiRef.current = props.onAddToAi

  useEffect(() => {
    pageSizesRef.current = pageSizes
  }, [pageSizes])

  useEffect(() => {
    const refresh = (): void => setKeymap(loadKeyMap())
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  useEffect(() => {
    fitModeRef.current = fitMode
  }, [fitMode])

  const setResizingUi = useCallback((active: boolean): void => {
    const root = rootRef.current
    if (root === null) return
    if (active) root.dataset.resizing = 'true'
    else delete root.dataset.resizing
  }, [])

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
    setOutline([])
    setOutlineLoaded(false)
    setOutlineOpen(false)
    setPageLinks(new Map<number, PageLink[]>())
    setFindOpen(false)
    setFindQuery('')
    setFindMatches([])
    setFindIndex(0)
    setFindBusy(false)
    findQueryRef.current = ''
    linksLoadedRef.current.clear()
    textCacheRef.current.clear()
    if (findTimerRef.current !== null) {
      window.clearTimeout(findTimerRef.current)
      findTimerRef.current = null
    }

    void (async () => {
      try {
        const pdfjs = await loadPdfjs(assetBase)
        if (cancelled || epoch !== epochRef.current) return
        // Move page rasterisation to pdf.js' renderer worker when available;
        // the document/text layer/annotation coordinates stay untouched.
        const rendererConfig = configurePdfjsRenderer(pdfjs, assetBase)
        if (rootRef.current !== null) {
          rootRef.current.dataset.pdfRenderer = rendererConfig.mode
        }
        const documentTask = pdfjs.getDocument({
          url: src,
          cMapUrl: pdfjsAsset('cmaps/', assetBase),
          cMapPacked: true,
          standardFontDataUrl: pdfjsAsset('standard_fonts/', assetBase),
          wasmUrl: pdfjsAsset('wasm/', assetBase),
          rangeChunkSize: 1024 * 1024,
          disableAutoFetch: false,
          disableStream: false,
          disableWorkerRendering: rendererConfig.mode === 'main',
        }) as LoadingTaskLike
        loadingTaskRef.current = documentTask
        const doc = await documentTask.promise
        if (cancelled || epoch !== epochRef.current) {
          loadingTaskRef.current = null
          void documentTask.destroy?.().catch(() => undefined)
          return
        }
        const firstPage = await doc.getPage(1)
        if (cancelled || epoch !== epochRef.current) {
          loadingTaskRef.current = null
          void documentTask.destroy?.().catch(() => undefined)
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
        setPageWindow({ start: 1, end: Math.min(doc.numPages, 1 + PAGE_WINDOW) })
        setNumPages(doc.numPages)
        setStatus('ready')

        // Outline/bookmarks drawer: loaded in the background after first paint.
        void (async () => {
          const outlineDoc = doc as unknown as OutlineDocumentLike
          if (typeof outlineDoc.getOutline !== 'function') {
            if (!cancelled && epoch === epochRef.current) setOutlineLoaded(true)
            return
          }
          try {
            const raw = await outlineDoc.getOutline()
            if (cancelled || epoch !== epochRef.current) return
            const entries = await buildOutlineEntries(outlineDoc, raw, 0, 'o', { left: OUTLINE_MAX_NODES })
            if (cancelled || epoch !== epochRef.current) return
            setOutline(entries)
            setOutlineExpanded(new Set(entries.map((entry) => entry.id)))
            setOutlineLoaded(true)
          } catch {
            if (!cancelled && epoch === epochRef.current) setOutlineLoaded(true)
          }
        })()

        // Placeholder boxes for pages with a different aspect ratio: fetch scale-1
        // viewports in small batches so scrollbar/extent stay stable. Cheap: reading
        // a viewport does not rasterise the page. For very large PDFs skip the
        // upfront sweep entirely; first-page geometry keeps the initial load fast.
        for (let start = 2; start <= (doc.numPages <= 80 ? doc.numPages : 1); start += 12) {
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
      if (findTimerRef.current !== null) {
        window.clearTimeout(findTimerRef.current)
        findTimerRef.current = null
      }
      linksLoadedRef.current.clear()
      textCacheRef.current.clear()
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
  const commitPage = useCallback((page: number) => {
    jumpGuardRef.current = { page, until: Date.now() + 1500 }
    currentPageRef.current = page
    setCurrentPage(page)
    setPageText(String(page))
    onPageChangeRef.current?.(page)
  }, [])

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
    // When the scrollbar jumps outside the DOM window there is no rendered
    // page to measure; find the page from the cumulative page offsets instead.
    if (bestPage < 1 || bestVisible <= 0) {
      const offsets = pageOffsetsRef.current
      const y = scroller.scrollTop + Math.min(scroller.clientHeight * 0.5, 220)
      if (offsets.length >= 2) {
        let low = 0
        let high = offsets.length - 2
        while (low <= high) {
          const mid = (low + high) >> 1
          if ((offsets[mid + 1] ?? 0) < y) low = mid + 1
          else if ((offsets[mid] ?? 0) > y) high = mid - 1
          else { bestPage = mid + 1; break }
        }
        if (bestPage < 1) bestPage = Math.max(1, Math.min(offsets.length - 1, low + 1))
      }
    }
    if (bestPage < 1) return
    const guard = jumpGuardRef.current
    if (guard !== null) {
      if (Date.now() < guard.until) bestPage = guard.page
      else jumpGuardRef.current = null
    }
    setPageWindow((current) => {
      if (bestPage >= current.start && bestPage <= current.end) return current
      const start = Math.max(1, bestPage - PAGE_WINDOW)
      const end = Math.min(numPages, bestPage + PAGE_WINDOW)
      return start === current.start && end === current.end ? current : { start, end }
    })
    if (bestPage === currentPageRef.current) return
    currentPageRef.current = bestPage
    setCurrentPage(bestPage)
    onPageChangeRef.current?.(bestPage)
  }, [numPages])

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
    const timer = releaseTimersRef.current.get(pageNumber)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      releaseTimersRef.current.delete(pageNumber)
    }
    view.wrap.dataset.rendered = 'false'
    view.token += 1
    try {
      view.renderTask?.cancel()
    } catch {
      // Render task already settled.
    }
    view.renderTask = undefined
    view.pendingKey = undefined
    view.renderedKey = undefined
    view.previewKey = undefined
    const upgrade = previewUpgradeTimersRef.current.get(pageNumber)
    if (upgrade !== undefined) {
      window.clearTimeout(upgrade)
      previewUpgradeTimersRef.current.delete(pageNumber)
    }
    // Do not zero a large canvas backing store synchronously here: releasing
    // several 2x page canvases at once was a major source of scrollbar-jump
    // long tasks. The canvas element is removed when its page leaves the
    // virtual window; until then the previous frame is harmlessly off-screen.
    view.textHost.replaceChildren()
  }, [])

  const scheduleRelease = useCallback((pageNumber: number) => {
    const existing = releaseTimersRef.current.get(pageNumber)
    if (existing !== undefined) return
    const timer = window.setTimeout(() => {
      releaseTimersRef.current.delete(pageNumber)
      // Keep the neighbouring pages warm for sequential reading.
      if (Math.abs(pageNumber - currentPageRef.current) <= 3) return
      if (!visibleRef.current.has(pageNumber)) releasePage(pageNumber)
    }, RELEASE_DELAY_MS)
    releaseTimersRef.current.set(pageNumber, timer)
  }, [releasePage])

  const beginResizeCooldown = useCallback((): void => {
    resizeCooldownRef.current = true
    if (resizeCooldownTimerRef.current !== null) window.clearTimeout(resizeCooldownTimerRef.current)
    resizeCooldownTimerRef.current = window.setTimeout(() => {
      resizeCooldownTimerRef.current = null
      resizeCooldownRef.current = false
      setQualityVersion((value) => value + 1)
    }, 900)
  }, [])

  const renderDpr = useCallback(
    (): number => (scrollingRef.current || windowResizingRef.current || resizeCooldownRef.current ? 1 : currentDpr()),
    [],
  )

  /** Load link annotations for one page once (normalised to the page box). */
  const loadPageLinks = useCallback(async (pageNumber: number, page: PdfPageLike, viewport: PdfViewportLike): Promise<void> => {
    if (linksLoadedRef.current.has(pageNumber)) return
    linksLoadedRef.current.add(pageNumber)
    const linkPage = page as unknown as LinkPageLike
    if (typeof linkPage.getAnnotations !== 'function') return
    try {
      const annotations = await linkPage.getAnnotations()
      if (!Array.isArray(annotations)) return
      const outlineDoc = docRef.current as unknown as OutlineDocumentLike | null
      const links: PageLink[] = []
      for (const annotation of annotations.slice(0, 400)) {
        if (annotation === null || typeof annotation !== 'object') continue
        const raw = annotation as Record<string, unknown>
        if (raw.subtype !== 'Link') continue
        const rect = Array.isArray(raw.rect) ? (raw.rect as number[]) : null
        if (rect === null) continue
        const url = typeof raw.url === 'string' && isSafeExternalUrl(raw.url) ? raw.url : null
        let target: number | null = null
        if (url === null && raw.dest !== undefined && outlineDoc !== null) {
          target = await resolveOutlineDest(outlineDoc, raw.dest)
        }
        if (url === null && target === null) continue
        const normalised = normaliseLinkRect(viewport as unknown as LinkViewportLike, rect)
        if (normalised === null) continue
        links.push({ id: `l-${pageNumber}-${links.length}`, rect: normalised, page: target, url })
        if (links.length >= LINK_MAX_PER_PAGE) break
      }
      if (links.length === 0) return
      setPageLinks((previous) => {
        const next = new Map(previous)
        next.set(pageNumber, links)
        return next
      })
    } catch {
      // Link annotations are optional.
    }
  }, [])

  const renderPage = useCallback(async (pageNumber: number, previewOnly = false): Promise<void> => {
    // A window/panel resize is in flight: do not start raster work until the
    // layout has settled. The resize idle effect re-renders visible pages.
    if (windowResizingRef.current) return
    const jumpPreview = jumpCooldownRef.current
    // During a scrollbar jump do not paint any page: the scroll offset moves
    // instantly, then the target page is painted only after the user actually
    // interacts again. This keeps release completely free of pdf.js raster work.
    if (jumpPreview) return
    // Only pages around the current reading position paint their content.
    // Far pages keep their reserved height but skip layout/paint entirely.
    if (Math.abs(pageNumber - currentPageRef.current) > 2) return
    const view = pagesRef.current.get(pageNumber)
    const doc = docRef.current
    const pdfjs = pdfjsRef.current
    if (view === undefined || doc === null || pdfjs === null) return

    const dpr = renderDpr()
    const key = renderKey(zoomRef.current, dpr)
    if (view.renderedKey === key || view.pendingKey === key) return
    if (previewOnly && view.previewKey === key) return

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
      const viewport = page.getViewport({ scale })
      const canvas = view.canvas

      // First paint a cheap preview so fast flips never sit on a blank sheet;
      // the full-resolution pass follows on idle/short delay.
      if (view.previewKey !== key) {
        try {
          const previewViewport = page.getViewport({ scale: scale * (jumpPreview ? 0.22 : 0.45) })
          canvas.width = Math.max(1, Math.round(previewViewport.width))
          canvas.height = Math.max(1, Math.round(previewViewport.height))
          canvas.style.width = `${viewport.width}px`
          canvas.style.height = `${viewport.height}px`
          const previewTask = page.render({
            canvas,
            viewport: previewViewport,
            transform: [1, 0, 0, 1, 0, 0],
            intent: 'display',
          })
          view.renderTask = previewTask
          recordRenderMode(view, previewTask)
          await previewTask.promise
          if (epoch !== epochRef.current || token !== view.token) return
          view.previewKey = key
          view.pendingKey = undefined
          view.wrap.dataset.rendered = 'true'
          if (previewOnly || jumpPreview) return
          const timer = window.setTimeout(() => {
            previewUpgradeTimersRef.current.delete(pageNumber)
            void renderPage(pageNumber)
          }, 100)
          previewUpgradeTimersRef.current.set(pageNumber, timer)
          return
        } catch {
          // Preview is optional; fall through to the full render.
        }
      }
      // Render the full page off-screen first. Resizing the visible canvas
      // clears it, which is exactly the white flash users see while a preview
      // is being upgraded. Copying only after the full raster is ready keeps
      // the preview (or the previous frame) visible the whole time.
      const fullCanvas = document.createElement('canvas')
      fullCanvas.width = Math.max(1, Math.round(viewport.width * dpr))
      fullCanvas.height = Math.max(1, Math.round(viewport.height * dpr))
      const task = page.render({
        canvas: fullCanvas,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
        intent: 'display',
      })
      view.renderTask = task
      recordRenderMode(view, task)
      await task.promise
      if (epoch !== epochRef.current || token !== view.token) return
      canvas.width = fullCanvas.width
      canvas.height = fullCanvas.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      canvas.getContext('2d')?.drawImage(fullCanvas, 0, 0)
      view.renderedKey = key
      view.previewKey = key
      view.renderTask = undefined
      view.wrap.dataset.rendered = 'true'
      void loadPageLinks(pageNumber, page, viewport)

      // Selectable text is useful but not on the raster critical path. Build it
      // on idle so scrolling starts as soon as the canvas is painted.
      const buildTextLayer = async (): Promise<void> => {
        if (epoch !== epochRef.current || token !== view.token) return
        // A fresh `.textLayer` container per render means a stale, cancelled
        // layer can only ever write into its own detached node.
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
          applyFindHighlights(view.wrap, findQueryRef.current, findActivePageRef.current)
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
      }
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => void buildTextLayer(), { timeout: 600 })
      } else {
        window.setTimeout(() => void buildTextLayer(), 0)
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
            const timer = releaseTimersRef.current.get(page)
            if (timer !== undefined) {
              window.clearTimeout(timer)
              releaseTimersRef.current.delete(page)
            }
            void renderPage(page)
          } else {
            visibleRef.current.delete(page)
            scheduleRelease(page)
          }
        }
        updateCurrentPage()
      },
      { root: scroller, rootMargin: RENDER_MARGIN, threshold: 0 },
    )
    for (const view of pagesRef.current.values()) observer.observe(view.wrap)
    return () => observer.disconnect()
  }, [status, numPages, attempt, pageWindow.start, pageWindow.end, renderPage, scheduleRelease, updateCurrentPage])

  /* ── continuous scroll: current page + dismiss floating tools ─────────── */
  useEffect(() => {
    const scroller = scrollerRef.current
    if (status !== 'ready' || scroller === null) return
    let frame = 0
    const onScroll = () => {
      scrollingRef.current = true
      if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current)
      scrollIdleTimerRef.current = window.setTimeout(() => {
        scrollIdleTimerRef.current = null
        scrollingRef.current = false
        // Warm pages rendered during scrolling at the readable resolution.
        setQualityVersion((value) => value + 1)
      }, 220)
      // While the scrollbar thumb is being dragged, moving the scroll offset
      // is cheap; recalculating page windows and re-rendering mid-drag is not.
      // Commit the page once on pointerup instead.
      if (scrollbarDraggingRef.current) return
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        updateCurrentPage()
      })
    }
    const leaveJumpPreview = (): void => {
      if (!jumpCooldownRef.current) return
      jumpCooldownRef.current = false
      setQualityVersion((value) => value + 1)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', leaveJumpPreview, { passive: true })
    scroller.addEventListener('pointerdown', leaveJumpPreview, { passive: true })
    updateCurrentPage()
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', leaveJumpPreview)
      scroller.removeEventListener('pointerdown', leaveJumpPreview)
      if (frame !== 0) cancelAnimationFrame(frame)
      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current)
        scrollIdleTimerRef.current = null
      }
      scrollingRef.current = false
      if (windowResizeTimerRef.current !== null) {
        window.clearTimeout(windowResizeTimerRef.current)
        windowResizeTimerRef.current = null
      }
      windowResizingRef.current = false
    }
  }, [status, updateCurrentPage])

  /* Window/panel resize: keep rasterising at 1x until resizing settles. A
     maximise can otherwise trigger several expensive 2x page renders in a
     row before the layout stabilises. */
  useEffect(() => {
    if (status !== 'ready') return
    const onResize = (): void => {
      windowResizingRef.current = true
      setResizingUi(true)
      if (windowResizeTimerRef.current !== null) window.clearTimeout(windowResizeTimerRef.current)
      windowResizeTimerRef.current = window.setTimeout(() => {
        windowResizeTimerRef.current = null
        windowResizingRef.current = false
        setResizingUi(false)
        beginResizeCooldown()
        setQualityVersion((value) => value + 1)
      }, 300)
    }
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (windowResizeTimerRef.current !== null) {
        window.clearTimeout(windowResizeTimerRef.current)
        windowResizeTimerRef.current = null
      }
      windowResizingRef.current = false
      setResizingUi(false)
      if (resizeCooldownTimerRef.current !== null) {
        window.clearTimeout(resizeCooldownTimerRef.current)
        resizeCooldownTimerRef.current = null
      }
      resizeCooldownRef.current = false
      if (jumpCooldownTimerRef.current !== null) {
        window.clearTimeout(jumpCooldownTimerRef.current)
        jumpCooldownTimerRef.current = null
      }
      jumpCooldownRef.current = false
    }
  }, [status, beginResizeCooldown, setResizingUi])

  /* Custom scrollbar: the native overlay scrollbar is tiny on macOS and hard
     to hit. A fixed-width rail with a minimum-size thumb is precise to drag. */
  const syncScrollbar = useCallback((): void => {
    if (scrollbarSyncFrameRef.current !== null) return
    scrollbarSyncFrameRef.current = window.requestAnimationFrame(() => {
      scrollbarSyncFrameRef.current = null
      if (scrollbarDraggingRef.current) return
      const scroller = scrollerRef.current
      const rail = scrollRailRef.current
      const thumb = scrollThumbRef.current
      if (scroller === null || rail === null || thumb === null) return
      const maxScroll = scroller.scrollHeight - scroller.clientHeight
      if (maxScroll <= 1) {
        rail.dataset.empty = 'true'
        return
      }
      rail.dataset.empty = 'false'
      const trackHeight = rail.clientHeight
      const height = Math.max(48, Math.min(trackHeight, (scroller.clientHeight / scroller.scrollHeight) * trackHeight))
      thumb.style.height = `${height}px`
      const y = (scroller.scrollTop / maxScroll) * Math.max(0, trackHeight - height)
      thumb.style.transform = `translateY(${y}px)`
    })
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    const scroller = scrollerRef.current
    if (scroller === null) return
    const sync = (): void => syncScrollbar()
    scroller.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(scroller)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      scroller.removeEventListener('scroll', sync)
      observer.disconnect()
      window.removeEventListener('resize', sync)
      if (scrollbarSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollbarSyncFrameRef.current)
        scrollbarSyncFrameRef.current = null
      }
    }
  }, [status, syncScrollbar, pageWindow.start, pageWindow.end, pageSizes, zoom])

  const beginScrollbarDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const scroller = scrollerRef.current
    const rail = scrollRailRef.current
    const thumb = scrollThumbRef.current
    if (scroller === null || rail === null || thumb === null) return
    const maxScroll = scroller.scrollHeight - scroller.clientHeight
    if (maxScroll <= 1) return
    // A new grab cancels the previous release's deferred page paint so it can
    // never start rasterising in the middle of the next drag.
    if (jumpCooldownTimerRef.current !== null) {
      window.clearTimeout(jumpCooldownTimerRef.current)
      jumpCooldownTimerRef.current = null
    }
    jumpCooldownRef.current = true
    event.preventDefault()
    const railRect = rail.getBoundingClientRect()
    const thumbRect = thumb.getBoundingClientRect()
    const thumbHeight = thumbRect.height
    const trackHeight = Math.max(1, railRect.height - thumbHeight)
    const target = event.target as Element
    const draggingThumb = target.closest('.pdv-scrollThumb') !== null
    const pointerOffset = event.clientY - thumbRect.top
    let targetScroll = scroller.scrollTop
    const ghost = scrollGhostRef.current

    const positionThumb = (desiredTop: number): void => {
      const top = Math.min(trackHeight, Math.max(0, desiredTop))
      thumb.style.transform = `translateY(${top}px)`
      const ratio = top / trackHeight
      targetScroll = ratio * maxScroll
      if (ghost !== null) {
        ghost.textContent = `${Math.max(1, Math.min(numPages, Math.round(ratio * Math.max(0, numPages - 1)) + 1))} / ${numPages}`
        ghost.style.top = `${top + thumbHeight / 2}px`
      }
    }

    if (draggingThumb) {
      positionThumb(thumbRect.top - railRect.top)
    } else {
      // Track click: centre the thumb on the click, but do not touch the PDF
      // scroll offset yet. Dragging a huge PDF stays a pure thumb animation.
      positionThumb(event.clientY - railRect.top - thumbHeight / 2)
    }

    rail.dataset.dragging = 'true'
    scrollbarDraggingRef.current = true
    const startY = event.clientY
    const startTop = draggingThumb ? thumbRect.top - railRect.top : parseFloat(thumb.style.transform.replace(/[^0-9.-]/g, '')) || 0

    const onMove = (moveEvent: PointerEvent): void => {
      if (draggingThumb) positionThumb(startTop + moveEvent.clientY - startY)
      else positionThumb(moveEvent.clientY - railRect.top - thumbHeight / 2)
    }
    const finish = (apply: boolean): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      delete rail.dataset.dragging
      scrollbarDraggingRef.current = false
      if (!apply) {
        syncScrollbar()
        return
      }
      // Commit once on release: no per-frame PDF relayout or page rendering.
      // The jump itself is also expensive on big PDFs, so keep it preview-only
      // until the target pages have settled.
      jumpCooldownRef.current = true
      if (jumpCooldownTimerRef.current !== null) window.clearTimeout(jumpCooldownTimerRef.current)
      // Let the thumb release finish without any pdf.js work. The target page
      // then paints once the interaction has fully settled.
      jumpCooldownTimerRef.current = window.setTimeout(() => {
        jumpCooldownTimerRef.current = null
        jumpCooldownRef.current = false
        setQualityVersion((value) => value + 1)
      }, 600)
      scroller.scrollTop = Math.min(maxScroll, Math.max(0, targetScroll))
      updateCurrentPage()
      syncScrollbar()
    }
    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /* After scrolling stops, re-rasterise visible pages at full DPR while the
     low-resolution versions stay visible until each replacement is ready. */
  useEffect(() => {
    if (status !== 'ready' || scrollingRef.current) return
    const key = renderKey(zoomRef.current, currentDpr())
    for (const page of visibleRef.current) {
      const view = pagesRef.current.get(page)
      if (view === undefined || view.renderedKey === key || view.pendingKey === key) continue
      view.token += 1
      try { view.renderTask?.cancel() } catch {}
      view.renderTask = undefined
      view.pendingKey = undefined
      view.renderedKey = undefined
      // Keep the current canvas visible; renderPage will upgrade off-screen.
      view.previewKey = key
      void renderPage(page)
    }
  }, [qualityVersion, status, renderPage])

  /* Warm the next/previous page while the reader is idle, so fast sequential
     flips usually find a ready canvas instead of a blank page. */
  useEffect(() => {
    if (status !== 'ready' || currentPage < 1) return
    let cancelled = false
    // Start the next page as soon as the current one becomes current. Waiting
    // for requestIdleCallback often loses the race with fast page-by-page
    // reading, leaving the next page on its loading placeholder.
    const warm = (): void => {
      if (cancelled) return
      const key = renderKey(zoomRef.current, renderDpr())
      for (const page of [currentPage + 1, currentPage - 1]) {
        if (page < 1 || page > numPages) continue
        const view = pagesRef.current.get(page)
        if (view === undefined || view.renderedKey === key || view.pendingKey === key) continue
        // Neighbour pages only need the cheap preview; full quality is rendered
        // when they actually become visible/current.
        void renderPage(page, true)
      }
    }
    const immediate = window.setTimeout(warm, 20)
    const second = window.setTimeout(() => {
      if (cancelled) return
      const page = currentPage + 2
      if (page > numPages) return
      const view = pagesRef.current.get(page)
      const key = renderKey(zoomRef.current, renderDpr())
      if (view !== undefined && view.renderedKey !== key && view.pendingKey !== key) void renderPage(page, true)
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(immediate)
      window.clearTimeout(second)
    }
  }, [status, currentPage, numPages, renderPage, renderDpr])

  /* ── re-render visible pages when zoom changes; free far pages ────────── */
  useEffect(() => {
    if (status !== 'ready') return
    const key = renderKey(zoom, renderDpr())
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
        view.wrap.dataset.rendered = 'false'
        view.textHost.replaceChildren()
      } else {
        releasePage(page)
      }
    }
    for (const page of visibleRef.current) void renderPage(page)
  }, [zoom, status, renderPage, releasePage, renderDpr])

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
      const width = scroller.clientWidth
      const previousWidth = observedWidthRef.current
      observedWidthRef.current = width
      if (previousWidth === 0 || Math.abs(width - previousWidth) < 1) return
      // Hold rasterisation until the pane width stops changing; the PDF keeps
      // the previous canvas stretched in the meantime instead of freezing.
      windowResizingRef.current = true
      if (windowResizeTimerRef.current !== null) window.clearTimeout(windowResizeTimerRef.current)
      windowResizeTimerRef.current = window.setTimeout(() => {
        windowResizeTimerRef.current = null
        windowResizingRef.current = false
        beginResizeCooldown()
        setQualityVersion((value) => value + 1)
      }, 300)
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        applyZoom(computeFitZoom(pageSizesRef.current), true)
      }, 220)
    })
    observer.observe(scroller)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
    }
  }, [status, applyZoom, computeFitZoom, beginResizeCooldown, setResizingUi])

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
    if (page < pageWindow.start || page > pageWindow.end) {
      setPageWindow({
        start: Math.max(1, page - PAGE_WINDOW),
        end: Math.min(numPages, page + PAGE_WINDOW),
      })
      pendingScrollPageRef.current = page
      return
    }
    const scroller = scrollerRef.current
    const view = pagesRef.current.get(page)
    if (scroller === null || view === undefined) return
    void renderPage(page)
    scrollPageIntoView(scroller, view.pageEl, 'start', 'auto')
    commitPage(page)
  }, [focusPage, focusNonce, status, numPages, pageWindow.start, pageWindow.end, renderPage, commitPage])

  /* Scroll to a page that was outside the virtual window once its DOM exists. */
  useEffect(() => {
    const target = pendingScrollPageRef.current
    if (target === null || status !== 'ready') return
    const scroller = scrollerRef.current
    const view = pagesRef.current.get(target)
    if (scroller === null || view === undefined) return
    pendingScrollPageRef.current = null
    void renderPage(target)
    scrollPageIntoView(scroller, view.pageEl, 'start', 'auto')
    commitPage(target)
  }, [pageWindow.start, pageWindow.end, status, renderPage, commitPage])

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
  const captureSelection = useCallback((): SelectionState | null => {
    const root = rootRef.current
    if (root === null) return null
    const domSelection = window.getSelection()
    if (domSelection === null || domSelection.rangeCount === 0 || domSelection.isCollapsed) return null
    const range = domSelection.getRangeAt(0)
    const startNode = range.startContainer
    const startElement = startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement
    const textLayer = startElement?.closest?.('.textLayer') ?? null
    if (!(textLayer instanceof HTMLElement) || !root.contains(textLayer)) return null
    const page = Number(textLayer.dataset.pdvPage)
    if (!Number.isFinite(page)) return null
    const view = pagesRef.current.get(page)
    if (view === undefined) return null
    const pageRect = view.pageEl.getBoundingClientRect()
    if (pageRect.width <= 0 || pageRect.height <= 0) return null
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
    if (rects.length === 0 || anchorRect === null) return null
    const quote = normaliseQuote(domSelection.toString())
    if (quote.length === 0) return null

    const rootWidth = rootRect.width
    const centerX = anchorRect.left + anchorRect.width / 2 - rootRect.left
    const selTop = anchorRect.top - rootRect.top
    const selBottom = anchorRect.bottom - rootRect.top
    const half = Math.min(200, Math.max(60, rootWidth / 2 - 8))
    const askHalf = Math.min(140, Math.max(60, rootWidth / 2 - 8))
    const toolbarAbove = selTop >= 56
    const askAbove = selTop >= 190
    const state: SelectionState = {
      page,
      rects,
      quote,
      x: clamp(centerX, half + 4, Math.max(half + 4, rootWidth - half - 4)),
      y: toolbarAbove ? selTop - 8 : selBottom + 8,
      below: !toolbarAbove,
      askX: clamp(centerX, askHalf + 4, Math.max(askHalf + 4, rootWidth - askHalf - 4)),
      askY: askAbove ? selTop - 8 : selBottom + 12,
      askBelow: !askAbove,
    }
    setSelection(state)
    setAskOpen(false)
    setQuestion('')
    setCopied(false)
    return state
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
      for (const timer of releaseTimersRef.current.values()) window.clearTimeout(timer)
      releaseTimersRef.current.clear()
      for (const timer of previewUpgradeTimersRef.current.values()) window.clearTimeout(timer)
      previewUpgradeTimersRef.current.clear()
    }
  }, [])

  const handleRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('.textLayer') !== null) {
      lastTextPointRef.current = { x: event.clientX, y: event.clientY }
    }
    if (target instanceof Element && target.closest('.pdv-selbar, .pdv-ask') !== null) return
    if (selection !== null || askOpen) dismissSelection(false)
  }

  /* ── toolbar / selection actions ──────────────────────────────────────── */
  const goToPage = (value: number) => {
    const target = clamp(Math.round(value), 1, Math.max(1, numPages))
    if (target < pageWindow.start || target > pageWindow.end) {
      setPageWindow({
        start: Math.max(1, target - PAGE_WINDOW),
        end: Math.min(numPages, target + PAGE_WINDOW),
      })
      pendingScrollPageRef.current = target
      setPageText(String(target))
      return
    }
    const scroller = scrollerRef.current
    const view = pagesRef.current.get(target)
    // Start the target raster before the smooth scroll arrives; the loading
    // placeholder covers the remaining gap instead of showing a blank sheet.
    void renderPage(target)
    if (scroller !== null && view !== undefined) scrollPageIntoView(scroller, view.pageEl, 'start', 'auto')
    commitPage(target)
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

  const createFromSelection = async (
    state: SelectionState,
    kind: AnnotationKind,
    color?: AnnotationColor,
  ): Promise<void> => {
    if (busy) return
    const payload: PdfSelectionPayload & { kind: AnnotationKind; comment?: string; color?: AnnotationColor } = {
      page: state.page,
      rects: state.rects,
      quote: state.quote,
      kind,
    }
    if (kind === 'note') payload.comment = ''
    if (kind === 'highlight' || kind === 'underline') payload.color = color ?? highlightColor
    setBusy(true)
    try {
      await onCreateRef.current(payload)
    } catch {
      // The parent owns error reporting/toasts.
    }
    setBusy(false)
    dismissSelection(true)
  }

  const runCreate = async (kind: AnnotationKind, color?: AnnotationColor) => {
    if (selection === null) return
    if (color !== undefined) setHighlightColor(color)
    await createFromSelection(selection, kind, color)
  }

  const addSelectionToAi = async (): Promise<void> => {
    if (selection === null) return
    const handler = onAddToAiRef.current
    if (handler === undefined) return
    setBusy(true)
    try {
      await handler({ page: selection.page, rects: selection.rects, quote: selection.quote })
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

  /* ── find in document ─────────────────────────────────────────────────── */
  const closeFind = (): void => {
    setFindOpen(false)
    setFindQuery('')
    setFindMatches([])
    setFindIndex(0)
    findQueryRef.current = ''
    const root = rootRef.current
    if (root !== null) applyFindHighlights(root, '', null)
  }

  const runFind = (raw: string): void => {
    setFindQuery(raw)
    if (findTimerRef.current !== null) {
      window.clearTimeout(findTimerRef.current)
      findTimerRef.current = null
    }
    const query = raw.trim()
    if (query.length === 0) {
      setFindMatches([])
      setFindIndex(0)
      setFindBusy(false)
      const root = rootRef.current
      if (root !== null) applyFindHighlights(root, '', null)
      return
    }
    setFindBusy(true)
    const epoch = epochRef.current
    findTimerRef.current = window.setTimeout(() => {
      findTimerRef.current = null
      const doc = docRef.current
      if (doc === null || epoch !== epochRef.current) {
        setFindBusy(false)
        return
      }
      void findPages(doc, query, () => epoch !== epochRef.current, textCacheRef.current)
        .then((matches) => {
          if (epoch !== epochRef.current) return
          setFindMatches(matches)
          setFindIndex(0)
          setFindBusy(false)
          const first = matches[0]
          if (first !== undefined) goToPage(first.page)
        })
        .catch(() => {
          if (epoch === epochRef.current) setFindBusy(false)
        })
    }, FIND_DEBOUNCE_MS)
  }

  const stepFind = (delta: number): void => {
    if (findMatches.length === 0) return
    const next = (findIndex + delta + findMatches.length) % findMatches.length
    setFindIndex(next)
    const match = findMatches[next]
    if (match !== undefined) goToPage(match.page)
  }

  /* ── outline drawer ───────────────────────────────────────────────────── */
  const activateOutline = (entry: OutlineEntry): void => {
    if (entry.page !== null) goToPage(entry.page)
    else if (entry.url !== null) openExternalUrl(entry.url)
  }

  const toggleOutlineEntry = (id: string): void => {
    setOutlineExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const outlineRows = (entries: readonly OutlineEntry[]): ReactElement[] =>
    entries.flatMap((entry) => {
      const expanded = outlineExpanded.has(entry.id)
      const rows: ReactElement[] = [
        <div key={entry.id} className="pdv-outlineRowWrap" style={{ paddingLeft: `${entry.depth * 12}px` }}>
          {entry.children.length > 0 ? (
            <button
              type="button"
              className="pdv-outlineToggle"
              aria-label={entry.title}
              aria-expanded={expanded}
              onClick={() => toggleOutlineEntry(entry.id)}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="pdv-outlineToggle" aria-hidden="true" />
          )}
          <button
            type="button"
            className="pdv-outlineRow"
            data-active={entry.page !== null && entry.page === currentPage ? 'true' : undefined}
            title={entry.title}
            onClick={() => activateOutline(entry)}
          >
            <span className="pdv-outlineTitle">{entry.title}</span>
          </button>
        </div>,
      ]
      if (entry.children.length > 0 && expanded) rows.push(...outlineRows(entry.children))
      return rows
    })

  /* ── hand / pan ───────────────────────────────────────────────────────── */
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!handActiveRef.current || event.button !== 0) return
    const scroller = scrollerRef.current
    if (scroller === null) return
    event.preventDefault()
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
    }
    setPanning(true)
    try {
      scroller.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort.
    }
    if (selection !== null || askOpen) dismissSelection(false)
  }

  const movePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    const scroller = scrollerRef.current
    if (pan === null || scroller === null || pan.pointerId !== event.pointerId) return
    event.preventDefault()
    scroller.scrollLeft = pan.left - (event.clientX - pan.x)
    scroller.scrollTop = pan.top - (event.clientY - pan.y)
  }

  const endPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    const scroller = scrollerRef.current
    if (pan === null || scroller === null) return
    try {
      scroller.releasePointerCapture(pan.pointerId)
    } catch {
      // Already released.
    }
    panRef.current = null
    setPanning(false)
    void event
  }

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(PAPER_TONE_STORAGE, paperTone)
    } catch {
      // Preference persistence is optional.
    }
  }, [paperTone])

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(HIGHLIGHT_COLOR_STORAGE, highlightColor)
    } catch {
      // Preference persistence is optional.
    }
  }, [highlightColor])

  /* Cmd/Ctrl+F opens the find bar while the document is ready. */
  useEffect(() => {
    if (status !== 'ready') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      setFindOpen(true)
      window.requestAnimationFrame(() => {
        findInputRef.current?.focus()
        findInputRef.current?.select()
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [status])

  /* Escape closes the outline drawer. */
  useEffect(() => {
    if (!outlineOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOutlineOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [outlineOpen])

  /* Escape closes the find bar (the selection toolbar takes precedence). */
  useEffect(() => {
    if (!findOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeFind()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen])

  /* Hold Space to temporarily pan, like a desktop PDF reader. */
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]') !== null
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat || isEditable(event.target)) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    const onBlur = (): void => setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  /* Re-apply find highlights whenever matches or mounted pages change. */
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    applyFindHighlights(root, findQuery, findActivePageRef.current)
  }, [findQuery, findMatches, findIndex, pageWindow.start, pageWindow.end, lowTextPages])

  /* ── keyboard navigation / visual selection ───────────────────────────── */
  const beginVisualSelection = useCallback((): void => {
    const root = rootRef.current
    if (root === null) return
    const dom = window.getSelection()
    const existing = dom !== null && dom.rangeCount > 0 ? dom.getRangeAt(0) : null
    if (existing === null || existing.collapsed || !root.contains(existing.startContainer)) {
      let range: Range | null = null
      const point = lastTextPointRef.current
      const rootRect = root.getBoundingClientRect()
      // Prefer the reader's last click; otherwise start near the middle of the
      // visible page, not at the very first character on the page.
      const docWithCaret = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      }
      if (point !== null && rootRect.left <= point.x && point.x <= rootRect.right && rootRect.top <= point.y && point.y <= rootRect.bottom) {
        if (typeof docWithCaret.caretRangeFromPoint === 'function') {
          range = docWithCaret.caretRangeFromPoint(point.x, point.y)
        } else if (typeof docWithCaret.caretPositionFromPoint === 'function') {
          const position = docWithCaret.caretPositionFromPoint(point.x, point.y)
          if (position !== null) {
            range = document.createRange()
            range.setStart(position.offsetNode, position.offset)
            range.collapse(true)
          }
        }
      }
      if (range === null) {
        const centerX = rootRect.left + rootRect.width / 2
        const centerY = rootRect.top + rootRect.height / 2
        const target = document.elementFromPoint(centerX, centerY)
        const span =
          (target instanceof Element ? target.closest<HTMLElement>('.textLayer span') : null) ??
          pagesRef.current.get(currentPageRef.current)?.textHost.querySelector<HTMLElement>('.textLayer span') ??
          null
        if (span !== null) {
          range = document.createRange()
          range.selectNodeContents(span)
          range.collapse(true)
        }
      }
      if (range !== null) {
        dom?.removeAllRanges()
        dom?.addRange(range)
      }
    }
    setVisualMode(true)
    root.focus()
  }, [])

  const extendVisualSelection = useCallback((granularity: 'character' | 'word' | 'line', direction: 'forward' | 'backward'): void => {
    let dom = window.getSelection()
    if (dom === null || dom.rangeCount === 0) {
      beginVisualSelection()
      dom = window.getSelection()
    }
    const modify = (dom as unknown as { modify?: (alter: string, direction: string, granularity: string) => void } | null)?.modify
    if (dom === null || typeof modify !== 'function') return
    try {
      modify.call(dom, 'extend', direction, granularity)
    } catch {
      // Selection.modify is best-effort across browser versions.
    }
  }, [beginVisualSelection])

  const stopVisualMode = useCallback((clearNative: boolean): void => {
    setVisualMode(false)
    if (clearNative) {
      const dom = window.getSelection()
      if (dom !== null && dom.rangeCount > 0) dom.removeAllRanges()
    }
  }, [])

  const swapVisualSelection = useCallback((): void => {
    const dom = window.getSelection()
    if (dom === null || dom.rangeCount === 0 || dom.isCollapsed) return
    const anchorNode = dom.anchorNode
    const focusNode = dom.focusNode
    if (anchorNode === null || focusNode === null) return
    try {
      dom.setBaseAndExtent(focusNode, dom.focusOffset, anchorNode, dom.anchorOffset)
    } catch {
      // Ignore browsers that reject the swap.
    }
  }, [])

  const highlightVisualSelection = useCallback((): void => {
    const state = captureSelection()
    setVisualMode(false)
    if (state === null) return
    void createFromSelection(state, 'highlight')
  }, [captureSelection, createFromSelection])

  const copyVisualSelection = useCallback(async (): Promise<void> => {
    const text = window.getSelection()?.toString() ?? ''
    if (text.trim() === '') return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard may be unavailable; the toolbar copy still exists.
    }
  }, [])

  const scrollViewer = useCallback((fraction: number): void => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    // j/k are one text line (roughly 1em of the PDF); Ctrl+d/u are half a
    // viewport. Keep the two separate — using >= 0.49 for the half-page test
    // made j scroll half a screen as well.
    const halfPage = Math.abs(fraction) === 0.5
    const lineHeight = Math.max(24, Math.min(40, scroller.clientHeight * 0.045))
    const amount = halfPage ? scroller.clientHeight * 0.5 : lineHeight
    scroller.scrollBy({ top: fraction >= 0 ? amount : -amount, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (root === null || status !== 'ready') return
    const handler = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === 'Escape') {
        if (showHelp) {
          event.preventDefault()
          setShowHelp(false)
          return
        }
        if (visualModeRef.current) {
          event.preventDefault()
          stopVisualMode(true)
          return
        }
        return
      }
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null) return
      if (root.offsetParent === null) return
      const map = keymapRef.current
      const hit = (action: KeyAction): boolean => matchesBinding(event, map[action])
      const fire = (action: KeyAction, run: () => void): void => {
        if (!hit(action)) return
        event.preventDefault()
        event.stopPropagation()
        run()
      }

      if (showHelp) {
        fire('help', () => setShowHelp(false))
        return
      }
      if (visualModeRef.current) {
        let handled = true
        if (hit('selectLeft')) extendVisualSelection('character', 'backward')
        else if (hit('selectRight')) extendVisualSelection('character', 'forward')
        else if (hit('selectLineUp')) extendVisualSelection('line', 'backward')
        else if (hit('selectLineDown')) extendVisualSelection('line', 'forward')
        else if (hit('selectWordBackward')) extendVisualSelection('word', 'backward')
        else if (hit('selectWordForward')) extendVisualSelection('word', 'forward')
        else if (hit('swapSelection')) swapVisualSelection()
        else if (hit('highlightSelection')) highlightVisualSelection()
        else if (hit('copySelection')) void copyVisualSelection()
        else if (hit('visualMode')) stopVisualMode(true)
        else handled = false
        if (handled) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      fire('scrollDown', () => scrollViewer(1))
      fire('scrollUp', () => scrollViewer(-1))
      fire('halfPageDown', () => scrollViewer(0.5))
      fire('halfPageUp', () => scrollViewer(-0.5))
      fire('pageNext', () => goToPage(currentPageRef.current + 1))
      fire('pagePrev', () => goToPage(currentPageRef.current - 1))
      fire('firstPage', () => goToPage(1))
      fire('lastPage', () => goToPage(numPages))
      fire('zoomIn', () => applyZoom(zoomRef.current * 1.15, true))
      fire('zoomOut', () => applyZoom(zoomRef.current / 1.15, true))
      fire('zoomReset', chooseActualSize)
      fire('visualMode', beginVisualSelection)
      fire('highlightSelection', highlightVisualSelection)
      fire('copySelection', () => void copyVisualSelection())
      fire('help', () => setShowHelp(true))
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [
    status,
    showHelp,
    numPages,
    goToPage,
    applyZoom,
    chooseActualSize,
    extendVisualSelection,
    highlightVisualSelection,
    copyVisualSelection,
    scrollViewer,
    beginVisualSelection,
    stopVisualMode,
    swapVisualSelection,
  ])

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

  const pageLayout = useMemo(() => {
    const offsets: number[] = [0]
    let total = 0
    const scale = zoom * CSS_UNITS
    for (const size of pageSizes) {
      total += 18 + size.height * scale
      offsets.push(total)
    }
    return { offsets, total }
  }, [pageSizes, zoom])

  useEffect(() => {
    pageOffsetsRef.current = pageLayout.offsets
  }, [pageLayout.offsets])

  // Page sizes arrive in batches while the document loads. If an earlier page
  // turns out to be taller/shorter, the content below shifts and the scrollbar
  // visibly jumps. Compensate before paint so the current page stays put.
  const anchorLayoutRef = useRef(pageLayout)
  const anchorZoomRef = useRef(zoom)
  useLayoutEffect(() => {
    const previous = anchorLayoutRef.current
    anchorLayoutRef.current = pageLayout
    if (anchorZoomRef.current !== zoom) {
      anchorZoomRef.current = zoom
      return
    }
    const page = currentPageRef.current
    if (page < 1) return
    const before = previous.offsets[page - 1] ?? 0
    const after = pageLayout.offsets[page - 1] ?? 0
    const delta = after - before
    if (delta === 0) return
    const scroller = scrollerRef.current
    if (scroller !== null) scroller.scrollTop += delta
  }, [pageLayout, zoom])

  /* Drop page DOM/refs that fall outside the virtual window. */
  useEffect(() => {
    for (const [page, view] of pagesRef.current) {
      if (page < pageWindow.start || page > pageWindow.end) {
        releasePage(page)
        pagesRef.current.delete(page)
        visibleRef.current.delete(page)
      }
    }
  }, [pageWindow.start, pageWindow.end, releasePage])

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
    <div
      className="pdv-root"
      ref={rootRef}
      data-paper={paperTone}
      data-hand={handActive ? 'true' : 'false'}
      data-panning={panning ? 'true' : 'false'}
      onPointerDown={handleRootPointerDown}
    >
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
        <button
          type="button"
          className="pdv-btn"
          aria-label={uiLabel(labels, 'outline')}
          title={uiLabel(labels, 'outline')}
          aria-pressed={outlineOpen}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <ToolbarIcon name="outline" />
        </button>
        <button
          type="button"
          className="pdv-btn"
          aria-label={uiLabel(labels, 'find')}
          title={uiLabel(labels, 'find')}
          aria-pressed={findOpen}
          onClick={() => {
            setFindOpen(true)
            window.requestAnimationFrame(() => findInputRef.current?.focus())
          }}
        >
          <ToolbarIcon name="find" />
        </button>
        <button
          type="button"
          className="pdv-btn"
          aria-label={uiLabel(labels, 'hand')}
          title={uiLabel(labels, 'hand')}
          aria-pressed={handMode}
          onClick={() => setHandMode((enabled) => !enabled)}
        >
          <ToolbarIcon name="hand" />
        </button>
        <button
          type="button"
          className="pdv-btn"
          aria-label={paperTone === 'dark' ? uiLabel(labels, 'lightPaper') : uiLabel(labels, 'darkPaper')}
          title={paperTone === 'dark' ? uiLabel(labels, 'lightPaper') : uiLabel(labels, 'darkPaper')}
          aria-pressed={paperTone === 'dark'}
          onClick={() => setPaperTone((tone) => (tone === 'dark' ? 'light' : 'dark'))}
        >
          <ToolbarIcon name={paperTone === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>

      {lowTextHint !== undefined && lowTextHint.length > 0 ? (
        <div className="pdv-docHint" role="status">
          {lowTextHint}
        </div>
      ) : null}

      {visualMode ? (
        <div className="pdv-vim-hud" role="status">
          <strong>{labels.visualMode}</strong>
          <span>{labels.visualHint}</span>
        </div>
      ) : null}

      {showHelp ? (
        <div className="pdv-vim-help" role="dialog" aria-label={labels.shortcuts}>
          <div className="pdv-vim-help-head">
            <strong>{labels.shortcuts}</strong>
            <button type="button" onClick={() => setShowHelp(false)} aria-label={labels.close} title={labels.close}>
              ×
            </button>
          </div>
          <div className="pdv-vim-help-hint">{labels.shortcutsHint}</div>
          <dl>
            {KEY_ACTIONS.map((action) => (
              <div key={action} className="pdv-vim-help-row">
                <dt>{labels.keymapLabels[action]}</dt>
                <dd><kbd>{keymap[action]}</kbd></dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <div className="pdv-scrollWrap">
      <div
        className="pdv-scroll"
        ref={scrollerRef}
        onMouseUp={handleSelectionEnd}
        onKeyUp={handleSelectionEnd}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div className="pdv-pages">
          {pageWindow.start > 1 ? (
            <div
              className="pdv-spacer"
              style={{ height: `${pageLayout.offsets[pageWindow.start - 1] ?? 0}px` }}
              aria-hidden="true"
            />
          ) : null}
          {pageSizes.slice(pageWindow.start - 1, pageWindow.end).map((size, index) => {
            const page = pageWindow.start + index
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
              <div
                className="pdv-pageWrap"
                key={page}
                data-pdv-page={page}
                data-near={Math.abs(page - currentPage) <= 2 ? 'true' : undefined}
                ref={registerPage}
                style={{ height: `${size.height * viewportScale + 18}px` }}
              >
                <div className="pdv-page" style={pageStyle}>
                  <div className="pdv-pageLoading" aria-hidden="true">
                    <span className="pdv-pageLoadingSpin" />
                    <span>{page}</span>
                  </div>
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
                  <div className="pdv-linkLayer">
                    {(pageLinks.get(page) ?? []).map((link) => (
                      <button
                        key={link.id}
                        type="button"
                        className="pdv-link"
                        data-pdv-link={link.url ?? link.page ?? ''}
                        style={{
                          left: `${link.rect.x * 100}%`,
                          top: `${link.rect.y * 100}%`,
                          width: `${link.rect.w * 100}%`,
                          height: `${link.rect.h * 100}%`,
                        } as CSSProperties}
                        aria-label={link.url ?? `${labels.page} ${link.page ?? ''}`}
                        title={link.url ?? `${labels.page} ${link.page ?? ''}`}
                        onClick={() => {
                          if (link.url !== null) openExternalUrl(link.url)
                          else if (link.page !== null) goToPage(link.page)
                        }}
                      />
                    ))}
                  </div>
                  {lowText ? <div className="pdv-lowText">{labels.textLayerUnavailable}</div> : null}
                </div>
              </div>
            )
          })}
          {pageWindow.end < pageSizes.length ? (
            <div
              className="pdv-spacer"
              style={{ height: `${pageLayout.total - (pageLayout.offsets[pageWindow.end] ?? pageLayout.total)}px` }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
      <div
        className="pdv-scrollRail"
        ref={scrollRailRef}
        data-empty="true"
        onPointerDown={beginScrollbarDrag}
        role="scrollbar"
        aria-orientation="vertical"
        aria-label={labels.page}
      >
        <div className="pdv-scrollThumb" ref={scrollThumbRef} />
        <div className="pdv-scrollGhost" ref={scrollGhostRef} aria-hidden="true" />
      </div>

      {outlineOpen ? (
        <aside className="pdv-outline" aria-label={uiLabel(labels, 'outline')}>
          <div className="pdv-outlineHead">
            <span>{uiLabel(labels, 'outline')}</span>
            <button type="button" aria-label={labels.close} title={labels.close} onClick={() => setOutlineOpen(false)}>
              ×
            </button>
          </div>
          <div className="pdv-outlineBody">
            {outline.length > 0
              ? outlineRows(outline)
              : outlineLoaded
                ? <div className="pdv-outlineEmpty">{uiLabel(labels, 'noOutline')}</div>
                : null}
          </div>
        </aside>
      ) : null}

      {findOpen ? (
        <div className="pdv-findbar" role="search">
          <input
            ref={findInputRef}
            className="pdv-findInput"
            aria-label={uiLabel(labels, 'findPlaceholder')}
            placeholder={uiLabel(labels, 'findPlaceholder')}
            value={findQuery}
            onChange={(event) => runFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                stepFind(event.shiftKey ? -1 : 1)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                closeFind()
              }
            }}
          />
          <span className="pdv-findCount" aria-live="polite">
            {findBusy
              ? '…'
              : findMatches.length === 0
                ? findQuery.trim().length === 0 ? '' : uiLabel(labels, 'findNoResults')
                : `${findIndex + 1}/${findMatches.length}`}
          </span>
          <button
            type="button"
            aria-label={uiLabel(labels, 'findPrev')}
            title={uiLabel(labels, 'findPrev')}
            disabled={findMatches.length === 0}
            onClick={() => stepFind(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={uiLabel(labels, 'findNext')}
            title={uiLabel(labels, 'findNext')}
            disabled={findMatches.length === 0}
            onClick={() => stepFind(1)}
          >
            ↓
          </button>
          <button type="button" aria-label={labels.close} title={labels.close} onClick={closeFind}>
            ×
          </button>
        </div>
      ) : null}
      </div>

      {selection !== null && !askOpen ? (
        <div
          className={`pdv-selbar${selection.below ? ' pdv-below' : ''}`}
          style={{ left: `${selection.x}px`, top: `${selection.y}px` }}
          role="toolbar"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="pdv-selColors" role="group" aria-label={labels.highlight}>
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="pdv-selColor"
                style={{ '--pdv-swatch': annotationColor(color) } as CSSProperties}
                aria-label={`${labels.highlight} ${color}`}
                title={`${labels.highlight} ${color}`}
                aria-pressed={highlightColor === color}
                disabled={busy}
                onClick={() => {
                  void runCreate('highlight', color)
                }}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label={labels.highlight}
            disabled={busy}
            onClick={() => {
              void runCreate('highlight', highlightColor)
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
          {props.onAddToAi !== undefined ? (
            <button
              type="button"
              className="pdv-selAi"
              aria-label={uiLabel(labels, 'addToAi')}
              title={uiLabel(labels, 'addToAi')}
              disabled={busy}
              onClick={() => {
                void addSelectionToAi()
              }}
            >
              <ToolbarIcon name="ai" />
              {uiLabel(labels, 'addToAi')}
            </button>
          ) : null}
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
