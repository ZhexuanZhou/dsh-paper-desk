# PaperDesk features 2 — note cards, paper comparison, relation graph

Three linked knowledge features on top of the existing reader/notes/AI panel.
Types are already in `src/types.ts` (`NoteCard`, `CardsDocument`, `NewNoteCard`,
`PaperRelation`, `RelationsDocument`, `NewRelation`, `RelationKind`,
`PaperComparison`, `ComparisonSummary`). The compare task already exists in
`AssistTask` and `src/prompt.ts` (`comparePrompt`).

## 1. Note cards from AI answers

* Every assistant answer in the AI drawer gets an inline action **「生成卡片」**
  next to 保存到笔记/复制 (per message, not only the last one).
* Clicking it opens a small prefilled editor: title (first heading/line of the
  answer, trimmed), body = the answer Markdown, tags (optional), pages
  (auto-extracted from `p.N` citations, hidden/editable as chips).
* Saving posts to the Host and the card appears in the **笔记 tab's cards rail**
  (right column, 260–280px; editor keeps the left column). Cards can be edited,
  deleted, copied, inserted into notes (append a Markdown block), or clicked to
  jump to their pages.
* Host storage: `papers/<id>/cards.json` (atomic, sync-friendly, corrupt-file
  quarantine to `.paperdesk/conflicts/cards-<ts>.json`).
* Agent tool: `paper_cards` (read one paper's cards; useful distilled context).
  `paper_info` gains a `cards` count.

Markdown block inserted into notes:

```markdown
### 卡片：<title>
- 来源：p.N / 2026-11-06
<body>
```

## 2. Multi-paper comparison

* Library toolbar gets **「对比」**: opens a full-panel overlay (`CompareView`).
* Overlay left/step 1: paper picker (search + checkbox, 2–6 papers, preselect
  current library order); step 2: comparison workspace:
  - **元数据对比矩阵** instant (title/authors/year/venue/status/tags/pages/DOI),
  - **生成 AI 对比** button: calls `POST /assist {task:'compare', paperIds}` →
    runs the returned prompt in a dedicated AI thread (`openThread`), streams the
    Markdown report in the overlay,
  - **保存对比** persists the report via `/comparisons`; saved comparisons are
    listed (title, papers, date, preview) and can be reopened/deleted.
* Host storage: `<root>/comparisons/<id>.json` (top-level folder, syncs with the
  library; atomic writes).
* The AI report ends with suggested relations (`- [kind] A ↔ B: reason`); the
  overlay parses those lines and offers **「加入图谱」** per suggestion (calls
  `/relations`), which is the bridge to feature 3.

## 3. Paper relation graph

* Typed undirected edges between papers: `cites | related | method | contrast |
  same-topic | custom`, with optional label/note/source. Stored in
  `.paperdesk/relations.json` (`RelationsDocument`), atomic, deduped by
  unordered pair+kind, validated against existing paper ids.
* Library toolbar gets **「关系图谱」**: full-panel overlay (`RelationsGraph`):
  - force-directed SVG graph (own tiny simulation, no new dependencies): nodes =
    papers (radius by degree, label = short title), edges colored by kind with a
    legend; drag nodes, wheel zoom, pan; hover highlights neighbors; click node
    = focus + open paper; click edge = popover (kind/label/note + delete).
  - Tabs 图谱 / 列表; list shows edges with from/to/kind/note and delete.
  - **添加关联** modal: pick source paper (default focus), target paper
    (searchable), kind, optional label/note.
  - Empty state explains how relations are created (manual or from comparison
    suggestions).
* Reader integration: a compact **关联 N** chip in the header row 1 opens the
  graph overlay focused on the current paper (ego network + all edges).
* Agent tool: `paper_relations` (read the graph; used by prompts/analysis).
  `paper_info` gains `relations` count (outgoing+incoming).

## 4. Host API additions (base `/api/paper-desk`)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/cards?id` | — | `CardsDocument` |
| POST | `/cards?id` | `NewNoteCard` | `CardsDocument` |
| PATCH | `/cards?id&cardId` | `{title?,body?,tags?,pages?}` | `CardsDocument` |
| DELETE | `/cards?id&cardId` | — | `CardsDocument` |
| GET | `/relations` | — | `RelationsDocument` |
| POST | `/relations` | `NewRelation` | `RelationsDocument` |
| PATCH | `/relations?relationId` | `{kind?,label?,note?}` | `RelationsDocument` |
| DELETE | `/relations?relationId` | — | `RelationsDocument` |
| GET | `/comparisons` | `?id` optional | `{ comparisons: ComparisonSummary[] }` or `PaperComparison` |
| POST | `/comparisons` | `{title, paperIds, markdown}` | `PaperComparison` |
| DELETE | `/comparisons?id` | — | `{ ok: true }` |
| POST | `/assist` | `{task:'compare', paperIds}` | `AssistPayload` |

All existing validation rules apply: `paperId` regex, `safeJoin`, body caps,
atomic writes, 404 mapping via `status` property on domain errors.

## 5. Host module contracts (owner: host-graph)

### `src/cards.ts`
```ts
export const CARDS_FILE = 'cards.json'
export async function readCards(root: string, paperId: string): Promise<CardsDocument>
export async function addCard(root: string, paperId: string, input: NewNoteCard): Promise<CardsDocument>
export async function updateCard(root: string, paperId: string, cardId: string, patch: Partial<Pick<NoteCard, 'title' | 'body' | 'tags' | 'pages'>>): Promise<CardsDocument>
export async function removeCard(root: string, paperId: string, cardId: string): Promise<CardsDocument>
export function cardToMarkdown(card: NoteCard): string
export function cardCount(root: string, paperId: string): Promise<number>   // cheap summary for paper_info
```
Validation: title 1..200 chars, body 1..20000, tags ≤12 strings ≤40, pages ints
1..999 ≤20, source default 'ai', id `c-<8hex>`, item cap 200, atomic write,
corrupt quarantine, `updatedAt` refresh.

### `src/relations.ts`
```ts
export const RELATIONS_FILE = 'relations.json'   // inside .paperdesk/
export async function readRelations(root: string): Promise<RelationsDocument>
export async function addRelation(root: string, input: NewRelation): Promise<RelationsDocument>
export async function updateRelation(root: string, relationId: string, patch: { kind?: RelationKind; label?: string; note?: string }): Promise<RelationsDocument>
export async function removeRelation(root: string, relationId: string): Promise<RelationsDocument>
export function relationForPaper(doc: RelationsDocument, paperId: string): { outgoing: PaperRelation[]; incoming: PaperRelation[] }
```
Validation: from≠to, both ids must exist as `papers/<id>/meta.json`, kind enum,
label ≤80, note ≤1000, dedupe unordered pair+kind (Error 'relation already
exists'), id `r-<8hex>`, cap 2000, atomic, corrupt quarantine.

### `src/comparisons.ts`
```ts
export const COMPARISONS_DIR = 'comparisons'
export async function listComparisons(root: string): Promise<ComparisonSummary[]>
export async function readComparison(root: string, id: string): Promise<PaperComparison | null>
export async function saveComparison(root: string, input: { title: string; paperIds: string[]; markdown: string }): Promise<PaperComparison>
export async function updateComparison(root: string, id: string, patch: { title?: string; markdown?: string }): Promise<PaperComparison>
export async function deleteComparison(root: string, id: string): Promise<void>
```
Validation: paperIds 2..6 existing ids, markdown 1..60000, title 1..200 (default
from paper titles), id `cmp-<YYYYMMDD-HHmmss>-<4hex>`, folder created lazily,
atomic writes, corrupt files skipped in the list (never throw).

## 6. Client contracts

### 6.1 `client/aiSession.ts` extension (owner: ai-bridge)
Add to `AiThreadController`:
```ts
openThread(threadKey: string, options: AiThreadOptions): Promise<void>
```
`openPaper(paperId, opts)` becomes `openThread(paperId, {..., title: 'AI · …'})`.
State gains `threadKey: string | null` (keep `paperId` for compatibility = the
key when it is a paper id, else null). Cache key becomes
`paperdesk:ai-thread:<threadKey>`; read legacy `paperdesk:ai-session:<key>` first
for migration. Everything else unchanged.

### 6.2 `client/RelationsGraph.tsx` (owner: relations-ui)
Container overlay component; fetches papers/relations via `api` on open.
```ts
export interface RelationGraphLabels { … }   // own labels object, zh+en via fragment
export interface RelationsGraphProps {
  open: boolean
  focusPaperId?: string | null
  labels: RelationGraphLabels
  onClose: () => void
  onOpenPaper: (paperId: string) => void
}
export function RelationsGraph(props: RelationsGraphProps): ReactElement | null
export const relationsDict: Record<'zh' | 'en', Record<string, string>>
export const relationsCss: string
```
Own CSS string + dict fragment (Lead merges both into `styles.ts` / `i18n.ts`).
Force layout: ≤200 nodes OK; SVG viewBox with zoom/pan; deterministic seed.

### 6.3 `client/CompareView.tsx` (owner: compare-ui)
```ts
export interface CompareViewProps {
  open: boolean
  ctx: ClientContext
  initialPaperIds?: string[]
  labels: CompareLabels
  onClose: () => void
  onOpenPaper: (paperId: string) => void
}
export const compareDict: Record<'zh' | 'en', Record<string, string>>
export const compareCss: string
```
Flow: picker (search + checkboxes 2..6) → matrix (metadata) + AI report via
`createAiThread(ctx).openThread('compare:' + sortedIds.join(','), {workspacePath,title})`
then `api.assist(..., {task:'compare', paperIds})` → `thread.run(prompt)`; render
AiThread rows minimally (user/assistant/tool/error) with markdown; 保存对比 →
`api.saveComparison`; saved list from `api.comparisons()` with open/delete;
parse `- [kind] A ↔ B: reason` lines → 加入图谱 buttons (`api.addRelation`).

### 6.4 Existing UI integration (owner: client-ui)
* `AiPanel`: per-assistant-row action 「生成卡片」 (new prop
  `onCreateCard?: (row: AiRow) => void`); Notes tab gains a cards rail (list,
  edit/delete/insert-to-notes/copy, jump pages) + count; App handlers call the
  new `/cards` API and refresh the doc.
* LibraryView toolbar: two buttons 「对比」「关系图谱」 opening the two overlays;
  LibraryView gains `ctx` and passes `onOpenPaper` (select paper in the reader).
* ReaderView header row 1: `关联 N` chip beside 批注/AI toggles (opens graph
  overlay focused on the paper) — count from App-loaded relations.
* App: fetch `api.relations()` with status/papers; keep in state; pass counts and
  overlay callbacks; `ctx` threading.

## 7. Ownership

| owner | files |
|---|---|
| host-graph | `src/cards.ts`, `src/relations.ts`, `src/comparisons.ts` |
| ai-bridge | `client/aiSession.ts` |
| relations-ui | `client/RelationsGraph.tsx` (self-contained: CSS + dict fragment) |
| compare-ui | `client/CompareView.tsx` (self-contained: CSS + dict fragment) |
| client-ui | `client/AiPanel.tsx`, `client/ReaderView.tsx`, `client/App.tsx`, `client/LibraryView.tsx`, `client/NotesEditor.tsx`, `client/i18n.ts` (cards keys only), `client/styles.ts` (cards keys only) |
| lead | `src/types.ts` (done), `src/prompt.ts` (done), `src/http.ts`, `src/tools.ts`, `client/api.ts`, merging dict/CSS fragments, build/install/verify |

## 8. Verification (Lead, headless Chrome + API)

1. Cards: AI answer → 生成卡片 → card in notes rail → edit → insert into notes →
   reload persists; `/cards` API round-trip.
2. Relations: add 2 edges (different kinds) via UI → graph renders nodes/edges,
   drag/zoom, edge delete; reload persists; `/relations` validation rejects
   self/dup/unknown ids.
3. Compare: pick 2 papers → metadata matrix → 生成 AI 对比 streams a report
   (real agent, in-panel) → 保存对比 → reopen from saved list → 加入图谱 creates
   relation(s).
4. Regression: existing reader/notes/annotations/AI single-paper flows, sync,
   settings, import unaffected.
