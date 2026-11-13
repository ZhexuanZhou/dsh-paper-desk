/** Focused AI reading workspace; appended after the shared reading styles. */
export const aiReadingCss = `
.pd-annot-rail { width: var(--pd-drawer-width, 360px); }
.pd-annot-rail[data-tab="ai"] { width: var(--pd-drawer-width, 560px); max-width: min(680px, 55%); container-type: inline-size; container-name: pd-assistant; }
.pd-ai { min-width: 0; overflow: visible; background: var(--dsw-alias-bg-base); }
.pd-ai .pd-chat-bar { flex: 0 0 auto; min-height: 52px; padding: 9px 20px; gap: 8px; background: transparent; }
.pd-ai .pd-chat-select { height: 32px; padding: 3px 24px 3px 0; border-color: transparent; border-radius: 4px; background-color: transparent; font: inherit; font-size: 14px; font-weight: 600; text-overflow: ellipsis; }
.pd-ai .pd-chat-select:focus-visible { outline: 2px solid var(--pd-accent); outline-offset: 2px; }
.pd-ai .pd-chat-rename { min-height: 32px; height: auto; font-size: 14px; }
.pd-ai .pd-chat-confirm { width: 100%; padding: 8px 0 2px; font-size: 13px; }
.pd-ai .pd-chat-bar > .pd-btn-icon, .pd-ai .pd-chat-more > .pd-btn-icon { border-color: transparent; background: transparent; min-height: 30px; width: 30px; }
.pd-ai .pd-menu-panel { font-size: 13px; z-index: 30; }
.pd-ai-body { min-width: 0; }
.pd-ai .pd-ai-scroll { min-width: 0; padding: 26px 24px 12px; gap: 24px; overscroll-behavior: contain; scroll-padding-bottom: 20px; }
.pd-ai .pd-ai-user { align-self: stretch; max-width: 100%; padding: 14px 16px; border-radius: 8px; background: color-mix(in srgb, var(--pd-accent) 8%, transparent); font-size: calc(15px * var(--pd-ai-font-scale, 1)); line-height: 1.75; }
.pd-ai-user-label { display: block; margin-bottom: 3px; color: var(--pd-accent); font-size: 12px; font-weight: 600; }
.pd-ai .pd-ai-assistant, .pd-ai .pd-ai-assistant .pd-md { font-size: calc(16px * var(--pd-ai-font-scale, 1)); line-height: 1.85; overflow-wrap: anywhere; }
.pd-ai .pd-ai-assistant .pd-md > :first-child { margin-top: 0; }
.pd-ai .pd-ai-assistant .pd-md > :last-child { margin-bottom: 0; }
.pd-ai .pd-ai-assistant .pd-md h1 { font-size: calc(23px * var(--pd-ai-font-scale, 1)); line-height: 1.45; }
.pd-ai .pd-ai-assistant .pd-md h2 { font-size: calc(21px * var(--pd-ai-font-scale, 1)); line-height: 1.5; margin: 1.4em 0 .7em; }
.pd-ai .pd-ai-assistant .pd-md h3 { font-size: calc(18px * var(--pd-ai-font-scale, 1)); line-height: 1.55; margin: 1.3em 0 .65em; }
.pd-ai .pd-ai-assistant .pd-md h4, .pd-ai .pd-ai-assistant .pd-md h5, .pd-ai .pd-ai-assistant .pd-md h6 { font-size: 1em; }
.pd-ai .pd-ai-assistant .pd-md p, .pd-ai .pd-ai-assistant .pd-md ul, .pd-ai .pd-ai-assistant .pd-md ol { margin: 1em 0; }
.pd-ai .pd-ai-assistant .pd-md li { margin: .65em 0; }
.pd-ai .pd-ai-assistant .pd-md li > p { margin: .4em 0; }
.pd-ai .pd-ai-assistant .pd-md blockquote { margin: 1.2em 0; padding: 4px 0 4px 16px; border-left: 3px solid color-mix(in srgb, var(--pd-accent) 45%, transparent); }
.pd-ai .pd-ai-assistant .pd-md pre { font-size: 13px; line-height: 1.65; max-width: 100%; overflow: auto; }
.pd-ai .pd-ai-assistant .pd-md table { font-size: 13px; line-height: 1.65; }
.pd-ai .pd-ai-row { gap: 10px; }
.pd-ai .pd-ai-row-actions { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
.pd-ai .pd-ai-row-actions .pd-btn { min-height: 30px; padding: 4px 6px; border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pd-ai .pd-ai-cites { display: flex; align-items: center; gap: 6px; padding: 5px 0 0; }
.pd-ai .pd-ai-cites > span { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-right: 3px; }
.pd-ai .pd-ai-cite { font-size: 12px; padding: 3px 7px; min-height: 26px; border-color: transparent; background: color-mix(in srgb, var(--pd-accent) 6%, transparent); }
.pd-ai .pd-ai-reasoning { border: 0; padding: 0; }
.pd-ai .pd-ai-reasoning summary { font-size: 12px; }
.pd-ai .pd-ai-reasoning .pd-md { font-size: 14px; line-height: 1.8; }
.pd-ai .pd-ai-thinking { font-size: 13px; padding: 6px 0; }
.pd-ai .pd-ai-empty { max-width: 360px; margin: auto; padding: 28px 0; font-size: 14px; line-height: 1.8; }
.pd-ai-empty > svg { color: var(--pd-accent); }
.pd-ai-empty h3 { margin: 14px 0 8px; color: var(--dsw-alias-label-primary); font-size: 20px; font-weight: 600; }
.pd-ai-empty p { margin: 0; }
.pd-ai-starters { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.pd-ai .pd-ai-starters .pd-btn { font-size: 13px; min-height: 34px; padding: 6px 12px; }
.pd-ai .pd-ai-history { display: flex; flex-direction: column; gap: 24px; }
.pd-ai .pd-ai-history-title { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.pd-ai .pd-ai-notes-tray { display: block; flex: 0 0 auto; margin: 4px 0; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: transparent; }
.pd-ai-notes-tray > summary { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-size: 12px; color: var(--pd-accent); cursor: pointer; list-style: none; }
.pd-ai-notes-tray > summary::-webkit-details-marker { display: none; }
.pd-ai-notes-content { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 0 12px 12px; }
.pd-ai .pd-ai-notes-chips { display: flex; flex-direction: column; width: 100%; align-items: stretch; overflow: visible; gap: 6px; }
.pd-ai .pd-ai-note-chip { padding: 8px; white-space: normal; text-align: left; max-width: 100%; max-height: none; font-size: 13px; line-height: 1.65; }
.pd-ai .pd-ai-foot { flex: 0 0 auto; margin: 12px 14px 14px; padding: 12px; gap: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: transparent; }
.pd-ai .pd-ai-foot:focus-within { border-color: color-mix(in srgb, var(--pd-accent) 65%, var(--dsw-alias-border-l2)); }
.pd-ai .pd-ai-inputRow { display: block; }
.pd-ai .pd-ai-input { display: block; width: 100%; min-height: 58px; max-height: 150px; padding: 2px 0 4px; border: 0; box-shadow: none; outline: none; border-radius: 0; background: transparent; font-size: 14px; line-height: 1.65; resize: vertical; }
.pd-ai-compose-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pd-ai-compose-actions > .pd-btn-icon { width: 30px; min-height: 30px; border: 0; background: transparent; }
.pd-ai-task-select { min-width: 0; max-width: 45%; min-height: 30px; padding: 3px 4px; border: 0; border-radius: 4px; color: var(--dsw-alias-label-secondary); background: transparent; font: inherit; font-size: 12px; }
.pd-ai-task-select:focus-visible { outline: 2px solid var(--pd-accent); }
.pd-ai-send-hint { flex: 1 1 auto; text-align: right; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.pd-ai-compose-actions > .pd-btn-primary { min-height: 32px; padding: 5px 12px; border-radius: 6px; }
.pd-ai-attachments { display: flex; flex-wrap: wrap; gap: 6px; }
.pd-ai-page-chip { display: inline-flex; align-items: center; max-width: 100%; padding: 1px 3px 1px 7px; gap: 3px; border-radius: 6px; background: color-mix(in srgb, var(--pd-accent) 9%, transparent); color: var(--pd-accent); }
.pd-ai-page-chip > button:first-child { min-width: 0; padding: 3px 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.pd-ai-page-chip > .pd-btn-icon { width: 22px; min-height: 24px; padding: 3px; border: 0; background: transparent; color: inherit; }
.pd-ai-page-editor { padding: 2px 0 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-ai-page-editor label { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.pd-ai-page-editor input { flex: 1 1 auto; min-width: 0; font-size: 13px; }
.pd-ai-page-editor-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.pd-ai-page-editor-actions > span { flex: 1 1 150px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.pd-ai-page-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
@container pd-assistant (max-width: 400px) {
  .pd-ai .pd-ai-scroll { padding: 20px 16px 10px; gap: 20px; }
  .pd-ai .pd-chat-bar { padding: 8px 14px; }
  .pd-ai .pd-ai-foot { margin: 10px; padding: 10px; }
  .pd-ai-send-hint { visibility: hidden; font-size: 0; }
}
@container pd (max-width: 900px) {
  .pd-annot-rail[data-tab="ai"] { max-width: min(560px, 100%); }
}

@container pd (max-width: 720px) {
  .pd-annot-rail[data-tab="ai"] { position: fixed; inset: 12px; width: auto; max-width: none; min-height: 0; z-index: 40; background: var(--dsw-alias-bg-base); }
}
.pd-card-editor { width: min(820px, 100%); max-height: min(90dvh, 960px); background: var(--dsw-alias-bg-base); }
.pd-card-editor .pd-modal-head { padding: 20px 28px; }
.pd-card-editor .pd-modal-title { font-size: 18px; }
.pd-card-editor .pd-modal-body { padding: 24px 32px; gap: 20px; }
.pd-card-editor .pd-modal-desc { margin: 0; font-size: 13px; line-height: 1.7; }
.pd-card-editor .pd-field-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pd-card-editor .pd-card-editor-title { min-height: 44px; padding: 4px 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; font-size: 22px; font-weight: 600; line-height: 1.5; }
.pd-card-editor-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 12px; }
.pd-card-editor-toolbar h3 { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
.pd-card-editor-modes { display: flex; align-items: center; gap: 4px; }
.pd-card-editor-modes .pd-btn { min-height: 30px; font-size: 12px; }
.pd-card-editor-modes .pd-btn[aria-pressed="true"] { color: var(--pd-accent); background: color-mix(in srgb, var(--pd-accent) 9%, transparent); }
.pd-card-editor-preview { min-height: 220px; }
.pd-card-editor-preview .pd-md { font-size: 16px; line-height: 1.9; overflow-wrap: anywhere; }
.pd-card-editor-preview .pd-md > :first-child { margin-top: 0; }
.pd-card-editor-preview .pd-md h1 { font-size: 24px; line-height: 1.5; }
.pd-card-editor-preview .pd-md h2 { font-size: 21px; line-height: 1.5; margin: 1.4em 0 .7em; }
.pd-card-editor-preview .pd-md h3 { font-size: 18px; line-height: 1.6; }
.pd-card-editor-preview .pd-md p, .pd-card-editor-preview .pd-md ol, .pd-card-editor-preview .pd-md ul { margin: 1em 0; }
.pd-card-editor-preview .pd-md li { margin: .7em 0; }
.pd-card-editor-preview .pd-md pre, .pd-card-editor-preview .pd-md table { max-width: 100%; overflow: auto; font-size: 13px; }
.pd-card-editor-empty { color: var(--dsw-alias-label-secondary); font-size: 14px; }
.pd-card-editor .pd-card-editor-source { width: 100%; min-height: 320px; font-size: 14px; line-height: 1.8; padding: 16px; }
.pd-card-editor-source-pages { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pd-card-editor-source-pages > span:first-child { margin-right: 5px; }
.pd-card-editor-disclosure { align-self: flex-start; padding: 5px 0; border: 0; color: var(--pd-accent); background: transparent; font: inherit; font-size: 13px; cursor: pointer; }
.pd-card-editor-metadata { display: flex; flex-direction: column; gap: 14px; }
.pd-card-editor .pd-card-context { margin: 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); border-radius: 0; padding-top: 12px; }
.pd-card-editor .pd-card-context-head { padding: 4px 0; }
.pd-card-editor .pd-card-context-toggle { font-size: 13px; color: var(--pd-accent); padding: 4px 0; }
.pd-card-context-expanded > p { margin: 8px 0 12px; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.pd-card-editor .pd-card-context-list { max-height: 280px; margin-top: 12px; padding: 0; gap: 0; }
.pd-card-editor .pd-card-context-turn { gap: 10px; padding: 12px 0; border-top-style: solid; font-size: 13px; line-height: 1.75; }
.pd-card-editor .pd-card-context-text { max-height: none; overflow: visible; line-height: 1.75; }
.pd-card-editor .pd-modal-foot { padding: 16px 28px; gap: 10px; background: var(--dsw-alias-bg-base); }
.pd-card-editor .pd-modal-foot .pd-btn { min-height: 36px; padding: 7px 16px; font-size: 13px; }
@media (max-width: 720px) {
  .pd-card-editor .pd-modal-head, .pd-card-editor .pd-modal-foot { padding: 16px 20px; }
  .pd-card-editor .pd-modal-body { padding: 20px; }
  .pd-card-editor .pd-card-editor-title { font-size: 20px; }
}
`
