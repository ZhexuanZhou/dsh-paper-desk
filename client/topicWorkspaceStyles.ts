/** Research workspace: document first, independent side panels and a normal composer. */
export const topicWorkspaceCss = `
.pd-topic-layout .pd-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); border: 0; white-space: nowrap; }
.pd-research-layout.pd-topic-layout { position: relative; gap: 0; flex-wrap: nowrap; overflow: hidden; }
.pd-topic-layout [hidden] { display: none !important; }
.pd-topic-layout .pd-research-list { flex: 0 0 var(--pd-topic-list-width); width: var(--pd-topic-list-width); min-width: 0; padding: 0 12px 16px 0; border: 0; }
.pd-topic-layout .pd-research-list h2 { font-size: 18px; margin: 8px 0; }
.pd-topic-layout .pd-topic-row { padding: 12px 10px; line-height: 1.65; overflow-wrap: anywhere; }
.pd-topic-layout .pd-research-editor { flex: 1 1 480px; min-width: 0; overflow: auto; padding: 0 16px 24px; scroll-padding-top: 92px; }
.pd-topic-layout .pd-research-editor > .pd-section-head { padding: 4px 0 16px; margin: 0; gap: 12px; border: 0; }
.pd-topic-layout .pd-section-head h2 { font-size: 23px; line-height: 1.5; }
.pd-topic-layout .pd-topic-toolbar { gap: 4px; }
.pd-topic-layout .pd-topic-toolbar .pd-btn { font-size: 12px; }
.pd-topic-layout .pd-topic-workspace > .pd-topic-analysis { margin: 0; padding: 0 28px 24px; border: 1px solid var(--dsw-alias-border-l1); }
.pd-topic-layout .pd-topic-analysis > header { position: sticky; top: 0; z-index: 2; gap: 12px; margin: 0 auto 20px; padding: 18px 0 12px; max-width: 920px; background: var(--dsw-alias-bg-base); border-bottom: 1px solid var(--dsw-alias-border-l1); align-items: center; flex-wrap: wrap; }
.pd-topic-analysis > header small { display: block; margin-top: 5px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.pd-topic-report-error { flex: 0 0 100%; margin: 0; font-size: 12px; }
.pd-topic-report-actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.pd-topic-report-actions .pd-btn { min-height: 30px; font-size: 12px; }
.pd-topic-report-actions .pd-menu-panel { max-height: 320px; overflow: auto; }
.pd-topic-report-body, .pd-topic-report-hint { max-width: 920px; margin-inline: auto; }
.pd-topic-layout .pd-topic-report-body .pd-md { font-size: 16px; line-height: 1.95; }
.pd-topic-report-body h1, .pd-topic-report-body h2, .pd-topic-report-body h3 { scroll-margin-top: 120px; }
.pd-topic-report-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 24px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 12px; }
.pd-topic-divider { position: relative; flex: 0 0 24px; width: 24px; align-self: stretch; z-index: 5; }
.pd-topic-resizer { position: absolute; inset: 0; cursor: col-resize; touch-action: none; border-radius: 6px; }
.pd-topic-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 11px; width: 1px; background: var(--dsw-alias-border-l1); }
.pd-topic-resizer:hover { background: color-mix(in srgb, var(--pd-accent) 7%, transparent); }
.pd-topic-resizer:hover::after, .pd-topic-layout[data-resizing] .pd-topic-resizer::after { background: var(--pd-accent); }
.pd-topic-resizer:focus-visible { outline: 2px solid var(--pd-accent); outline-offset: -2px; }
.pd-topic-layout[data-resizing] { user-select: none; cursor: col-resize; }
.pd-topic-toggle { position: absolute; top: 50%; transform: translateY(-50%); left: 0; width: 24px; min-height: 40px; padding: 0; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; font: inherit; font-size: 18px; cursor: pointer; }
.pd-topic-toggle:hover, .pd-topic-toggle:focus-visible { color: var(--pd-accent); border-color: var(--pd-accent); outline-offset: 2px; }
.pd-topic-layout .pd-topic-discussion { flex: 0 0 var(--pd-topic-chat-width); width: var(--pd-topic-chat-width); min-width: 0; min-height: 0; padding: 0 0 0 10px; border: 0; gap: 10px; overflow: hidden; }
.pd-topic-discussion-head h3 { margin: 8px 0 4px; font-size: 17px; }
.pd-topic-discussion-head .pd-field-hint { font-size: 12px; line-height: 1.7; margin: 0; }
.pd-topic-layout .pd-topic-focus { flex: 0 0 auto; max-height: 220px; padding: 8px 10px; }
.pd-topic-chat-wrap { position: relative; flex: 1 1 140px; min-height: 100px; overflow: hidden; display: flex; flex-direction: column; }
.pd-topic-layout .pd-topic-chat { padding: 8px 8px 4px 0; overflow: auto; min-height: 0; flex: 1; }
.pd-topic-layout .pd-topic-chat > .pd-ai-turn { padding: 0 0 24px; margin: 0; gap: 12px; }
.pd-topic-layout .pd-topic-chat .pd-ai-user { max-width: 94%; margin: 0; }
.pd-topic-chat-empty { padding: 32px 18px; text-align: center; color: var(--dsw-alias-label-secondary); line-height: 1.8; }
.pd-topic-chat-empty strong { color: var(--dsw-alias-label-primary); font-size: 15px; }
.pd-topic-chat-empty p { font-size: 13px; }
.pd-topic-receipts { display: grid; gap: 8px; }
.pd-topic-receipts > div { display: flex; flex-wrap: wrap; gap: 6px 10px; padding: 12px; border: 1px solid color-mix(in srgb, var(--pd-accent) 20%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--pd-accent) 5%, transparent); }
.pd-topic-receipts strong { flex: 1; font-size: 14px; align-self: center; }
.pd-topic-receipts p { flex: 0 0 100%; order: 1; font-size: 13px; line-height: 1.8; margin: 0; }
.pd-topic-original-reply, .pd-topic-process, .pd-topic-sent-comments { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pd-topic-original-reply summary, .pd-topic-process summary, .pd-topic-sent-comments summary { cursor: pointer; padding: 5px 0; }
.pd-topic-original-reply[open] > .pd-ai-assistant { color: var(--dsw-alias-label-primary); padding-top: 12px; }
.pd-topic-sent-comments blockquote { margin: 10px 0; padding-left: 12px; border-left: 2px solid var(--dsw-alias-border-l1); font-size: 13px; white-space: pre-wrap; }
.pd-topic-latest { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); background: var(--dsw-alias-bg-base); }
.pd-topic-composer { flex: 0 0 auto; min-height: 0; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); border-radius: 10px; padding: 10px; }
.pd-topic-composer:focus-within { border-color: var(--pd-accent); }
.pd-topic-composer-context { max-height: min(36vh, 340px); overflow: auto; }
.pd-topic-layout .pd-topic-composer > textarea { min-height: 84px; max-height: 220px; width: 100%; border: 0; box-shadow: none; padding: 8px 2px; resize: vertical; background: transparent; }
.pd-topic-composer footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.pd-topic-composer footer > span { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.pd-topic-comment-queue > header { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 4px 0 8px; }
.pd-topic-comment-queue > header strong { font-size: 12px; }
.pd-topic-comment-queue > header span { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.pd-topic-comment-item { display: flex; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l1); padding: 8px 0; }
.pd-topic-comment-item details { flex: 1; min-width: 0; }
.pd-topic-comment-item summary { display: flex; flex-direction: column; cursor: pointer; font-size: 13px; line-height: 1.7; }
.pd-topic-comment-item summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-topic-comment-item small, .pd-topic-comment-editor small { color: var(--pd-accent); font-size: 11px; }
.pd-topic-comment-item > div { display: flex; align-items: flex-start; }
.pd-topic-comment-item .pd-btn { padding-inline: 5px; min-height: 28px; font-size: 11px; }
.pd-topic-comment-item blockquote, .pd-topic-comment-editor blockquote { margin: 8px 0; padding: 10px 12px; border-left: 3px solid var(--pd-accent); background: color-mix(in srgb, var(--pd-accent) 5%, transparent); white-space: pre-wrap; font-size: 13px; line-height: 1.75; }
.pd-topic-comment-item pre, .pd-topic-comment-editor pre { overflow: auto; white-space: pre-wrap; font-size: 12px; }
.pd-topic-comment-item p { margin: 8px 0; white-space: pre-wrap; font-size: 13px; }
.pd-topic-comment-editor { padding: 12px; margin-bottom: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.pd-topic-comment-editor > header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.pd-topic-comment-editor details { font-size: 12px; }
.pd-topic-comment-editor summary { cursor: pointer; }
.pd-topic-comment-editor label { display: grid; gap: 6px; font-size: 12px; margin-top: 10px; }
.pd-topic-comment-editor blockquote { max-height: 100px; overflow: auto; }
.pd-topic-layout .pd-topic-comment-editor textarea { min-height: 72px; resize: vertical; width: 100%; line-height: 1.8; }
.pd-topic-comment-editor .pd-research-actions { justify-content: flex-end; margin-top: 8px; }
.pd-topic-layout[data-compact='true'] .pd-research-editor { flex-basis: 100%; padding-inline: 8px; }
.pd-topic-layout[data-compact='true'] .pd-research-list, .pd-topic-layout[data-compact='true'] .pd-topic-discussion { position: absolute; top: 0; bottom: 0; z-index: 21; background: var(--dsw-alias-bg-base); padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; box-shadow: var(--dsw-shadow-lv1); }
.pd-topic-layout[data-compact='true'] .pd-research-list { left: 0; width: min(var(--pd-topic-list-width), calc(100% - 48px)); }
.pd-topic-layout[data-compact='true'] .pd-topic-discussion { right: 0; width: min(var(--pd-topic-chat-width), calc(100% - 48px)); }
.pd-topic-layout[data-compact='true'] .pd-topic-divider { flex-basis: 24px; }
.pd-topic-panel-scrim { position: absolute; inset: 0; z-index: 20; border: 0; background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); cursor: default; }
.pd-topic-layout[data-compact='true'] .pd-topic-divider[data-open='true'] { position: absolute; top: 0; bottom: 0; z-index: 22; }
.pd-topic-layout[data-compact='true'] .pd-topic-divider-list[data-open='true'] { left: min(var(--pd-topic-list-width), calc(100% - 48px)); }
.pd-topic-layout[data-compact='true'] .pd-topic-divider-chat[data-open='true'] { right: min(var(--pd-topic-chat-width), calc(100% - 48px)); }
@container pd (max-width: 700px) { .pd-topic-layout .pd-topic-workspace > .pd-topic-analysis { padding-inline: 16px; } .pd-topic-layout .pd-section-head h2 { font-size: 20px; } .pd-topic-report-actions .pd-btn { padding-inline: 6px; } }
`
