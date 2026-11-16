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
.pd-ai .pd-ai-user { align-self: stretch; max-width: 100%; border: 0; border-left: 2px solid var(--dsw-alias-border-l2); border-radius: 0; padding: 2px 0 2px 12px; background: transparent; font-size: calc(14px * var(--pd-ai-font-scale, 1)); line-height: 1.7; }
.pd-ai .pd-ai-user-label { margin-bottom: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
.pd-ai-question-text, .pd-ai-question > p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.pd-ai-question summary { cursor: pointer; list-style: none; }
.pd-ai-question summary::-webkit-details-marker { display: none; }
.pd-ai-question summary > span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.pd-ai-question summary > small { display: block; padding-top: 4px; font-size: 12px; color: var(--pd-accent); }
.pd-ai-question[open] summary > span { display: none; }
.pd-ai-question-collapse, .pd-ai-question[open] .pd-ai-question-expand { display: none; }
.pd-ai-question[open] .pd-ai-question-collapse { display: inline; }
.pd-ai-question[open] > p { margin-top: 6px; }
.pd-ai-process { padding: 0; border: 0; min-width: 0; }
.pd-ai-process > summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; min-height: 32px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; list-style: none; }
.pd-ai-process > summary::-webkit-details-marker { display: none; }
.pd-ai-process > summary::before { content: '›'; font-size: 17px; line-height: 1; transition: transform .15s; }
.pd-ai-process[open] > summary::before { transform: rotate(90deg); }
.pd-ai-process > summary small { font-size: 11px; }
.pd-ai-process-content { margin: 6px 0 4px 5px; padding-left: 14px; border-left: 1px solid var(--dsw-alias-border-l2); max-height: 300px; overflow: auto; }
.pd-ai-process-step { padding: 8px 0; }
.pd-ai-process-step + .pd-ai-process-step { border-top: 1px solid var(--dsw-alias-border-l1); }
.pd-ai-process-step .pd-md { font-size: 13px; line-height: 1.75; color: var(--dsw-alias-label-secondary); }
.pd-ai-process-step .pd-md > :first-child { margin-top: 0; }
.pd-ai-process-step .pd-md > :last-child { margin-bottom: 0; }
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
.pd-ai .pd-ai-assistant ::selection, ::highlight(paperdesk-answer-selection) { background-color: #d9e5dd; color: #1d3025; }
.pd-ai-selection-editor { flex: 0 0 auto; min-height: 0; max-height: 48%; overflow: auto; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); }
.pd-ai-selection-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.pd-ai-selection-head strong { font-size: 13px; font-weight: 600; }
.pd-ai-selection-head .pd-btn { min-height: 30px; width: 30px; }
.pd-ai-selection-quote { margin: 0 0 12px; padding: 10px 12px; max-height: 112px; overflow: auto; border-left: 3px solid var(--pd-accent); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--pd-accent) 7%, transparent); color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.pd-ai .pd-ai-selection-comment { display: block; width: 100%; min-height: 68px; max-height: 140px; padding: 9px 11px; font-size: 14px; line-height: 1.6; resize: vertical; }
.pd-ai-selection-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.pd-ai-selection-actions .pd-btn { min-height: 34px; padding: 6px 10px; font-size: 13px; }
@container pd-assistant (max-width: 400px) {
  .pd-ai-selection-editor { padding: 10px 12px; }
  .pd-ai-selection-quote { max-height: 84px; }
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

.pd-version-history { width: min(1000px, 96vw); }
.pd-version-history .pd-modal-body { padding: 16px 24px; min-height: 0; }
.pd-version-layout { display: grid; grid-template-columns: minmax(180px, 26%) minmax(0, 1fr); min-height: 260px; gap: 24px; }
.pd-version-list { display: flex; flex-direction: column; gap: 8px; max-height: 58dvh; overflow: auto; }
.pd-version-list button { display: flex; flex-direction: column; gap: 5px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; text-align: left; color: var(--dsw-alias-label-primary); background: transparent; font: inherit; font-size: 13px; cursor: pointer; }
.pd-version-list button[aria-pressed="true"] { border-color: var(--pd-accent); background: color-mix(in srgb, var(--pd-accent) 8%, transparent); }
.pd-version-list span, .pd-version-list small { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pd-version-preview { max-height: 58dvh; overflow: auto; padding: 4px 12px 12px 0; min-width: 0; }
.pd-version-preview .pd-md { font-size: 15px; line-height: 1.85; }
.pd-version-preview article + article { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.pd-version-feedback p { margin: 0 0 12px; font-size: 13px; }
.pd-version-feedback [role="alert"] { color: var(--dsw-alias-state-error-primary); }
@media (max-width: 640px) {
  .pd-version-layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .pd-version-list { max-height: 150px; }
  .pd-version-preview { max-height: 42dvh; }
}

/* Assistant workspace follows the library's flat surfaces and restrained borders. */
.pd-annot-rail[data-tab="ai"] { background: var(--dsw-alias-bg-base); }
.pd-annot-rail[data-tab="ai"] .pd-drawer-tabs { min-height: 44px; padding: 6px 14px; gap: 6px; }
.pd-annot-rail[data-tab="ai"] .pd-drawer-tab { min-height: 32px; padding: 6px 9px; font-size: 13px; }
.pd-ai .pd-chat-bar { padding: 12px 16px 8px; min-height: 52px; gap: 6px; border-bottom: 0; }
.pd-chat-picker { min-width: 0; flex: 1 1 auto; }
.pd-chat-picker > .pd-btn { width: 100%; border: 0; background: transparent; padding: 5px 2px; min-height: 32px; justify-content: space-between; gap: 10px; font-size: 14px; font-weight: 600; }
.pd-chat-picker > .pd-btn > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-chat-picker .pd-menu-panel { left: 0; right: auto; width: min(360px, 78vw); max-width: calc(100cqw - 32px); max-height: 50dvh; overflow: auto; }
.pd-chat-picker .pd-menu-item { white-space: normal; line-height: 1.6; text-align: left; }
.pd-ai .pd-chat-new { min-height: 32px; padding: 5px 7px; font-size: 12px; white-space: nowrap; }
.pd-chat-rename-form { display: flex; flex: 1 1 auto; align-items: center; gap: 6px; min-width: 0; }
.pd-ai .pd-chat-rename { flex: 1 1 auto; height: 34px; padding: 6px 8px; font-size: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; }
.pd-ai-document-nav { display: flex; align-items: center; flex: 0 0 auto; gap: 6px; padding: 0 16px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-ai-document-nav > span { flex: 1 1 auto; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.pd-ai-document-nav .pd-btn { min-height: 28px; padding: 4px 7px; font-size: 12px; }
.pd-ai .pd-ai-body { flex-direction: column; }
.pd-ai .pd-ai-scroll { padding: 24px 22px 14px; gap: 22px; }
.pd-ai .pd-ai-assistant .pd-md h1 { font-size: calc(21px * var(--pd-ai-font-scale, 1)); }
.pd-ai .pd-ai-assistant .pd-md h2 { font-size: calc(19px * var(--pd-ai-font-scale, 1)); }
.pd-ai .pd-ai-assistant .pd-md table { display: block; width: max-content; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 13px; line-height: 1.7; }
.pd-ai .pd-ai-assistant .pd-md th, .pd-ai .pd-ai-assistant .pd-md td { padding: 9px 11px; min-width: 90px; max-width: 320px; overflow-wrap: anywhere; vertical-align: top; }
.pd-ai .pd-ai-assistant .pd-md th { font-weight: 600; background: color-mix(in srgb, var(--pd-accent) 5%, transparent); }
.pd-ai .pd-ai-row-actions { border-top: 1px solid var(--dsw-alias-border-l1); margin-top: 8px; padding-top: 6px; }
.pd-ai .pd-ai-cites { flex-wrap: wrap; }
.pd-ai .pd-ai-jump { position: static; transform: none; align-self: center; flex: 0 0 auto; margin: 4px 0 8px; padding: 6px 12px; min-height: 30px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; box-shadow: none; background: var(--dsw-alias-bg-base); font-size: 12px; }
.pd-ai .pd-ai-foot { margin: 10px 14px 14px; padding: 12px 14px 8px; border-radius: 8px; background: var(--dsw-alias-bg-base); }
.pd-ai .pd-ai-input { resize: none; min-height: 64px; max-height: 168px; overflow-y: auto; line-height: 1.7; }
.pd-ai .pd-ai-foot:focus-within { border-color: var(--pd-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--pd-accent) 12%, transparent); }
@container pd-assistant (max-width: 400px) {
  .pd-ai .pd-chat-bar { padding: 10px 12px 6px; }
  .pd-ai-document-nav { padding: 0 12px 8px; }
  .pd-ai .pd-ai-scroll { padding: 18px 16px 10px; }
  .pd-ai .pd-ai-foot { margin: 8px 10px 10px; }
  .pd-ai .pd-chat-new { font-size: 11px; padding: 4px; }
}
`
