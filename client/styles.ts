/**
 * PaperDesk panel stylesheet.
 *
 * Rules (DESIGN §5.4/§5.5):
 * - only host theme tokens + `color-mix()`; no literal palette colors,
 * - every class is prefixed `pd-`,
 * - page-level container query named `pd`; single column under 720px,
 * - injected once by `App` into a `<style data-plugin-css="paper-desk">` tag.
 */

const MONO_STACK =
  'var(--dsw-alias-mono-font-family, var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace))'
const SANS_STACK =
  'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)'

const HOVER = 'var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent))'
const ACTIVE = 'var(--dsw-alias-interactive-bg-active, color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent))'
const BRAND = 'var(--pd-accent, var(--dsw-alias-brand-primary))'
const FG = 'var(--dsw-alias-label-primary)'
const FG_2 = 'var(--dsw-alias-label-secondary)'
const BG = 'var(--dsw-alias-bg-base)'
const L1 = 'var(--dsw-alias-bg-layer-1)'
const L2 = 'var(--dsw-alias-bg-layer-2)'
const OVERLAY = 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2))'
const B1 = 'var(--dsw-alias-border-l1)'
const B2 = 'var(--dsw-alias-border-l2)'
const B4 = 'var(--dsw-alias-border-l4, var(--dsw-alias-border-l2))'
const ERR = 'var(--dsw-alias-state-error-primary)'
const OK = 'var(--dsw-alias-state-success-primary)'
const WARN = 'var(--dsw-alias-state-warn-primary)'
const IDLE = 'var(--dsw-alias-state-idle-primary)'
const SHADOW = 'var(--dsw-shadow-lv1, 0 6px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent))'
const PRIMARY_FILL = 'var(--pd-accent, var(--dsw-alias-button-primary-fill))'
const PRIMARY_FG = 'var(--pd-accent-foreground, white)'
const SIDEBAR_FILL = 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1))'
const RING = `0 0 0 3px color-mix(in srgb, ${BRAND} 22%, transparent)`

import { relationsCss } from './RelationsGraph.js'
import { compareCss } from './CompareView.js'


const readingCss = `
.pd-root { --pd-accent: #637b69; font-size: 15px; line-height: 1.6; background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, #c8bca3); }
.pd-topbar { min-height: 56px; padding: 8px 24px; gap: 20px; background: transparent; }
.pd-brand-title { font-size: 23px; font-weight: 650; letter-spacing: -.04em; }
.pd-brand-sub, .pd-brand-version { display: none; }
.pd-brand-mark { background: transparent; color: var(--pd-accent); width: 26px; }
.pd-search { max-width: 520px; }
.pd-top-actions { gap: 3px; }
.pd-top-actions .pd-btn { font-size: 13px; min-height: 34px; }
.pd-body { padding: 12px 24px 20px; gap: 20px; }
.pd-pane { box-shadow: none; border-color: transparent; background: transparent; }
.pd-pane-detail { border-radius: 0; }
.pd-reader-head { padding: 0 0 6px; background: transparent; border-bottom: 0; }
.pd-reader-row { padding: 2px 0; }
.pd-reader-title { font-size: 21px; line-height: 1.35; font-weight: 630; }
.pd-reader-row-meta { margin-top: 2px; font-size: 13px; }
.pd-reader-row-tabs { margin-top: 6px; border-bottom: 0; }
.pd-tabs-inline .pd-tab { padding: 6px 9px; }
.pd-reader-row-title .pd-rating-inline { display: none; }
.pd-read-shell { gap: 16px; }
.pd-viewer-host { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-base); }
.pd-annot-rail { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 97%, #d6c7ac); min-width: 0; }
.pd-drawer-tabs { min-height: 54px; padding: 10px 12px; gap: 12px; }
.pd-drawer-tab { font-size: 15px; padding: 7px 10px; border-radius: 0; }
.pd-drawer-tab[data-on='true'] { color: var(--pd-accent); background: transparent; box-shadow: inset 0 -2px var(--pd-accent); }
.pd-ai-panel { font-size: 15px; }
.pd-ai-scroll { padding: 20px 20px 12px; }
.pd-ai-assistant { font-size: 16px; line-height: 1.9; }
.pd-ai-assistant .pd-md { font-size: 16px; line-height: 1.9; }
.pd-ai-assistant .pd-md h1 { font-size: 21px; }
.pd-ai-assistant .pd-md h2 { font-size: 19px; }
.pd-ai-assistant .pd-md h3 { font-size: 17px; }
.pd-ai-assistant .pd-md h4, .pd-ai-assistant .pd-md h5, .pd-ai-assistant .pd-md h6 { font-size: 16px; }
.pd-ai-assistant .pd-md p, .pd-ai-assistant .pd-md ul, .pd-ai-assistant .pd-md ol { margin: .8em 0; }
.pd-ai-assistant .pd-md li { margin: .35em 0; }
.pd-ai-task-menu { padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-ai-task-menu select { width: 100%; font-size: 13px; }
.pd-root .pd-input, .pd-root .pd-select { font-size: 14px; }
.pd-ai-user { font-size: 15px; padding: 13px 15px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); border-radius: 7px; }
.pd-ai-cites { padding: 8px 0 16px; }
.pd-ai-cite { font-size: 12px; padding: 4px 8px; color: var(--pd-accent); border-radius: 5px; }
.pd-ai-foot { padding: 12px; }
.pd-ai-actions { flex-wrap: wrap; }
.pd-chat-bar { padding: 8px 12px; }
.pd-tag { background: color-mix(in srgb, var(--pd-accent) 8%, transparent) !important; color: var(--dsw-alias-label-secondary) !important; border-color: transparent !important; }
.pd-row { border-radius: 6px; }
.pd-row-title { font-size: 14px; line-height: 1.45; }
.pd-row-note { font-size: 12px; }
.pd-row[data-selected='true'] { background: color-mix(in srgb, var(--pd-accent) 10%, transparent); border-color: transparent; }
.pd-image-context { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 8px 12px; font-size: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-image-context label { display: flex; align-items: center; gap: 5px; }
.pd-image-context input.pd-input { width: 90px; padding: 3px 6px; }
.pd-image-context span { color: var(--dsw-alias-label-secondary); }
.pd-source-image { width: 100%; height: auto; }
.pd-source-text { white-space: pre-wrap; font-size: 13px; }
.pd-drawer-body .pd-notes-with-cards { display: flex; flex-direction: column; overflow: auto; }
.pd-drawer-body .pd-notes { min-height: 280px; }
.pd-drawer-body .pd-cards-rail { width: 100%; flex: 0 0 auto; max-height: 300px; min-height: 180px; border-left: 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.pd-research-layout, .pd-discover-layout { display: flex; width: 100%; min-height: 0; gap: 24px; }
.pd-research-list { flex: 0 0 200px; overflow: auto; padding-right: 16px; border-right: 1px solid var(--dsw-alias-border-l1); }
.pd-research-list h2 { font-size: 20px; }
.pd-topic-row { display: block; width: 100%; text-align: left; background: transparent; border: 0; border-radius: 6px; color: inherit; padding: 14px 10px; font: inherit; cursor: pointer; }
.pd-topic-row:hover, .pd-topic-row[data-selected='true'] { background: color-mix(in srgb, var(--pd-accent) 10%, transparent); }
.pd-topic-row small { display: block; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pd-research-editor { flex: 1 1 450px; overflow: auto; min-width: 0; padding: 0 8px 32px; }
.pd-research-editor > label { display: grid; gap: 7px; margin-bottom: 20px; }
.pd-research-editor h2, .pd-discover-main h2 { margin: 0 0 24px; font-size: 25px; font-weight: 600; }
.pd-research-editor textarea { min-height: 90px; resize: vertical; }
.pd-research-editor textarea.pd-topic-notes { min-height: 240px; }
.pd-research-editor fieldset { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; margin: 0 0 20px; padding: 14px; }
.pd-topic-papers { max-height: 220px; overflow: auto; }
.pd-topic-papers > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-topic-papers label { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
.pd-research-actions { display: flex; gap: 8px; }
.pd-topic-discussion { flex: 0 1 380px; min-width: 280px; display: flex; flex-direction: column; gap: 10px; border-left: 1px solid var(--dsw-alias-border-l1); padding-left: 24px; }
.pd-topic-chat { flex: 1; overflow: auto; font-size: 15px; }
.pd-topic-chat > div { padding-bottom: 20px; }
.pd-topic-discussion textarea { min-height: 100px; }
.pd-discover-main { flex: 1; min-width: 0; overflow: auto; }
.pd-discover-search { display: flex; gap: 10px; margin: 24px 0; }
.pd-discover-search input { flex: 1; }
.pd-discovered-paper { display: flex; align-items: flex-start; gap: 24px; padding: 24px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-discovered-paper > div { flex: 1; min-width: 0; }
.pd-discovered-paper h3 { margin: 0; font-size: 18px; line-height: 1.45; }
.pd-discovered-paper p { max-width: 85ch; font-size: 14px; }
.pd-discovered-paper a { color: inherit; }
.pd-discovered-paper .pd-btn { flex: 0 0 auto; }
.pd-subscription { border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 8px; }
@container pd (max-width: 1150px) { .pd-topbar { gap: 12px; padding: 8px 16px; } .pd-body { padding: 12px 16px 16px; gap: 12px; } .pd-top-actions .pd-btn-label { font-size: 12px; } .pd-topic-discussion { flex-basis: 300px; min-width: 240px; padding-left: 12px; } .pd-research-list { flex-basis: 160px; } }
@container pd (max-width: 800px) { .pd-research-layout { flex-wrap: wrap; overflow: auto; } .pd-research-editor { flex: 1 1 60%; overflow: visible; } .pd-topic-discussion { flex: 1 1 100%; min-height: 400px; } .pd-research-list { flex-basis: 145px; } .pd-discover-search { flex-wrap: wrap; } .pd-discovered-paper { flex-direction: column; gap: 10px; } .pd-reader-title { font-size: 18px; } }
`

export const CSS = `
/* ── page root ─────────────────────────────────────────────────────────── */
.pd-root {
  container: pd / inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: ${FG};
  background: ${BG};
  font-family: ${SANS_STACK};
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.pd-root[data-host-desktop='true'] { padding-top: var(--pd-titlebar-inset, 38px); }
.pd-root *, .pd-root *::before, .pd-root *::after { box-sizing: border-box; }
.pd-root :focus-visible { outline: 2px solid ${BRAND}; outline-offset: 1px; border-radius: 4px; }
.pd-root ::selection { background: color-mix(in srgb, ${BRAND} 28%, transparent); }
.pd-root ::-webkit-scrollbar { width: 12px; height: 12px; }
.pd-root ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 36%, transparent);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}
.pd-root ::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 58%, transparent);
}
.pd-root ::-webkit-scrollbar-track { background: transparent; }
.pd-root .pd-list-scroll,
.pd-root .pd-ai-scroll,
.pd-root .pd-annot-scroll,
.pd-root .pd-cards-scroll { scrollbar-gutter: stable; }

.pd-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ── top bar ───────────────────────────────────────────────────────────── */
.pd-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 12px clamp(16px, 2.5cqi, 32px);
  border-bottom: 1px solid ${B1};
  background: ${SIDEBAR_FILL};
}
.pd-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pd-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: ${PRIMARY_FG};
  background: linear-gradient(
    145deg,
    color-mix(in srgb, ${BRAND} 92%, ${FG}),
    color-mix(in srgb, ${BRAND} 62%, ${BG})
  );
  flex: 0 0 auto;
}
.pd-brand-text { display: flex; flex-direction: column; min-width: 0; }
.pd-brand-title-row { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.pd-brand-version {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid ${B1};
  border-radius: 999px;
  color: ${FG_2};
  font-family: ${MONO_STACK};
  font-size: 10px;
  line-height: 16px;
}
.pd-brand-title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.pd-brand-sub {
  font-size: 11.5px;
  color: ${FG_2};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pd-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 180px;
  min-width: 150px;
  max-width: 420px;
}
.pd-search-icon {
  position: absolute;
  left: 9px;
  display: inline-flex;
  color: ${FG_2};
  pointer-events: none;
}
.pd-search .pd-input { width: 100%; padding-left: 30px; padding-right: 28px; }
.pd-search-clear {
  position: absolute;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${FG_2};
  cursor: pointer;
}
.pd-search-clear:hover { background: ${HOVER}; color: ${FG}; }
.pd-top-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; margin-left: auto; }
.pd-top-actions .pd-btn { flex: 0 0 auto; }

/* ── three-pane body ───────────────────────────────────────────────────── */
.pd-body {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  gap: 12px;
  min-height: 0;
  padding: clamp(10px, 1.6cqi, 14px) clamp(16px, 2.5cqi, 32px) clamp(16px, 2.5cqi, 32px);
  overflow: hidden;
}
.pd-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid ${B1};
  border-radius: 12px;
  background: ${L1};
  overflow: hidden;
}
.pd-pane-list {
  position: relative;
  flex: 0 0 320px;
  width: 320px;
  min-width: 240px;
  max-width: 560px;
  overflow: visible;
}
.pd-list-resizer {
  position: absolute;
  top: 0;
  right: -12px;
  bottom: 0;
  z-index: 20;
  width: 12px;
  cursor: col-resize;
  touch-action: none;
}
.pd-list-resizer::after {
  content: '';
  position: absolute;
  bottom: 34vh;
  left: 50%;
  width: 2px;
  height: 36px;
  border-radius: 999px;
  background: color-mix(in srgb, ${FG} 24%, transparent);
  transform: translateX(-50%);
  pointer-events: none;
}
.pd-list-resizer:hover { background: color-mix(in srgb, ${FG} 7%, transparent); }
.pd-list-resizer:hover::after { background: ${BRAND}; }
.pd-list-restore {
  position: absolute;
  top: 50%;
  left: 0;
  z-index: 4;
  transform: translateY(-50%);
  width: 24px;
  height: 56px;
  border: 1px solid ${B1};
  border-left: 0;
  border-radius: 0 7px 7px 0;
  background: ${L1};
  color: ${FG_2};
  font-family: inherit;
  font-size: 20px;
  cursor: pointer;
}
.pd-list-restore:hover { color: ${FG}; background: ${L2}; }
.pd-list-collapse {
  position: absolute;
  top: 50%;
  right: 0;
  z-index: 4;
  transform: translateY(-50%);
  width: 24px;
  height: 56px;
  border: 1px solid ${B1};
  border-right: 0;
  border-radius: 7px 0 0 7px;
  background: ${L1};
  color: ${FG_2};
  font-family: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.pd-list-collapse:hover { color: ${FG}; background: ${L2}; }
.pd-pane-detail { flex: 1 1 auto; min-width: 0; position: relative; }
.pd-pane-single { flex: 1 1 auto; min-width: 0; overflow: auto; }

/* ── library list ──────────────────────────────────────────────────────── */
.pd-list-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 auto;
  padding: 10px 10px 9px;
  border-bottom: 1px solid ${B1};
}
.pd-list-title-row { display: flex; align-items: center; gap: 8px; }
.pd-list-title { margin: 0; font-size: 13px; font-weight: 600; }
.pd-list-count { font-size: 11.5px; color: ${FG_2}; }
.pd-list-tools { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.pd-select-sm {
  min-height: 26px;
  padding: 2px 7px;
  font-size: 11.5px;
  border-radius: 6px;
}
.pd-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pd-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid ${B1};
  border-radius: 999px;
  background: transparent;
  color: ${FG_2};
  font-family: inherit;
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.pd-chip:hover { background: ${HOVER}; color: ${FG}; }
.pd-chip[data-on="true"] {
  color: ${BRAND};
  border-color: color-mix(in srgb, ${BRAND} 36%, transparent);
  background: color-mix(in srgb, ${BRAND} 12%, transparent);
}
.pd-chip[data-tone="warn"] { color: ${WARN}; border-color: color-mix(in srgb, ${WARN} 36%, transparent); }
.pd-chip-static { cursor: default; }
.pd-chip-static:hover { background: transparent; color: ${FG_2}; }
.pd-chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-right: -2px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}
.pd-chip-x:hover { opacity: 1; background: ${HOVER}; }

.pd-list-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px; }
.pd-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pd-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.pd-row:hover { background: ${HOVER}; }
.pd-row[data-active="true"] {
  background: color-mix(in srgb, ${BRAND} 9%, transparent);
  border-color: color-mix(in srgb, ${BRAND} 26%, transparent);
}
.pd-row-top { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
.pd-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: ${IDLE};
  box-shadow: 0 0 0 2px color-mix(in srgb, ${IDLE} 18%, transparent);
}
.pd-dot[data-status="reading"] {
  background: ${BRAND};
  box-shadow: 0 0 0 2px color-mix(in srgb, ${BRAND} 20%, transparent);
}
.pd-dot[data-status="read"] {
  background: ${OK};
  box-shadow: 0 0 0 2px color-mix(in srgb, ${OK} 20%, transparent);
}
.pd-dot[data-status="archived"] { background: ${FG_2}; opacity: 0.55; }
.pd-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.pd-row-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 550;
  line-height: 1.35;
  word-break: break-word;
}
.pd-row-authors {
  overflow: hidden;
  color: ${FG_2};
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-row-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: ${FG_2};
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pd-row-rating { color: ${WARN}; font-weight: 600; }
.pd-row-meta-sep { opacity: 0.5; }
.pd-row-note {
  overflow: hidden;
  color: ${FG_2};
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0.92;
}
.pd-row-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 1px; }
.pd-tag {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent);
  color: ${FG_2};
  font-size: 10px;
  line-height: 1.7;
}
/* ── library: table view + tag colouring ───────────────────────────────── */
.pd-table-scroll { width: 100%; overflow-x: auto; }
.pd-table {
  width: 100%;
  min-width: 340px;
  border-collapse: collapse;
  font-size: 11.5px;
}
.pd-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 5px 6px;
  border-bottom: 1px solid ${B1};
  background: ${L1};
  color: ${FG_2};
  font-size: 10.5px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.pd-table-sort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.pd-table-sort:hover { color: ${FG}; }
.pd-table td {
  padding: 4px 6px;
  border-bottom: 1px solid color-mix(in srgb, ${FG} 6%, transparent);
  vertical-align: middle;
}
.pd-table-row { cursor: pointer; }
.pd-table-row:hover td { background: ${HOVER}; }
.pd-table-row[data-active="true"] td { background: color-mix(in srgb, ${BRAND} 9%, transparent); }
.pd-table-row:focus-visible { outline: 2px solid ${BRAND}; outline-offset: -2px; }
.pd-table .pd-dot { display: inline-block; margin: 0 5px 0 0; vertical-align: middle; }
.pd-table-title {
  display: inline-block;
  max-width: 170px;
  overflow: hidden;
  color: ${FG};
  font-weight: 550;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}
.pd-table-cell-authors {
  max-width: 120px;
  overflow: hidden;
  color: ${FG_2};
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-table-cell-year { color: ${FG_2}; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pd-table-cell-tags { white-space: nowrap; }
.pd-table .pd-tag { max-width: 84px; overflow: hidden; font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }

/* Stable per-tag colour: hue derived from the tag name, never persisted. */
.pd-tag-hue {
  border: 1px solid hsl(var(--pd-tag-hue, 210) 55% 52% / 0.34);
  background: hsl(var(--pd-tag-hue, 210) 70% 58% / 0.15);
  color: color-mix(in srgb, hsl(var(--pd-tag-hue, 210) 62% 42%) 78%, var(--dsw-alias-label-primary));
}

.pd-list-note { padding: 8px 10px 12px; }
.pd-list-note-line {
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${FG_2};
  font-size: 11.5px;
}

/* ── shared primitives ─────────────────────────────────────────────────── */
.pd-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid ${B1};
  border-radius: 8px;
  background: ${L1};
  color: ${FG};
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.pd-btn:hover:not(:disabled) { background: ${HOVER}; }
.pd-btn:active:not(:disabled) { background: ${ACTIVE}; }
.pd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pd-btn-label { display: inline-block; }
.pd-btn-primary {
  border-color: transparent;
  background: ${PRIMARY_FILL};
  color: ${PRIMARY_FG};
}
.pd-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, ${PRIMARY_FILL} 88%, ${FG});
}
.pd-btn-primary:active:not(:disabled) {
  background: color-mix(in srgb, ${PRIMARY_FILL} 80%, ${FG});
}
.pd-btn-danger {
  border-color: color-mix(in srgb, ${ERR} 38%, ${B1});
  color: ${ERR};
}
.pd-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, ${ERR} 10%, transparent); }
.pd-btn-ghost { border-color: transparent; background: transparent; }
.pd-btn-ghost:hover:not(:disabled) { background: ${HOVER}; }
.pd-btn-sm {
  min-height: 24px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
}
.pd-btn-icon {
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border-radius: 7px;
  color: ${FG_2};
}
.pd-btn-icon:hover:not(:disabled) { color: ${FG}; }
.pd-btn[data-active="true"] {
  color: ${BRAND};
  border-color: color-mix(in srgb, ${BRAND} 30%, transparent);
  background: color-mix(in srgb, ${BRAND} 11%, transparent);
}
.pd-btn-group { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }

.pd-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pd-field-label { color: ${FG}; font-size: 12px; font-weight: 500; }
.pd-field-hint { color: ${FG_2}; font-size: 11.5px; }
.pd-field-error { color: ${ERR}; font-size: 11.5px; }
.pd-input, .pd-select, .pd-textarea {
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid ${B1};
  border-radius: 8px;
  background: ${BG};
  color: ${FG};
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.4;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.pd-input::placeholder, .pd-textarea::placeholder { color: ${FG_2}; opacity: 0.75; }
.pd-input:focus, .pd-select:focus, .pd-textarea:focus {
  border-color: color-mix(in srgb, ${BRAND} 58%, ${B1});
  box-shadow: ${RING};
}
.pd-input[aria-invalid="true"], .pd-textarea[aria-invalid="true"] {
  border-color: color-mix(in srgb, ${ERR} 58%, ${B1});
}
.pd-input:disabled, .pd-textarea:disabled, .pd-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.pd-textarea { min-height: 84px; resize: vertical; }
.pd-field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.pd-check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.pd-check-input {
  width: 15px;
  height: 15px;
  margin: 2px 0 0;
  accent-color: ${BRAND};
  flex: 0 0 auto;
}
.pd-check-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pd-check-label { font-size: 12.5px; font-weight: 500; }
.pd-check-hint { color: ${FG_2}; font-size: 11.5px; }

.pd-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding: 0 10px;
  border-bottom: 1px solid ${B1};
  overflow-x: auto;
}
.pd-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: ${FG_2};
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.pd-tab:hover { color: ${FG}; }
.pd-tab[data-on="true"] { color: ${FG}; border-bottom-color: ${BRAND}; }
.pd-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: color-mix(in srgb, ${BRAND} 16%, transparent);
  color: ${BRAND};
  font-size: 10px;
}

/* ── spinner / empty / badge ───────────────────────────────────────────── */
.pd-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
  border-top-color: ${BRAND};
  border-radius: 50%;
  animation: pd-spin 800ms linear infinite;
  flex: 0 0 auto;
}
@keyframes pd-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .pd-spinner { animation-duration: 2.4s; }
  .pd-btn, .pd-chip, .pd-row, .pd-tab { transition: none; }
}

.pd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 20px;
  color: ${FG_2};
  text-align: center;
}
.pd-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: color-mix(in srgb, ${BRAND} 10%, transparent);
  color: ${BRAND};
  opacity: 0.95;
}
.pd-empty-title { color: ${FG}; font-size: 13px; font-weight: 600; }
.pd-empty-desc { max-width: 380px; font-size: 12px; line-height: 1.55; }
.pd-empty-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }

.pd-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border: 1px solid ${B1};
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.7;
  white-space: nowrap;
}
.pd-badge[data-kind="cloud"] {
  color: ${BRAND};
  border-color: color-mix(in srgb, ${BRAND} 32%, transparent);
  background: color-mix(in srgb, ${BRAND} 9%, transparent);
}
.pd-badge[data-kind="local"] { color: ${FG_2}; background: color-mix(in srgb, ${FG_2} 8%, transparent); }
.pd-badge[data-kind="warn"] {
  color: ${WARN};
  border-color: color-mix(in srgb, ${WARN} 34%, transparent);
  background: color-mix(in srgb, ${WARN} 9%, transparent);
}
.pd-badge[data-kind="error"] {
  color: ${ERR};
  border-color: color-mix(in srgb, ${ERR} 34%, transparent);
  background: color-mix(in srgb, ${ERR} 8%, transparent);
}
.pd-badge[data-kind="success"] {
  color: ${OK};
  border-color: color-mix(in srgb, ${OK} 32%, transparent);
  background: color-mix(in srgb, ${OK} 8%, transparent);
}

/* ── reader ────────────────────────────────────────────────────────────── */
.pd-reader { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.pd-reader-head {
  position: sticky;
  top: 0;
  z-index: 9;
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  background: ${L1};
  border-bottom: 1px solid ${B1};
}
.pd-reader-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px 14px; }
.pd-reader-row-title { padding-bottom: 1px; }
.pd-reader-row-meta {
  padding-top: 0;
  padding-bottom: 5px;
  gap: 6px;
  overflow: hidden;
  color: ${FG_2};
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}
.pd-reader-row-tabs { padding-top: 0; padding-bottom: 0; gap: 6px; }
.pd-reader-row-spacer { flex: 1 1 auto; }
.pd-reader-actions-spacer { flex: 1 1 auto; }
.pd-reader-title {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: ${FG};
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.005em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-rating-inline { display: inline-flex; flex: 0 0 auto; transform: translateY(-1px); }
.pd-rating-inline .pd-star { padding: 0; font-size: 12px; }
.pd-reader-authors {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pd-reader-meta-item { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pd-reader-info-sep { flex: 0 0 auto; opacity: 0.45; }
.pd-status-chip-edit { padding-right: 4px; gap: 3px; cursor: pointer; }
.pd-status-select {
  appearance: none;
  border: 0;
  padding: 0 12px 0 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  cursor: pointer;
  outline: none;
}
.pd-status-caret {
  margin-left: -10px;
  font-size: 8px;
  color: ${FG_2};
  pointer-events: none;
}
.pd-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid ${B1};
  border-radius: 999px;
  color: ${FG_2};
  font-size: 10.5px;
  line-height: 1.7;
  white-space: nowrap;
}
.pd-status-chip .pd-dot { width: 5px; height: 5px; margin: 0; box-shadow: none; }
.pd-status-chip[data-status="reading"] {
  color: ${BRAND};
  border-color: color-mix(in srgb, ${BRAND} 30%, transparent);
  background: color-mix(in srgb, ${BRAND} 8%, transparent);
}
.pd-status-chip[data-status="read"] {
  color: ${OK};
  border-color: color-mix(in srgb, ${OK} 30%, transparent);
  background: color-mix(in srgb, ${OK} 8%, transparent);
}
.pd-reader-row-meta .pd-tag { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-tabs-inline { flex: 0 0 auto; padding: 0; border-bottom: 0; gap: 0; overflow: visible; }
.pd-tabs-inline .pd-tab { padding: 8px 9px; font-size: 13px; }
.pd-assist-inline {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
}
.pd-assist-inline-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin-right: 2px;
  color: ${FG_2};
  font-size: 11px;
  white-space: nowrap;
}
.pd-assist-inline .pd-btn {
  min-height: 24px;
  padding: 2px 6px;
  color: ${FG_2};
  font-size: 11.5px;
}
.pd-assist-inline .pd-btn:hover:not(:disabled) { color: ${FG}; }

/* ── overflow menu ─────────────────────────────────────────────────────── */
.pd-menu { position: relative; display: inline-flex; flex: 0 0 auto; }
.pd-menu-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: 4px;
  border: 1px solid ${B1};
  border-radius: 9px;
  background: ${OVERLAY};
  box-shadow: ${SHADOW};
}
.pd-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${FG};
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.pd-menu-item:hover:not(:disabled) { background: ${HOVER}; }
.pd-menu-item:disabled { opacity: 0.5; cursor: not-allowed; }
.pd-menu-item[data-danger="true"] { color: ${ERR}; }
.pd-menu-item-icon { display: inline-flex; color: ${FG_2}; }
.pd-menu-item[data-danger="true"] .pd-menu-item-icon { color: ${ERR}; }

.pd-stars { display: inline-flex; align-items: center; gap: 1px; }
.pd-star {
  padding: 0 1px;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, ${FG} 24%, transparent);
  font-size: 14px;
  line-height: 1.2;
  cursor: pointer;
}
.pd-star[data-on="true"] { color: ${WARN}; }
.pd-star:disabled { cursor: default; }

.pd-tab-panel { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-tab-panel[hidden] { display: none; }
/* ── in-app pdf viewer + annotation rail ───────────────────────────────── */
.pd-read-shell { position: relative; display: flex; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.pd-viewer-host {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background: ${L2};
}
.pd-viewer-host > * { flex: 1 1 auto; min-width: 0; min-height: 0; }
/* Docked push layout (>900px): the drawer is an in-flow flex sibling of the
   viewer host, so the PDF keeps its full remaining width and the pdf.js
   ResizeObserver re-fits it. No width transition here: it would fight that
   observer and delay the re-fit. */
.pd-annot-rail {
  position: static;
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  width: 300px;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid ${B1};
  background: ${L1};
}
.pd-annot-rail[data-open="false"] { display: none; }
.pd-annot-rail { position: relative; overflow: visible; }
.pd-drawer-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -12px;
  z-index: 20;
  width: 12px;
  cursor: col-resize;
  touch-action: none;
}
.pd-drawer-resizer::after {
  content: '';
  position: absolute;
  bottom: 34vh;
  left: 50%;
  width: 2px;
  height: 36px;
  border-radius: 999px;
  background: color-mix(in srgb, ${FG} 24%, transparent);
  transform: translateX(-50%);
  pointer-events: none;
}
.pd-drawer-resizer:hover { background: color-mix(in srgb, ${FG} 7%, transparent); }
.pd-drawer-resizer:hover::after { background: ${BRAND}; }
.pd-annot-rail[data-tab="ai"] { width: 360px; }
.pd-drawer-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding: 4px 6px;
  border-bottom: 1px solid ${B1};
}
.pd-drawer-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${FG_2};
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.pd-drawer-tab:hover { background: ${HOVER}; color: ${FG}; }
.pd-drawer-tab[data-on="true"] { background: color-mix(in srgb, ${BRAND} 10%, transparent); color: ${BRAND}; }
.pd-drawer-tabs-spacer { flex: 1 1 auto; }
.pd-drawer-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-annot-pane { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-annot-page { color: ${FG_2}; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.pd-annot-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  padding: 6px 10px 0;
  color: ${FG_2};
  font-size: 10.5px;
  line-height: 1.5;
}
.pd-annot-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px; }
.pd-annot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.pd-annot-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: 8px;
}
.pd-annot-item:hover { background: ${HOVER}; }
.pd-annot-item[data-active="true"] {
  background: color-mix(in srgb, ${BRAND} 8%, transparent);
  border-color: color-mix(in srgb, ${BRAND} 24%, transparent);
}
.pd-annot-locate {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.pd-annot-line { display: flex; align-items: center; gap: 5px; color: ${FG_2}; font-size: 10.5px; }
.pd-annot-swatch {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: color-mix(in srgb, ${FG_2} 45%, transparent);
}
.pd-annot-swatch[data-color="yellow"] { background: color-mix(in srgb, ${WARN} 72%, transparent); }
.pd-annot-swatch[data-color="green"] { background: color-mix(in srgb, ${OK} 72%, transparent); }
.pd-annot-swatch[data-color="blue"] { background: color-mix(in srgb, ${BRAND} 66%, transparent); }
.pd-annot-swatch[data-color="pink"] { background: color-mix(in srgb, ${ERR} 60%, transparent); }
.pd-annot-swatch[data-color="purple"] { background: color-mix(in srgb, ${BRAND} 42%, ${ERR} 30%); }
.pd-annot-kind {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  color: ${FG_2};
  font-size: 9.5px;
  line-height: 1.6;
}
.pd-annot-quote {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding-left: 6px;
  border-left: 2px solid ${B2};
  color: ${FG};
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
}
.pd-annot-comment {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: ${FG_2};
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.pd-annot-actions { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 1px; }
.pd-annot-editor { display: flex; flex-direction: column; gap: 4px; }
.pd-annot-editor .pd-textarea { min-height: 56px; font-size: 11.5px; }
.pd-annot-editor-actions { display: flex; justify-content: flex-end; gap: 4px; }
.pd-annot-empty { display: flex; flex-direction: column; gap: 5px; padding: 16px 10px; color: ${FG_2}; }
.pd-modal-quote {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: ${L2};
  color: ${FG};
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.pd-panel-note {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 6px 14px;
  border-bottom: 1px solid ${B1};
  color: ${FG_2};
  font-size: 11.5px;
}
.pd-panel-note[data-kind="warn"] {
  color: ${WARN};
  background: color-mix(in srgb, ${WARN} 7%, transparent);
}
.pd-text-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pd-page-card {
  padding: 2px 0 2px 11px;
  border-left: 2px solid ${B2};
}
.pd-page-no {
  color: ${FG_2};
  font-size: 10.5px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.pd-page-text {
  margin: 2px 0 0;
  color: ${FG};
  font-size: 12.5px;
  line-height: 1.62;
  white-space: pre-wrap;
  word-break: break-word;
}
.pd-reader-placeholder { flex: 1 1 auto; }

.pd-detail-error {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, ${ERR} 32%, ${B1});
  border-radius: 10px;
  background: color-mix(in srgb, ${ERR} 7%, transparent);
  color: ${ERR};
  font-size: 12px;
}
.pd-loading-block {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 36px 20px;
  color: ${FG_2};
  font-size: 12.5px;
}

/* ── notes ─────────────────────────────────────────────────────────────── */
.pd-notes { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-notes-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 7px 12px;
  border-bottom: 1px solid ${B1};
}
.pd-notes-toolbar-spacer { flex: 1 1 auto; }
.pd-notes-body { display: flex; flex: 1 1 auto; min-height: 0; }
.pd-notes-editor { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; min-width: 0; }
.pd-notes-textarea {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: ${FG};
  font-family: ${MONO_STACK};
  font-size: 12.5px;
  line-height: 1.65;
  resize: none;
  outline: none;
}
.pd-notes-preview {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 22px;
}
.pd-notes-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 4px 12px;
  border-top: 1px solid ${B1};
  color: ${FG_2};
  font-size: 11px;
}
.pd-notes-status-spacer { flex: 1 1 auto; }
.pd-notes-dirty { color: ${WARN}; display: inline-flex; align-items: center; gap: 4px; }
.pd-notes-saved { color: ${OK}; display: inline-flex; align-items: center; gap: 4px; }
.pd-conflict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 auto;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, ${WARN} 30%, ${B1});
  background: color-mix(in srgb, ${WARN} 9%, transparent);
}
.pd-conflict-head { display: flex; align-items: center; gap: 6px; color: ${WARN}; font-size: 12px; font-weight: 600; }
.pd-conflict-desc { color: ${FG}; font-size: 11.5px; line-height: 1.5; }
.pd-conflict-path {
  color: ${FG_2};
  font-family: ${MONO_STACK};
  font-size: 10.5px;
  word-break: break-all;
}
.pd-conflict-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.pd-notes-sections { display: flex; flex-wrap: wrap; gap: 4px; }
.pd-notes-section { font-size: 10.5px; }

/* ── note cards (notes-tab rail + card editor) ─────────────────────────── */
.pd-notes-with-cards { display: flex; flex: 1 1 auto; min-height: 0; }
.pd-notes-with-cards > .pd-notes { flex: 1 1 auto; min-width: 0; }
.pd-cards-rail {
  display: flex;
  flex-direction: column;
  flex: 0 0 280px;
  width: 280px;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid ${B1};
  background: ${L1};
}
.pd-cards-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 8px 10px;
  border-bottom: 1px solid ${B1};
  color: ${FG};
  font-size: 12px;
  font-weight: 600;
}
.pd-cards-head-spacer { flex: 1 1 auto; }
.pd-cards-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px; }
.pd-card-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.pd-card-select { position: absolute; top: 6px; right: 6px; z-index: 2; }
.pd-card-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 8px;
  border: 1px solid ${B1};
  border-radius: 8px;
  background: color-mix(in srgb, ${FG} 2%, transparent);
}
.pd-card-locate {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.pd-card-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: ${FG};
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}
.pd-card-excerpt {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: ${FG_2};
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
}
.pd-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
.pd-card-page-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border: 1px solid ${B1};
  border-radius: 999px;
  background: transparent;
  color: ${BRAND};
  font-family: inherit;
  font-size: 9.5px;
  line-height: 1.8;
  white-space: nowrap;
}
.pd-card-page-jump { cursor: pointer; }
.pd-card-page-jump:hover {
  background: color-mix(in srgb, ${BRAND} 10%, transparent);
  border-color: color-mix(in srgb, ${BRAND} 30%, transparent);
}
.pd-card-actions { display: flex; flex-wrap: wrap; gap: 1px; }
.pd-card-actions .pd-btn { min-height: 22px; padding: 1px 5px; color: ${FG_2}; font-size: 10.5px; }
.pd-card-actions .pd-btn:hover:not(:disabled) { color: ${FG}; }
.pd-card-context { margin: 6px 0 2px; border: 1px solid ${B1}; border-radius: 7px; }
.pd-card-context-head { display: flex; align-items: center; gap: 6px; padding: 4px 7px; }
.pd-card-context-toggle { flex: 1 1 auto; border: 0; background: transparent; color: ${FG_2}; font: inherit; font-size: 11px; text-align: left; cursor: pointer; padding: 0; }
.pd-card-context-list { display: flex; flex-direction: column; gap: 3px; max-height: 210px; overflow: auto; padding: 0 7px 7px; }
.pd-card-context-turn { display: flex; align-items: flex-start; gap: 5px; padding: 3px 0; border-top: 1px dashed ${B1}; font-size: 10.5px; line-height: 1.45; cursor: pointer; }
.pd-card-context-turn input { margin-top: 2px; flex: 0 0 auto; }
.pd-card-context-role { flex: 0 0 auto; color: var(--dsw-alias-brand-primary); }
.pd-card-context-text { color: ${FG_2}; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 54px; overflow: auto; }
.pd-card-pages { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.pd-card-pages-empty { color: ${FG_2}; font-size: 11.5px; }
.pd-card-page-add { display: inline-flex; align-items: center; gap: 2px; }
.pd-card-page-input { width: 64px; min-height: 24px; padding: 1px 6px; font-size: 11.5px; }
.pd-ai-row-actions { display: flex; gap: 2px; margin-top: 2px; }
.pd-ai-row-actions .pd-btn { min-height: 22px; padding: 1px 6px; color: ${FG_2}; font-size: 10.5px; }
.pd-list-launchers { display: flex; gap: 4px; padding-top: 2px; }
.pd-list-launchers .pd-btn { flex: 1 1 0; min-height: 24px; padding: 2px 6px; font-size: 11.5px; }

/* ── in-panel AI drawer ────────────────────────────────────────────────── */

/* ── per-paper conversation bar (AI drawer) ───────────────────────────── */
.pd-chat-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid ${B1};
  background: ${L1};
}
.pd-chat-bar-label { flex: 0 0 auto; color: ${FG_2}; font-size: 11px; }
.pd-chat-select {
  flex: 1 1 auto;
  min-width: 0;
  max-width: none;
  height: 24px;
  padding: 0 6px;
  border: 1px solid ${B2};
  border-radius: 6px;
  background: ${BG};
  color: ${FG};
  font-size: 12px;
}
.pd-chat-rename { flex: 1 1 auto; min-width: 0; height: 24px; }
.pd-chat-confirm {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  color: ${ERR};
  font-size: 11px;
}

.pd-ai { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-ai-tasks {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  flex: 0 0 auto;
  padding: 6px 8px;
  border-bottom: 1px solid ${B1};
}
.pd-ai-tasks .pd-btn { min-height: 24px; padding: 2px 6px; color: ${FG_2}; font-size: 11.5px; }
.pd-ai-body { position: relative; display: flex; flex: 1 1 auto; min-height: 0; }
.pd-ai-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pd-ai-row { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pd-ai-user {
  align-self: flex-end;
  max-width: 92%;
  padding: 6px 9px;
  border-radius: 10px 10px 3px 10px;
  background: color-mix(in srgb, ${BRAND} 10%, transparent);
  color: ${FG};
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.pd-ai-assistant { color: ${FG}; font-size: 12.5px; line-height: 1.6; }
::highlight(paperdesk-answer-note) {
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
  color: inherit;
}
.pd-ai-note-menu {
  position: fixed;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 8px;
  border: 1px solid ${B1};
  border-radius: 7px;
  background: ${L1};
  box-shadow: var(--dsw-shadow-lv1, 0 6px 20px rgba(0,0,0,.16));
}
.pd-ai-note-menu-btn {
  border: 0;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 11px;
  padding: 3px 7px;
  cursor: pointer;
}
.pd-ai-note-menu-btn:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); }
.pd-ai-note-menu-hint { color: ${FG_2}; font-size: 10px; white-space: nowrap; }
.pd-ai-note-card {
  margin-top: 8px;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-left: 3px solid var(--dsw-alias-brand-primary);
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent);
}
.pd-ai-note-quote {
  color: ${FG_2};
  font-size: 11px;
  line-height: 1.5;
  max-height: 88px;
  overflow: auto;
  white-space: pre-wrap;
}
.pd-ai-note-mark { color: var(--dsw-alias-brand-primary); font-weight: 700; margin-right: 2px; }
.pd-ai-note-comment { margin-top: 5px; min-height: 42px; font-size: 11px; resize: vertical; }
.pd-ai-note-ask { display: flex; align-items: center; gap: 4px; margin-top: 5px; }
.pd-ai-note-ask-input { flex: 1 1 auto; min-width: 0; height: 26px; font-size: 11px; }
.pd-ai-note-delete {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: ${FG_2};
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.pd-ai-note-delete:hover { color: var(--dsw-alias-state-error-primary, #d44); }
.pd-ai-note-popup {
  position: fixed;
  z-index: 30;
  width: 280px;
  padding: 9px;
  border: 1px solid ${B1};
  border-radius: 9px;
  background: ${L1};
  box-shadow: var(--dsw-shadow-lv2, 0 12px 32px rgba(0,0,0,.2));
}
.pd-ai-note-popup-quote {
  max-height: 74px;
  overflow: auto;
  color: ${FG_2};
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.pd-ai-note-popup-comment { margin-top: 6px; min-height: 62px; font-size: 11.5px; resize: vertical; }
.pd-ai-note-popup-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 6px; }
.pd-ai-note-popup-actions .pd-ai-note-delete { margin-right: auto; font-size: 11px; }
.pd-ai-notes-tray {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 5px 8px;
  border-top: 1px solid ${B1};
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 4%, transparent);
  min-height: 28px;
}
.pd-ai-notes-tray-title { flex: 0 0 auto; color: ${FG_2}; font-size: 10.5px; }
.pd-ai-notes-chips { display: flex; align-items: center; gap: 3px; flex: 1 1 auto; min-width: 0; overflow-x: auto; }
.pd-ai-note-chip {
  flex: 0 0 auto;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent);
  color: ${FG};
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.pd-ai-note-chip:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.pd-ai-assistant .pd-md { font-size: 12.5px; }
.pd-ai-caret {
  display: inline-block;
  width: 5px;
  height: 12px;
  margin-left: 2px;
  border-radius: 1px;
  background: ${BRAND};
  vertical-align: -2px;
  animation: pd-ai-blink 1s steps(2, start) infinite;
}
@keyframes pd-ai-blink { 50% { opacity: 0; } }
.pd-ai-reasoning {
  padding: 5px 8px;
  border: 1px solid ${B1};
  border-radius: 8px;
  color: ${FG_2};
  font-size: 11px;
}
.pd-ai-reasoning summary { cursor: pointer; color: ${FG_2}; font-size: 11px; }
.pd-ai-reasoning .pd-md { margin-top: 4px; color: ${FG_2}; font-size: 11px; }
.pd-ai-tool { display: flex; align-items: center; gap: 6px; min-width: 0; color: ${FG_2}; font-size: 11px; }
.pd-ai-tool-name { flex: 0 0 auto; font-weight: 500; }
.pd-ai-tool-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.85; }
.pd-ai-status { color: ${FG_2}; font-size: 11px; }
.pd-ai-thinking { display: flex; align-items: center; gap: 6px; padding: 2px 0; color: ${FG_2}; font-size: 11.5px; }
.pd-ai-empty { margin: auto; max-width: 280px; padding: 16px 10px; color: ${FG_2}; font-size: 12px; line-height: 1.6; text-align: center; }
.pd-ai-error {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, ${ERR} 25%, ${B1});
  border-radius: 8px;
  background: color-mix(in srgb, ${ERR} 8%, transparent);
  color: ${ERR};
  font-size: 11.5px;
  line-height: 1.5;
}
.pd-ai-error > span { flex: 1 1 auto; min-width: 0; word-break: break-word; }
.pd-ai-cites { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 2px; }
.pd-ai-cite {
  padding: 0 6px;
  border: 1px solid ${B1};
  border-radius: 999px;
  background: transparent;
  color: ${BRAND};
  font-family: inherit;
  font-size: 10px;
  line-height: 1.8;
  cursor: pointer;
}
.pd-ai-cite:hover { background: color-mix(in srgb, ${BRAND} 10%, transparent); border-color: color-mix(in srgb, ${BRAND} 30%, transparent); }
.pd-ai-jump {
  position: absolute;
  left: 50%;
  bottom: 8px;
  z-index: 2;
  transform: translateX(-50%);
  padding: 3px 10px;
  border: 1px solid ${B1};
  border-radius: 999px;
  background: ${OVERLAY};
  color: ${FG};
  font-family: inherit;
  font-size: 11px;
  box-shadow: ${SHADOW};
  cursor: pointer;
}
.pd-ai-jump:hover { background: ${HOVER}; }
.pd-ai-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
  padding: 7px 8px;
  border-top: 1px solid ${B1};
}
.pd-ai-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.pd-ai-actions .pd-btn { min-height: 24px; padding: 2px 6px; color: ${FG_2}; font-size: 11.5px; }
.pd-ai-actions .pd-btn:hover:not(:disabled) { color: ${FG}; }
.pd-ai-tools-toggle {
  align-self: flex-start;
  margin: 2px 0 6px;
  padding: 2px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: ${FG_2};
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.pd-ai-tools-toggle:hover { background: ${L2}; color: ${FG}; }
.pd-md math {
  font-size: 1.05em;
  max-width: 100%;
  overflow-x: auto;
  vertical-align: middle;
}
.pd-md math[display="block"] {
  display: block;
  width: 100%;
  margin: 0.55em 0;
  padding: 1px 0;
  overflow-x: auto;
}

.pd-ai-ime-hint {
  margin-top: 3px;
  color: ${FG_2};
  font-size: 11px;
  line-height: 1.4;
}

.pd-ai-inputRow { display: flex; align-items: flex-end; gap: 6px; }
.pd-ai-input { flex: 1 1 auto; min-height: 34px; max-height: 120px; resize: vertical; font-size: 12px; padding: 6px 8px; }

/* ── metadata editor ───────────────────────────────────────────────────── */
.pd-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px 22px;
}
.pd-meta-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.pd-meta-hint { color: ${FG_2}; font-size: 11.5px; }
.pd-meta-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 2px;
}
.pd-meta-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding-top: 4px;
  border-top: 1px solid ${B1};
  color: ${FG_2};
  font-size: 11px;
}
.pd-meta-meta-item { display: flex; flex-direction: column; gap: 1px; }
.pd-meta-meta-value { color: ${FG}; font-size: 11.5px; word-break: break-word; }

/* ── sync view ─────────────────────────────────────────────────────────── */
.pd-sync {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px 24px;
}
.pd-sync-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.pd-sync-title { margin: 0; font-size: 15px; font-weight: 600; }
.pd-sync-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.pd-sync-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 9px 11px;
  border: 1px solid ${B1};
  border-radius: 9px;
  background: ${L2};
  color: ${FG_2};
  font-size: 11.5px;
  line-height: 1.55;
}
.pd-sync-note[data-kind="warn"] {
  border-color: color-mix(in srgb, ${WARN} 32%, ${B1});
  background: color-mix(in srgb, ${WARN} 8%, transparent);
  color: ${WARN};
}
.pd-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));
  gap: 8px;
}
.pd-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 9px 11px;
  border: 1px solid ${B1};
  border-radius: 10px;
  background: ${L2};
}
.pd-stat-value { font-size: 18px; font-weight: 600; line-height: 1.2; }
.pd-stat-label { color: ${FG_2}; font-size: 11px; }
.pd-section {
  display: flex;
  flex-direction: column;
  border: 1px solid ${B1};
  border-radius: 10px;
  background: ${L1};
  overflow: hidden;
}
.pd-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 9px 11px;
  border-bottom: 1px solid ${B1};
  font-size: 12px;
  font-weight: 600;
}
.pd-section-head .pd-badge { margin-left: auto; }
.pd-section-body { display: flex; flex-direction: column; gap: 6px; padding: 9px 11px; }
.pd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.pd-listitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent);
  font-size: 11.5px;
}
.pd-listitem-path {
  flex: 1 1 auto;
  min-width: 0;
  color: ${FG};
  font-family: ${MONO_STACK};
  font-size: 11px;
  word-break: break-all;
}
.pd-listitem-actions { display: flex; gap: 4px; flex: 0 0 auto; }
.pd-delta-group { display: flex; flex-direction: column; gap: 4px; }
.pd-delta-label { color: ${FG_2}; font-size: 10.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
.pd-inline-empty { color: ${FG_2}; font-size: 11.5px; }

/* ── settings view ─────────────────────────────────────────────────────── */
.pd-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px 24px;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
}
.pd-settings-title { margin: 0; font-size: 15px; font-weight: 600; }
.pd-settings-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pd-settings-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.pd-keymap { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 18px; margin: 2px 0 10px; }
.pd-keymap-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 0; }
.pd-keybinding {
  min-width: 54px;
  padding: 3px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.pd-keybinding:hover { border-color: var(--dsw-alias-border-l1); }
.pd-keybinding.is-capturing { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.pd-keybinding.is-duplicate { border-color: var(--dsw-alias-state-error-primary, #d44); color: var(--dsw-alias-state-error-primary, #d44); }
.pd-code {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  font-family: ${MONO_STACK};
  font-size: 11px;
  word-break: break-all;
}
.pd-settings-row { display: flex; flex-direction: column; gap: 8px; }
.pd-settings-row-inline { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.pd-settings-row-inline .pd-field { flex: 1 1 280px; }
.pd-path-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pd-path-row .pd-input { flex: 1 1 260px; }

/* ── setup card ────────────────────────────────────────────────────────── */
.pd-setup-wrap {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: auto;
  padding: clamp(16px, 2.5cqi, 32px);
}
.pd-setup {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(660px, 100%);
  padding: clamp(20px, 3cqi, 30px);
  border: 1px solid ${B1};
  border-radius: 14px;
  background: ${L1};
  box-shadow: ${SHADOW};
}
.pd-setup-head { display: flex; align-items: center; gap: 12px; }
.pd-setup-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: ${PRIMARY_FG};
  background: linear-gradient(
    145deg,
    color-mix(in srgb, ${BRAND} 92%, ${FG}),
    color-mix(in srgb, ${BRAND} 58%, ${BG})
  );
  flex: 0 0 auto;
}
.pd-setup-title { margin: 0; font-size: 20px; font-weight: 500; letter-spacing: -0.01em; }
.pd-setup-desc { color: ${FG_2}; font-size: 12.5px; line-height: 1.62; }
.pd-setup-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pd-setup-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 9px;
  background: ${L2};
  color: ${FG_2};
  font-size: 11.5px;
  line-height: 1.55;
}
.pd-setup-err { color: ${ERR}; font-size: 11.5px; }
.pd-setup-langs { display: flex; gap: 4px; margin-left: auto; }

/* ── modal / toasts ────────────────────────────────────────────────────── */
.pd-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--dsw-alias-bg-mask-1, color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent));
  backdrop-filter: blur(1.5px);
}
.pd-modal {
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: min(86vh, 720px);
  border: 1px solid ${B4};
  border-radius: 12px;
  background: ${OVERLAY};
  box-shadow: ${SHADOW};
  overflow: hidden;
  outline: none;
}
.pd-modal-wide { width: min(680px, 100%); }
.pd-modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 13px 15px;
  border-bottom: 1px solid ${B1};
}
.pd-modal-title { flex: 1 1 auto; margin: 0; font-size: 14px; font-weight: 600; }
.pd-modal-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding: 14px 15px;
}
.pd-modal-desc { color: ${FG_2}; font-size: 12px; line-height: 1.6; }
.pd-modal-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding: 11px 15px;
  border-top: 1px solid ${B1};
}

.pd-toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(380px, calc(100vw - 32px));
  pointer-events: none;
}
.pd-toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 11px;
  border: 1px solid ${B1};
  border-left: 3px solid ${BRAND};
  border-radius: 9px;
  background: ${OVERLAY};
  box-shadow: ${SHADOW};
  color: ${FG};
  font-size: 12px;
  line-height: 1.5;
  pointer-events: auto;
  animation: pd-toast-in 140ms ease-out;
}
.pd-toast[data-kind="success"] { border-left-color: ${OK}; }
.pd-toast[data-kind="error"] { border-left-color: ${ERR}; }
.pd-toast[data-kind="warn"] { border-left-color: ${WARN}; }
.pd-toast-icon { margin-top: 1px; color: ${BRAND}; flex: 0 0 auto; }
.pd-toast[data-kind="success"] .pd-toast-icon { color: ${OK}; }
.pd-toast[data-kind="error"] .pd-toast-icon { color: ${ERR}; }
.pd-toast[data-kind="warn"] .pd-toast-icon { color: ${WARN}; }
.pd-toast-message { flex: 1 1 auto; min-width: 0; word-break: break-word; }
.pd-toast-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: ${FG_2};
  cursor: pointer;
}
.pd-toast-close:hover { background: ${HOVER}; color: ${FG}; }
@keyframes pd-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* ── drag & drop ───────────────────────────────────────────────────────── */
.pd-drop {
  position: absolute;
  inset: 8px;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed color-mix(in srgb, ${BRAND} 60%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, ${BRAND} 8%, transparent);
  color: ${BRAND};
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
  backdrop-filter: blur(1px);
}

/* ── markdown ──────────────────────────────────────────────────────────── */
.pd-grow { flex: 1 1 auto; min-width: 0; width: 100%; }
.pd-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: ${BRAND};
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, ${BRAND} 35%, transparent);
}
.pd-link:hover { border-bottom-color: ${BRAND}; }
.pd-md { color: ${FG}; font-size: 12.5px; line-height: 1.68; word-break: break-word; }
.pd-md > :first-child { margin-top: 0; }
.pd-md > :last-child { margin-bottom: 0; }
.pd-md h1, .pd-md h2, .pd-md h3, .pd-md h4, .pd-md h5, .pd-md h6 {
  margin: 1.2em 0 0.45em;
  font-weight: 600;
  line-height: 1.35;
}
.pd-md h1 { font-size: 17px; }
.pd-md h2 { font-size: 15px; }
.pd-md h3 { font-size: 13.5px; }
.pd-md h4, .pd-md h5, .pd-md h6 { font-size: 12.5px; }
.pd-md p { margin: 0.55em 0; }
.pd-md ul, .pd-md ol { margin: 0.55em 0; padding-left: 1.5em; }
.pd-md li { margin: 0.18em 0; }
.pd-md li > p { margin: 0.2em 0; }
.pd-md blockquote {
  margin: 0.6em 0;
  padding: 0.1em 0 0.1em 0.85em;
  border-left: 3px solid color-mix(in srgb, ${BRAND} 42%, ${B2});
  color: ${FG_2};
}
.pd-md blockquote p { margin: 0.35em 0; }
.pd-md code {
  padding: 0.1em 0.34em;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  font-family: ${MONO_STACK};
  font-size: 0.92em;
}
.pd-md pre {
  margin: 0.7em 0;
  padding: 9px 11px;
  border: 1px solid ${B1};
  border-radius: 8px;
  background: ${L2};
  overflow: auto;
}
.pd-md pre code { padding: 0; background: transparent; font-size: 11.5px; line-height: 1.6; }
.pd-md a { color: ${BRAND}; text-decoration: none; border-bottom: 1px solid color-mix(in srgb, ${BRAND} 35%, transparent); }
.pd-md a:hover { border-bottom-color: ${BRAND}; }
.pd-md hr { margin: 1em 0; border: 0; border-top: 1px solid ${B1}; }
.pd-md table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  margin: 0.7em 0;
  border-collapse: collapse;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.pd-md th, .pd-md td {
  min-width: 72px;
  padding: 4px 7px;
  border: 1px solid ${B1};
  text-align: left;
  vertical-align: top;
  word-break: normal;
  overflow-wrap: anywhere;
}
.pd-md th { background: ${L2}; font-weight: 600; }
.pd-md img { max-width: 100%; border-radius: 6px; }
.pd-md input[type="checkbox"] { margin-right: 4px; }

/* ── responsive: the cards rail folds away under 1000px ───────────────── */
@container pd (max-width: 1000px) {
  .pd-cards-rail { display: none; }
}

/* ── responsive: annotation rail collapses to an overlay under 900px ──── */
@container pd (max-width: 900px) {
  /* Narrow container: fall back to the absolute full-height overlay instead of
     squeezing the viewer into a tiny column. */
  .pd-annot-rail {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 6;
    width: min(320px, 100%);
    border-left: 1px solid ${B1};
    background: color-mix(in srgb, ${L1} 93%, transparent);
    box-shadow: -10px 0 28px color-mix(in srgb, ${FG} 10%, transparent);
    backdrop-filter: blur(8px);
  }
  .pd-annot-rail[data-tab="ai"] { width: min(380px, 100%); }
  .pd-read-shell[data-drawer-open="true"] .pdv-scrollRail {
    right: calc(min(380px, 100%) + 8px);
  }
  .pd-reader-row-tabs { flex-wrap: wrap; padding-bottom: 4px; }
  .pd-assist-inline { flex-wrap: wrap; overflow: visible; }
  .pd-reader-authors { max-width: 32%; }
}

/* ── responsive: one column under 720px ────────────────────────────────── */
@container pd (max-width: 720px) {
  .pd-topbar { gap: 8px; }
  .pd-brand-sub { display: none; }
  .pd-search { order: 4; flex-basis: 100%; max-width: none; }
  .pd-body { flex-direction: column; overflow: auto; }
  .pd-list-resizer, .pd-list-collapse, .pd-list-restore { display: none; }
  .pd-pane-list {
    flex: 0 0 auto;
    width: auto;
    max-height: 46%;
    min-height: 180px;
  }
  .pd-pane-detail { flex: 1 1 auto; min-height: 340px; overflow: visible; }
  .pd-pane-single { overflow: visible; }
  .pd-reader { height: auto; min-height: 340px; }
  .pd-read-shell { min-height: 320px; }
  .pd-viewer-host { min-height: 320px; }
  .pd-reader-row-meta { flex-wrap: wrap; white-space: normal; row-gap: 2px; }
  .pd-reader-authors { max-width: 100%; }
  .pd-toasts { right: 12px; bottom: 12px; }
  .pd-stats { grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); }
}
` +
  relationsCss +
  compareCss + readingCss

/** Value of the injected `<style data-plugin-css="...">` attribute. */
export const STYLE_ATTR = 'paper-desk'
