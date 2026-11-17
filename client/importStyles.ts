export const importCss = `
.pd-import-dialog { width: min(560px, calc(100vw - 32px)); }
.pd-import-dialog .pd-modal-head { padding: 20px 24px 16px; }
.pd-import-dialog .pd-modal-title { font-size: 19px; }
.pd-import-dialog .pd-modal-body { padding: 0 24px 22px; gap: 0; }
.pd-import-intro { margin: 0 0 22px; font-size: 13px; line-height: 1.8; color: var(--dsw-alias-label-secondary); }
.pd-import-tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-import-tabs > button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 10px 2px 12px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; cursor: pointer; }
.pd-import-tabs > button[aria-selected="true"] { border-bottom-color: var(--pd-accent); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pd-import-tabs > button:focus-visible { outline: 2px solid var(--pd-accent); outline-offset: 3px; border-radius: 2px; }
.pd-import-tabs > button:disabled { opacity: .6; cursor: wait; }
.pd-import-panel { padding-top: 22px; }
.pd-import-dropzone { display: flex; flex-direction: column; align-items: center; padding: 30px 20px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; text-align: center; background: color-mix(in srgb, var(--dsw-alias-label-primary) 2%, transparent); }
.pd-import-dropzone[data-dragging="true"] { border-color: var(--pd-accent); background: color-mix(in srgb, var(--pd-accent) 8%, transparent); }
.pd-import-mark { display: flex; padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--pd-accent) 8%, transparent); color: var(--pd-accent); }
.pd-import-dropzone h3 { margin: 16px 0 6px; font-size: 16px; font-weight: 600; }
.pd-import-dropzone p { margin: 0 0 20px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.8; }
.pd-import-dialog .pd-btn { min-height: 36px; padding: 7px 16px; font-size: 13px; }
.pd-import-url-form { display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.pd-import-url-form > label { font-size: 13px; font-weight: 600; }
.pd-import-url-form > .pd-input { width: 100%; min-height: 42px; padding: 10px 12px; font-size: 14px; }
.pd-import-url-help p { margin: 0 0 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.8; }
.pd-import-url-form > .pd-btn { align-self: flex-end; margin-top: 8px; }
.pd-import-error { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent); border-radius: 6px; color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.pd-import-footnote { margin: 20px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.8; }
.pd-import-status { display: flex; align-items: flex-start; gap: 10px; margin-top: 20px; padding: 12px 0 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 13px; }
.pd-import-status > .pd-spinner { margin-top: 3px; flex-shrink: 0; }
.pd-import-status strong { font-weight: 500; }
.pd-import-status p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.7; }
@container pd (max-width: 540px) {
  .pd-import-dialog .pd-modal-head { padding: 18px 16px 14px; }
  .pd-import-dialog .pd-modal-body { padding: 0 16px 18px; }
  .pd-import-dropzone { padding: 24px 12px; }
}
`
