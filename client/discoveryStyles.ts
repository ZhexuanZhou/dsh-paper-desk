export const discoveryCss = `
.pd-discovery-workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.pd-discovery-modebar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-discovery-modebar > span { display: flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pd-discovery-workspace > .pd-discover-layout { flex: 1; }
.pd-agent-discovery-layout { display: flex; flex: 1; gap: 32px; min-height: 0; }
.pd-discovery-history { flex: 0 0 190px; overflow: auto; padding-right: 20px; border-right: 1px solid var(--dsw-alias-border-l1); }
.pd-discovery-history-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.pd-discovery-history h3 { margin: 0; font-size: 14px; }
.pd-discovery-history-row { display: flex; align-items: center; gap: 3px; }
.pd-discovery-history-row > .pd-topic-row { flex: 1; min-width: 0; }
.pd-discovery-history-row > .pd-btn { flex: 0 0 auto; padding: 4px; font-size: 11px; }
.pd-discovery-history .pd-topic-row { margin-top: 6px; font-size: 13px; line-height: 1.65; }
.pd-discovery-history .pd-topic-row > span { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.pd-discovery-history .pd-topic-row small { margin-top: 5px; font-size: 11px; }
.pd-discovery-content { flex: 1; min-width: 0; overflow: auto; padding: 0 16px 48px 0; }
.pd-discovery-content > * { max-width: 960px; margin-inline: auto; }
.pd-discovery-heading { margin-bottom: 24px; }
.pd-discovery-heading h2 { margin: 0 0 8px; font-size: 26px; line-height: 1.4; }
.pd-discovery-heading p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 1.8; }
.pd-discovery-composer { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 18px 20px 14px; transition: border-color .15s; }
.pd-discovery-composer:focus-within { border-color: var(--pd-accent); }
.pd-discovery-composer label { display: block; margin-bottom: 12px; font-size: 14px; font-weight: 600; }
.pd-discovery-composer textarea { display: block; box-sizing: border-box; width: 100%; min-height: 100px; max-height: 300px; resize: vertical; padding: 0; border: 0; border-radius: 0; box-shadow: none; outline: none; color: inherit; background: transparent; font: inherit; font-size: 15px; line-height: 1.85; }
.pd-discovery-composer textarea:focus { box-shadow: none; outline: none; }
.pd-discovery-composer textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: .8; }
.pd-discovery-composer-foot { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding-top: 12px; }
.pd-discovery-composer-foot > span { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.pd-discovery-composer-foot .pd-btn { flex-shrink: 0; }
.pd-discovery-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
.pd-discovery-privacy { margin-block: 12px 28px; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.8; }
.pd-discovery-start h3 { font-size: 14px; font-weight: 500; margin: 0 0 12px; }
.pd-discovery-examples { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.pd-discovery-examples button { display: flex; justify-content: space-between; gap: 12px; padding: 16px; text-align: left; font: inherit; font-size: 13px; line-height: 1.8; color: inherit; background: transparent; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; cursor: pointer; }
.pd-discovery-examples button:hover { background: color-mix(in srgb, var(--pd-accent) 6%, transparent); }
.pd-discovery-examples button span { color: var(--dsw-alias-label-secondary); }
.pd-discovery-start > p { margin-top: 18px; }
.pd-discovery-result { padding-top: 8px; }
.pd-discovery-result > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.pd-discovery-eyebrow { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.pd-discovery-result h3 { margin: 8px 0 0; font-size: 18px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.pd-discovery-result > header > span { display: flex; align-items: center; gap: 6px; flex-shrink: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; padding-top: 4px; }
.pd-discovery-process { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 16px 0 24px; }
.pd-discovery-process summary { cursor: pointer; padding-block: 6px; }
.pd-discovery-process ol { max-height: 180px; overflow: auto; line-height: 1.8; overflow-wrap: anywhere; }
.pd-discovery-warning { margin-block: 20px; padding: 14px 16px; background: color-mix(in srgb, var(--pd-accent) 7%, transparent); border-radius: 8px; font-size: 13px; line-height: 1.8; }
.pd-discovery-warning p { margin: 4px 0 0; }
.pd-discovery-answer { margin-bottom: 32px; }
.pd-discovery-answer > h4, .pd-discovery-sources > h4 { margin: 0 0 14px; font-size: 15px; }
.pd-discovery-answer .pd-md { font-size: 15px; line-height: 1.95; }
.pd-discovery-answer .pd-md h1 { font-size: 23px; }
.pd-discovery-answer .pd-md h2 { font-size: 20px; }
.pd-discovery-answer .pd-md h3 { font-size: 17px; }
.pd-discovery-source { display: flex; gap: 16px; padding: 22px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.pd-discovery-source-number { color: var(--pd-accent); font-size: 12px; padding-top: 4px; flex: 0 0 22px; }
.pd-discovery-source > div { flex: 1; min-width: 0; }
.pd-discovery-source a { color: inherit; text-decoration: none; }
.pd-discovery-source a:hover { text-decoration: underline; }
.pd-discovery-source h5 { margin: 0 0 7px; font-size: 16px; line-height: 1.65; }
.pd-discovery-source p { margin: 10px 0; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.pd-discovery-source-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 12px; font-size: 12px; }
.pd-discovery-source-actions > a { color: var(--pd-accent); }
.pd-discovery-result > .pd-btn { margin-top: 22px; }
@container pd (max-width: 1000px) {
  .pd-discovery-history { flex-basis: 160px; padding-right: 12px; }
  .pd-agent-discovery-layout { gap: 20px; }
  .pd-discovery-examples { grid-template-columns: 1fr; }
}
@container pd (max-width: 650px) {
  .pd-agent-discovery-layout { flex-direction: column; overflow: auto; }
  .pd-discovery-history { flex: 0 0 auto; border-right: 0; padding: 0; max-height: 150px; }
  .pd-discovery-history > p { display: none; }
  .pd-discovery-content { flex: 0 0 auto; overflow: visible; padding-right: 0; }
  .pd-discovery-composer { padding: 16px; }
  .pd-discovery-composer-foot { align-items: flex-start; flex-direction: column; }
  .pd-discovery-composer-foot .pd-discovery-actions { align-self: flex-end; }
  .pd-discovery-result > header { flex-wrap: wrap; }
}
`
