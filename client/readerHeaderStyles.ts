/** Title with status, metadata, left-aligned tags, then document navigation. */
export const readerHeaderCss = `
.pd-reader-head { padding-bottom: 8px; }
.pd-reader-row-title { flex-wrap: wrap; align-items: flex-start; column-gap: 16px; row-gap: 6px; }
.pd-reader-title-group { display: flex; align-items: flex-start; gap: 12px; flex: 1 1 480px; min-width: 0; }
.pd-reader-title { flex: 0 1 auto; min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: normal; overflow-wrap: anywhere; font-size: 21px; line-height: 1.45; }
.pd-reader-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 2px; margin-left: auto; }
.pd-reader-actions > .pd-btn, .pd-reader-actions > .pd-menu > .pd-btn { height: 30px; min-height: 30px; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; box-shadow: none; }
.pd-reader-actions > .pd-btn:hover:not(:disabled), .pd-reader-actions > .pd-menu > .pd-btn:hover:not(:disabled), .pd-reader-actions > .pd-menu > .pd-btn[data-active='true'] { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }
.pd-reader-actions .pd-btn:focus-visible, .pd-reader-tags-toggle:focus-visible { outline: 2px solid var(--pd-accent); outline-offset: 2px; }
.pd-reader-status { --pd-status-color: var(--dsw-alias-label-secondary); flex: 0 0 auto; margin-top: 2px; }
.pd-reader-status.pd-reader-status-reading { --pd-status-color: var(--pd-accent); }
.pd-reader-status.pd-reader-status-read { --pd-status-color: var(--pd-status-read); }
.pd-reader-status.pd-reader-status-archived { --pd-status-color: color-mix(in srgb, var(--dsw-alias-label-secondary) 70%, var(--dsw-alias-label-primary)); }
.pd-reader-status > .pd-btn { min-height: 28px; height: auto; padding: 4px 11px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--pd-status-color) 11%, var(--pd-page-bg)); color: var(--pd-status-color); font-size: 12px; font-weight: 600; box-shadow: none; }
.pd-reader-status > .pd-btn:hover:not(:disabled), .pd-reader-status > .pd-btn[aria-expanded='true'] { background: color-mix(in srgb, var(--pd-status-color) 18%, var(--pd-page-bg)); }
.pd-reader-status-label { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.pd-reader-status-mark { display: inline-flex; width: 7px; height: 7px; align-items: center; justify-content: center; flex: 0 0 7px; }
.pd-reader-status-mark > span:not(.pd-spinner), .pd-reader-status-option-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--pd-status-color, var(--dsw-alias-label-secondary)); opacity: 1; }
.pd-reader-status-option-dot { --pd-status-color: var(--dsw-alias-label-secondary); }
.pd-reader-status-option-dot.pd-reader-status-reading { --pd-status-color: var(--pd-accent); }
.pd-reader-status-option-dot.pd-reader-status-read { --pd-status-color: var(--pd-status-read); }
.pd-reader-status-option-dot.pd-reader-status-archived { --pd-status-color: var(--dsw-alias-label-secondary); opacity: .7; }
.pd-reader-status .pd-menu-panel { min-width: 150px; padding: 5px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--pd-page-bg); color: var(--dsw-alias-label-primary); box-shadow: 0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
.pd-reader-status .pd-menu-item { min-height: 32px; padding: 6px 9px; border-radius: 5px; color: var(--dsw-alias-label-primary); font-size: 12px; }
.pd-reader-status .pd-menu-item[aria-checked='true'] { color: var(--pd-status-color); background: color-mix(in srgb, var(--pd-status-color) 8%, transparent); }
.pd-menu-item-check { display: inline-flex; width: 14px; min-width: 14px; margin-left: auto; color: var(--pd-accent); }
.pd-menu-item[aria-checked='true'] { background: color-mix(in srgb, var(--pd-accent) 7%, transparent); }
.pd-reader-row-meta { overflow: visible; flex-wrap: nowrap; white-space: nowrap; column-gap: 14px; }
.pd-reader-metadata { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }
.pd-reader-metadata .pd-reader-authors { flex: 0 1 auto; max-width: 50%; }
.pd-reader-metadata .pd-reader-meta-item { flex: 0 1 auto; }
.pd-reader-metadata .pd-reader-meta-year, .pd-reader-metadata .pd-reader-meta-pages { flex: 0 0 auto; }
.pd-reader-row-tags { padding-top: 0; padding-bottom: 4px; }
.pd-reader-tags { display: flex; align-items: flex-start; justify-content: flex-start; flex-wrap: wrap; gap: 6px; min-width: 0; width: 100%; }
.pd-reader-tag-list { display: contents; }
.pd-reader-tag-preview { max-width: min(220px, 100%); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; padding: 2px 6px; }
.pd-reader-tags[data-expanded='true'] .pd-reader-tag-preview { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.pd-reader-tags-toggle { flex: 0 0 auto; min-height: 22px; padding: 2px 6px; border: 0; border-radius: 4px; background: color-mix(in srgb, var(--pd-accent) 7%, transparent); color: var(--pd-accent); font: inherit; font-size: 11px; cursor: pointer; }
.pd-reader-tags-toggle:hover, .pd-reader-tags-toggle[aria-expanded='true'] { background: color-mix(in srgb, var(--pd-accent) 12%, transparent); }
.pd-reader-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); border: 0; white-space: nowrap; }
@container pd (max-width: 1100px) {
  .pd-reader-title { font-size: 19px; }
}
`
