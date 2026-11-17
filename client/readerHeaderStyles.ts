/** Three clear rows: title/actions, metadata/tags, then document navigation. */
export const readerHeaderCss = `
.pd-reader-head { padding-bottom: 8px; }
.pd-reader-row-title { flex-wrap: wrap; align-items: flex-start; column-gap: 16px; row-gap: 6px; }
.pd-reader-title { flex: 1 1 480px; min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: normal; overflow-wrap: anywhere; font-size: 21px; line-height: 1.45; }
.pd-reader-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 2px; margin-left: auto; }
.pd-reader-actions > .pd-btn, .pd-reader-actions > .pd-menu > .pd-btn { height: 30px; min-height: 30px; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; box-shadow: none; }
.pd-reader-actions > .pd-btn:hover:not(:disabled), .pd-reader-actions > .pd-menu > .pd-btn:hover:not(:disabled), .pd-reader-actions > .pd-menu > .pd-btn[data-active='true'] { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }
.pd-reader-actions .pd-btn:focus-visible, .pd-reader-tags-toggle:focus-visible { outline: 2px solid var(--pd-accent); outline-offset: 2px; }
.pd-reader-actions .pd-reader-status { flex: 0 0 96px; }
.pd-reader-actions .pd-reader-status > .pd-btn { width: 96px; justify-content: space-between; }
.pd-reader-status-label { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.pd-reader-status-mark { display: inline-flex; width: 7px; height: 7px; align-items: center; justify-content: center; flex: 0 0 7px; }
.pd-reader-status-mark > span:not(.pd-spinner), .pd-reader-status-option-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-secondary); opacity: .6; }
.pd-reader-status-reading .pd-reader-status-mark > span:not(.pd-spinner), .pd-reader-status-option-dot.pd-reader-status-reading { background: var(--pd-accent); opacity: 1; }
.pd-reader-status-read .pd-reader-status-mark > span:not(.pd-spinner), .pd-reader-status-option-dot.pd-reader-status-read { background: var(--pd-accent); opacity: .65; }
.pd-reader-status-archived .pd-reader-status-mark > span:not(.pd-spinner), .pd-reader-status-option-dot.pd-reader-status-archived { opacity: .35; }
.pd-reader-status-caret { font-size: 12px; opacity: .65; }
.pd-reader-status .pd-menu-panel { min-width: 160px; }
.pd-menu-item-check { display: inline-flex; width: 14px; min-width: 14px; margin-left: auto; color: var(--pd-accent); }
.pd-menu-item[aria-checked='true'] { background: color-mix(in srgb, var(--pd-accent) 7%, transparent); }
.pd-reader-row-meta { overflow: visible; flex-wrap: nowrap; white-space: nowrap; column-gap: 14px; }
.pd-reader-metadata { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }
.pd-reader-metadata .pd-reader-authors { flex: 0 1 auto; max-width: 50%; }
.pd-reader-metadata .pd-reader-meta-item { flex: 0 1 auto; }
.pd-reader-metadata .pd-reader-meta-year, .pd-reader-metadata .pd-reader-meta-pages { flex: 0 0 auto; }
.pd-reader-tags { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 5px; flex: 0 1 auto; min-width: 0; max-width: 36%; }
.pd-reader-tag-preview { max-width: 130px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-reader-tags-toggle { flex: 0 0 auto; padding: 2px 5px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.pd-reader-tags-toggle:hover, .pd-reader-tags-toggle[aria-expanded='true'] { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }
.pd-reader-tags-toggle[data-extra='false'], .pd-reader-tags-count { display: none; }
.pd-reader-tags-panel { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; min-width: 220px; max-width: min(360px, calc(100vw - 48px)); padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); box-shadow: var(--dsw-shadow-lv1); white-space: normal; }
.pd-reader-tags-panel > strong { display: block; font-size: 12px; margin-bottom: 10px; color: var(--dsw-alias-label-secondary); font-weight: 500; }
.pd-reader-tags-panel > div { display: flex; flex-wrap: wrap; gap: 7px; max-height: 220px; overflow: auto; }
.pd-reader-tags-panel .pd-tag { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.pd-reader-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); border: 0; white-space: nowrap; }
@container pd (max-width: 1100px) {
  .pd-reader-title { font-size: 19px; }
  .pd-reader-tag-preview, .pd-reader-tags-more { display: none; }
  .pd-reader-tags-count, .pd-reader-tags-toggle[data-extra='false'] { display: inline; }
}
`
