# PaperDesk relations v2 — manual editing, AI discovery, citation extraction

Follow-up to DESIGN-FEATURES.md §3. Three additions, all opt-in from the
relation graph overlay; nothing writes edges without the user seeing it except
the explicit "补全引用" action (and the import-time auto-citation toggle).

## 1. Manual edge editing (UI gap)

Today the graph supports add + delete only; `PATCH /relations` exists but no UI.
Add:
* Edge popover gets **编辑**: inline form (kind `<select>`, label input, note
  textarea, 保存/取消) → `api.updateRelation(id, {kind,label,note})`; graph and
  list update from the returned document.
* List rows get **编辑** too (same form as a small modal or inline row editor).
* Validation errors from the API shown inline; duplicate kind change → 409 message.

## 2. AI relation discovery (semi-automatic, user confirms)

* Graph header gets **「发现关联」**. Flow:
  1. `createAiThread(ctx)` → `openThread('relations:discover', { workspacePath
     from api.status(), title: '关系发现 · N 篇论文' })`.
  2. `api.assistDiscover()` (new) → `POST /assist {task:'discover'}` returns the
     prompt (lists every paper: id/title/authors/year/venue/abstract snippet and
     existing edges; instructs 5–15 candidates in exact line format, no fabric-
     ation, skip existing pairs, reads only metadata/notes/cards unless needed).
  3. `thread.run(prompt)`; while running show a compact status (spinner +
     "Agent 正在分析 N 篇论文…", 停止 button, optional collapsible reasoning).
  4. On settle, parse the report for `- [kind] 论文A ↔ 论文B：理由` lines (reuse
     the compare parser semantics: English kinds + Chinese labels, ↔/⇄/<>,
     ASCII or full-width colon), resolve names to papers (full/truncated title,
     first-author surname + year, `paper N`), drop existing/unresolvable pairs,
     show candidate cards with checkbox (default checked), kind chip, reason,
     both paper titles, and 加入选中 / 全选.
  5. 加入选中 → sequential `api.addRelation` (409 = already exists → skip,
     other errors shown per card); refresh graph/list; summary toast
     ("新增 N 条，跳过 M 条").
* Candidates are NOT written until the user clicks; nothing auto-adds.
* Session reuse: same thread key on reopening keeps the last discovery report.

## 3. Citation edges from PDF references (auto, toggleable)

### Host `src/references.ts` (owner: host-core)
```ts
export interface ReferenceHit {
  page: number
  raw: string
  doi?: string
  arxivId?: string
}
export interface CitationCandidate {
  toId: string
  via: 'doi' | 'arxiv' | 'title'
  reference: string
  confidence: number      // 0..1
}
export interface CitationSyncResult {
  scanned: number
  added: PaperRelation[]
  skipped: number         // pairs already linked / low confidence
  skippedNoText: string[] // papers whose text could not be extracted
  errors: string[]
}
export async function extractReferences(root: string, paperId: string): Promise<{ hits: ReferenceHit[]; pages: number[] }>
export async function findCitationCandidates(root: string, paperId: string, index: PaperIndex): Promise<CitationCandidate[]>
export interface PaperIndex { byDoi: Map<string, string>; byArxiv: Map<string, string>; byTitle: Map<string, { id: string; tokens: Set<string> }> }
export async function buildPaperIndex(root: string): Promise<PaperIndex>
export async function syncCitationEdges(root: string, ids?: string[], opts?: { maxPapers?: number }): Promise<CitationSyncResult>
```
Behaviour:
* Text: `ensureText(root, id, {pdfAbs, sha})` (existing cache reused; extraction
  allowed, bounded by pdf.ts); if it throws → push to skippedNoText and continue.
* References section detection: look at pages in the last 45% of the paper for a
  heading line matching `/^\s*(references|bibliography|works cited|参考文献|引用文献)\s*$/i`
  (allow leading numbering); take the rest of that page and following pages as
  the reference block (cap 60 000 chars). If no heading, fall back to scanning
  the last 3 pages for DOI/arXiv patterns (lower confidence).
* Hits: split the block on blank lines or lines starting with `[n]`/`n.` where
  plausible; keep chunks 20..2000 chars; extract DOI via normalizeDoi + regex
  `10.\d{4,9}/[^\s"'<>]+`, arXiv via `arXiv:\s*(\d{4}\.\d{4,5})` / `abs/(\d{4}\.\d{4,5})`.
* Matching: DOI exact (confidence 1.0), arXiv exact (0.95), title containment:
  normalize (lowercase, strip punctuation), require the paper title's token set
  to be ≥4 tokens and ⊆ reference tokens with ≥0.9 coverage (0.8 confidence);
  never match the paper to itself.
* `syncCitationEdges`: ids default = every paper, capped at `maxPapers ?? 20`;
  for each paper add edges `{from,to,kind:'cites',label:'自动解析',note: raw.slice(0,280),source:'agent'}`
  via relations.addRelation; a 409 duplicate counts as skipped; other errors →
  errors[]. Return added relation snapshots. Sequential, ~1–3 s/paper with cached
  text.

### HTTP
* `POST /relations/citations` body `{ ids?: string[] }` → `CitationSyncResult`
  (400 when ids is malformed/empty array; capped 20).
* `POST /assist` gains task `'discover'` (no paperId required) → AssistPayload via
  `discoverRelationsPrompt(papers, relations, settings)`.

### Settings (all layers)
* `citationSync: boolean` default **false** added to `Config`, `SettingsFile`,
  `EffectiveSettings`, `validateSettingsInput`, POST /settings, client
  `SettingsPatch`, Settings UI toggle "导入后自动解析参考文献补引用".
* When enabled, the client after a successful import calls
  `api.citationsSync([newPaperId])` in the background and shows a toast with the
  result (added/skipped). Manual action is always available in the graph.

### UI
* Graph header (or an overflow menu next to 添加关联): **「从参考文献补全引用」**
  → confirm dialog ("会抽取未解析的 PDF 文本，可能较慢") → `api.citationsSync()`
  → summary toast + refresh graph/list; errors shown in a dismissible banner.
* Settings page: toggle above; helper text explains it only creates `cites` edges
  between papers already in the library.

## 4. Contracts / ownership

| owner | files |
|---|---|
| host-core | `src/references.ts` |
| relations-ui | `client/RelationsGraph.tsx` (edit edge, discover panel, citations action; props gain `ctx: ClientContext`), own dict/CSS extension |
| client-ui | `client/App.tsx` (pass ctx + citationSync auto-trigger after import + refresh relations), `client/SettingsView.tsx` toggle, `client/i18n.ts` settings keys |
| lead | `src/types.ts`, `src/config.ts`, `src/settings.ts`, `src/prompt.ts` (discover prompt), `src/http.ts`, `client/api.ts`, build/install/verify |

## 5. Verification

1. Manual edit: change an edge kind/label/note in UI → graph+list update; reload persists; validation/duplicate messages surface.
2. Discovery: temp library with ≥2 papers → 发现关联 → candidates appear (names resolved, existing pairs excluded) → 加入选中 → edges created; nothing added if cancelled.
3. Citations: synthetic PDFs where paper B's References section contains paper A's DOI/title → 补全引用 creates B→A `cites`; rerun is idempotent (all skipped); toggle on → import a paper whose references cite an existing one → toast + new edge.
4. Regression: existing relation graph/manual add/delete, compare, cards, reader/AI.
5. Clean up temp data/sessions/workspace; panel-only screenshots updated; commit+push.


## 6. Verification log (lead, live)

* Manual edit: edge popover 编辑 changed a `cites` edge to `method` with label/note → returned document persisted (`method | 手动编辑：方法迁移 | 验收手动修改关联类型与备注`), graph+list refreshed.
* Discovery: real AI thread on a 2-paper library produced 7 candidates (one disabled as an existing pair), 6 selected → 加入选中 added 3 typed edges (`same-topic`, `related`, `contrast`); nothing written before the click.
* Citations: synthetic pair where B's References section cites A's DOI → `POST /relations/citations` extracted the DOI hit, resolved A, created `B→A cites 自动解析`; rerun reported `skipped` (idempotent). App auto-trigger on import (citationSync=true) imported Gamma → toast 已补全引用：新增 1 条 + `gamma→alpha cites`.
* Metadata guard: importing a PDF whose reference list contains another paper's DOI no longer stores that DOI on the importing paper (references section is cut before the DOI guess).
* Parallel edges: reversed-direction relations for one pair now fan out (green/red arcs) instead of overlapping.
* Settings: citationSync toggle renders in 设置; manual action banner shows `已解析 N 篇 · 新增 X 条引用 · 跳过 Y 条`.
