/** Reuse reader surfaces, accent, typography and discussion controls. */
export const reproductionCss = `
.pd-reproduction-panel { overflow: hidden; }
.pd-reproduction { display: flex; position: relative; flex: 1; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.pd-reproduction-document { flex: 1 1 520px; min-width: 0; min-height: 0; overflow: auto; padding: 0 24px 28px; background: var(--pd-page-bg); border: 0; border-radius: 0; scroll-padding-top: 110px; scrollbar-gutter: stable; }
.pd-reproduction-toolbar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px 0; margin: 0 auto 16px; max-width: 900px; background: var(--pd-page-bg); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-reproduction-toolbar h3 { margin: 0; font-size: 18px; font-weight: 650; line-height: 1.5; }
.pd-reproduction-toolbar p { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.7; }
.pd-reproduction-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.pd-reproduction-actions > .pd-btn { min-height: 30px; font-size: 12px; }
.pd-reproduction-verification { border-radius: 5px; padding: 2px 7px; color: var(--pd-accent); background: color-mix(in srgb, var(--pd-accent) 8%, transparent); }
.pd-reproduction-context, .pd-reproduction-feedback, .pd-reproduction-progress, .pd-reproduction-reading-controls, .pd-reproduction-body, .pd-reproduction-editor { max-width: 900px; margin: 0 auto; }
.pd-reproduction-context { margin-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 0 0 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pd-reproduction-context > summary { width: fit-content; cursor: pointer; padding: 4px 0; line-height: 1.8; }
.pd-reproduction-context > div, .pd-reproduction-context > label { padding-top: 12px; }
.pd-reproduction-context p { margin: 6px 0; line-height: 1.8; }
.pd-reproduction-context a { display: block; width: fit-content; color: var(--pd-accent); overflow-wrap: anywhere; margin-top: 7px; }
.pd-reproduction-requirements { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.pd-reproduction-requirements > textarea { width: 100%; min-height: 88px; max-height: 220px; resize: vertical; padding: 10px 12px; border-color: var(--dsw-alias-border-l2); font-size: 14px; line-height: 1.8; border-radius: 8px; }
.pd-reproduction-requirements > small { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.7; }
.pd-reproduction-empty { max-width: 900px; padding: 4px 0 24px; margin: 0 auto; }
.pd-reproduction-empty .pd-reproduction-requirements { max-width: 680px; }
.pd-reproduction-empty > .pd-btn { margin-top: 16px; }
.pd-reproduction-feedback { margin-bottom: 12px; font-size: 13px; line-height: 1.8; }
.pd-reproduction-feedback > p { margin: 6px 0; }
.pd-reproduction-feedback details { max-height: 360px; overflow: auto; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.pd-reproduction-feedback details > summary { cursor: pointer; }
.pd-reproduction-progress { display: flex; align-items: center; gap: 10px; min-height: 42px; color: var(--pd-accent); font-size: 13px; margin-bottom: 12px; }
.pd-reproduction-progress > span:nth-child(2) { flex: 1; }
.pd-reproduction-outline nav { display: grid; gap: 3px; padding: 8px 0; }
.pd-reproduction-outline button { text-align: left; border: 0; padding: 5px 8px; border-radius: 5px; color: var(--dsw-alias-label-primary); background: transparent; font: inherit; font-size: 13px; line-height: 1.8; cursor: pointer; }
.pd-reproduction-outline button:hover, .pd-reproduction-outline button:focus-visible { background: color-mix(in srgb, var(--pd-accent) 8%, transparent); }
.pd-reproduction-reading-controls { display: flex; align-items: center; justify-content: space-between; min-height: 34px; gap: 8px; margin-bottom: 8px; }
.pd-reproduction-reading-controls > span { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.pd-reproduction-body .pd-md { font-size: 16px; line-height: 1.95; overflow-wrap: anywhere; }
.pd-reproduction-body h1 { font-size: 25px; line-height: 1.6; margin: 24px 0; }
.pd-reproduction-body h2 { font-size: 21px; line-height: 1.65; margin: 36px 0 16px; padding-top: 22px; border-top: 1px solid var(--dsw-alias-border-l1); }
.pd-reproduction-body h3 { font-size: 17px; line-height: 1.7; margin: 26px 0 12px; }
.pd-reproduction-body h1, .pd-reproduction-body h2, .pd-reproduction-body h3 { scroll-margin-top: 120px; }
.pd-reproduction-body .pd-md table { font-size: 14px; line-height: 1.85; }
.pd-reproduction-body .pd-md pre { font-size: 13px; line-height: 1.8; }
.pd-reproduction-citations { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding-top: 10px; }
.pd-reproduction-resources { max-height: 240px; overflow: auto; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); scrollbar-gutter: stable; }
.pd-reproduction-editor.pd-textarea { display: block; width: 100%; min-height: 56vh; resize: vertical; font-family: ui-monospace, monospace; font-size: 14px; line-height: 1.85; padding: 16px; }
.pd-reproduction .pd-topic-discussion { display: flex; flex-direction: column; }
.pd-reproduction .pd-topic-chat .pd-ai-user { margin-left: auto; }
.pd-reproduction .pd-field-hint { line-height: 1.8; }
.pd-reader[data-tab='reproduction'] .pd-assist-inline { display: none; }
.pd-reproduction[data-compact='true'] .pd-reproduction-document { padding-inline: 16px; }
@container pd (max-width: 700px) { .pd-reproduction-toolbar { gap: 8px; } .pd-reproduction-toolbar h3 { font-size: 16px; } .pd-reproduction-actions > .pd-btn { padding-inline: 7px; } .pd-reproduction-body .pd-md { font-size: 15px; } }
`
