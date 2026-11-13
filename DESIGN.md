# PaperDesk (dsh-paper-desk) — implementation contract

A native DeepSeek Harness Web GUI plugin (Host half + browser half) that manages a
paper library in a plain directory:

* import PDFs (upload, host path, or drop into the library `_inbox/`),
* metadata: PDF/XMP extraction, filename heuristics, optional Crossref enrichment,
* per-paper markdown notes with canonical sections, highlights with page anchors,
* agent tools (`paper_*`) so any session can list/search/read papers and write notes,
* one-click agent assist sessions (summary / method / critique / related / Q&A),
* cloud-drive friendly storage: every piece of state is a normal file, sync status,
  external-change detection and conflict copies.

Everything is JSON-serializable; the Host never keeps private state that cannot be
rebuilt from the library directory.

---

## 1. Non-negotiable rules

1. `src/types.ts` is the shared contract. Do not change it without telling the Lead.
2. Only touch the files assigned to you (see §7). Never edit another agent's files.
3. TypeScript strict (`noUncheckedIndexedAccess`). Node 20+ APIs only on the Host.
4. All library file access must go through `safeJoin` (inside the root) and must
   reject paths escaping the root. Never follow a client-supplied absolute path
   except in the explicit import-by-path route, which validates `isFile()`.
5. Writes to `meta.json` / `notes.md` are **atomic** (tmp file + rename) and respect
   the conflict protocol (§2.4).
6. UI text is localized through the client locale dictionaries (`zh` + `en`), all
   visible strings, no hard-coded English in JSX. Class names are prefixed `pd-`.
7. The page renders in the native `main` panel. Do not inject DOM, do not use an
   iframe for the page itself (a PDF `<iframe>` inside the reader is fine).
8. Read `references/practices.md` from the `cordis-plugin-development` skill for
   Harness UI rules (theme tokens, slots, effects, no cross-plugin DOM).

---

## 2. Library layout on disk

```
<root>/                          # user-chosen directory, may live in iCloud/Dropbox
  papers/
    <paperId>/
      meta.json                  # PaperMeta (src/types.ts)
      notes.md                   # markdown notes, no frontmatter
      annotations.json           # PDF annotations (highlight/underline/note/question)
      paper.pdf                  # original PDF (name fixed)
      text.json                  # extracted text cache (rebuildable, optional)
  _inbox/                        # *.pdf dropped here are imported by "扫描收件箱"
  .paperdesk/
    scan.json                    # ScanSnapshot: relPath → size/mtime fingerprints
    conflicts/                   # conflict copies, never overwritten
      <paperId>-<timestamp>-<deviceShort>.md
    trash/                       # deleted papers (move, never unlink)
      <paperId>-<timestamp>/
    cache/                       # transient (safe to delete)
```

`paperId` = `slug(title|fileBase)-<8 hex of sha256(pdf bytes | fallback)>`, ASCII
`[a-z0-9-]`, max 64 chars. Duplicate detection: same PDF sha256 ⇒ return the
existing paper id with `duplicated: true` and do not create a second directory.

### 2.1 `meta.json`

Exactly `PaperMeta` in `src/types.ts` (`schemaVersion: 1`). Unknown keys are
preserved on update (spread before patch). `updatedAt` is refreshed on every write.

### 2.2 `notes.md`

Canonical section headings depend on language:

| key            | zh heading   | en heading        |
|----------------|--------------|-------------------|
| `summary`      | `## 摘要`    | `## Summary`      |
| `points`       | `## 要点`    | `## Key points`   |
| `questions`    | `## 疑问`    | `## Open questions` |
| `quotes`       | `## 引用`    | `## Quotes`       |
| `thoughts`     | `## 我的想法`| `## My take`      |
| `conversation` | `## 对话与补充` | `## Conversation notes` |

`initialNotesMarkdown()` writes `# 笔记：<title>` plus empty canonical sections.
`appendToNotes` inserts the block at the end of the matching section (creating the
section before the next known heading if absent). Appended blocks:

```markdown
- 2026-11-06 15:02 · agent
  text line 1
  text line 2
```

For quotes: `> p.<page> "…text…"` followed by the attribution line.
Reading a section back is best-effort; never throw on malformed notes.

### 2.3 `text.json`

`ExtractedText` from `src/types.ts`: per-page text from pdfjs-dist, `lowText` when
`< 200` total non-space chars across the first 3 pages.

### 2.4 Conflict protocol (the core of cloud sync safety)

* A note write carries `baseHash` — the `hash` from the `NotesDocument` the client
  loaded. If the on-disk hash differs, the write is **not** applied; instead the
  incoming content is written to `.paperdesk/conflicts/` and the result reports
  `{ ok: false, conflict: true, conflictPath }` (HTTP 409). `writeNotes` without
  `baseHash` always wins (explicit overwrite).
* `meta.json` writes: read-modify-write under one process (no `baseHash`), but
  preserve unknown keys so another device's extra fields are not destroyed.
* `scan.json` detects external changes (other devices / Finder / agents). Files under
  `.paperdesk/` are excluded from the delta.

---

## 3. Host modules — exact signatures

Implement to these signatures. Import types with `import type` (verbatimModuleSyntax).

### 3.1 `src/util.ts` (owner: host-core)

```ts
export function readPackageJson(): { name?: string; version?: string } | undefined
export function nowIso(): string
export function sha256(data: string | Uint8Array): string       // lowercase hex
export function sha256File(absPath: string): Promise<string>
export function safeJoin(root: string, relPath: string): string  // throws on escape
export function relOf(root: string, abs: string): string         // posix, confined
export function isExcluded(relPath: string, exclude: string[]): boolean
export function slugify(text: string, maxLen?: number): string
export async function atomicWrite(absPath: string, data: string | Uint8Array): Promise<void>
export async function readJsonFile<T>(absPath: string): Promise<T | undefined>
export async function writeJsonFile(absPath: string, value: unknown): Promise<void>
export async function fileInfo(absPath: string): Promise<{ size: number; mtimeMs: number } | null>
export function posixJoin(...parts: string[]): string
```

### 3.2 `src/config.ts` (owner: host-core)

```ts
export type Language = 'zh' | 'en'
export interface Config {
  libraryPath: string
  language: Language
  enrich: boolean
  autoImportInbox: boolean
  maxPdfBytes: number
}
export const Config: Schema<Config>   // @deepseek-ai/schemastery, with .default() on every field
```
Defaults: `libraryPath: ''`, `language: 'zh'`, `enrich: true`,
`autoImportInbox: true`, `maxPdfBytes: 26214400` (25 MiB).

### 3.3 `src/settings.ts` (owner: host-core)

Settings live in `$DSH_HOME/paper-desk/settings.json` (`$DSH_HOME` defaults to
`~/.dsh`); the device id lives in `$DSH_HOME/paper-desk/device.json`.
Priority for `libraryPath`: settings.json > cordis config > env
`DSH_PAPER_DESK_LIBRARY`.

```ts
export interface SettingsFile {
  libraryPath?: string
  language?: Language
  enrich?: boolean
  autoImportInbox?: boolean
  maxPdfBytes?: number
}
export function settingsHome(): string
export function settingsFilePath(): string
export function loadSettings(): SettingsFile                  // mtime-cached, {} on corrupt
export function effectiveSettings(base: Config): EffectiveSettings   // from types.ts
export function saveSettings(update: SettingsFile): SettingsFile     // merge, empty string clears
export function validateSettingsInput(input: Record<string, unknown>): string | null
export function isDirectory(p: string): boolean
export function deviceId(): string                            // stable per host, persisted
export function deviceShort(): string                         // first 8 chars of deviceId
```

`effectiveSettings().source` is `'file' | 'config' | 'env' | 'none'`; `libraryPath`
is `path.resolve()`d and `''` when unset. `settingsFile` is the absolute path.

### 3.4 `src/pdf.ts` (owner: pdf-meta)

```ts
export async function extractText(absPath: string): Promise<ExtractedText>
export async function pdfPageCount(absPath: string): Promise<number | null>
export async function isPdfFile(absPath: string): Promise<boolean>
export async function readTextCache(root: string, paperId: string): Promise<ExtractedText | null>
export async function ensureText(
  root: string,
  paperId: string,
  opts: { pdfAbs: string; sha: string; force?: boolean },
): Promise<ExtractedText>
export function pageText(text: ExtractedText, page: number): string
export function searchInText(text: ExtractedText, query: string, cap?: number):
  { page: number; snippet: string } | null
```

`extractText` uses `pdfjs-dist/legacy/build/pdf.mjs` with
`{ useWorkerFetch: false, isEvalSupported: false, disableFontFace: true,
cMapUrl: <pkg>/cmaps/, cMapPacked: true, standardFontDataUrl: <pkg>/standard_fonts/ }`
resolved from `pdfjs-dist/package.json` via `createRequire(import.meta.url)`.
Cap: 40 pages per call are plenty for agents, but extraction caches **all** pages,
truncating each page to 20 000 chars. Throw a descriptive Error when the PDF is
encrypted/unreadable; callers degrade to `text: null`.

`ensureText` returns the cached document when `sourceSha256 === sha` unless `force`.

### 3.5 `src/metadata.ts` (owner: pdf-meta)

```ts
export interface CrossrefRecord {
  title?: string
  authors?: string[]
  year?: number | null
  venue?: string
  doi?: string
  url?: string
  abstract?: string
}
export interface PdfGuess {
  title?: string
  authors: string[]
  year?: number | null
  doi?: string
  arxivId?: string
  venue?: string
  abstract?: string
}
export async function guessFromPdf(absPath: string): Promise<PdfGuess>       // XMP/Info + page-1 text
export function guessFromFileName(fileName: string): PdfGuess
export async function crossrefByDoi(doi: string, signal?: AbortSignal): Promise<CrossrefRecord | null>
export async function crossrefSearch(query: string, signal?: AbortSignal): Promise<CrossrefRecord | null>
export function normalizeDoi(text: string): string | undefined               // strip https://doi.org/, trailing punctuation
export function mergeGuess(base: PdfGuess, extra: CrossrefRecord): PdfGuess
```

Rules: 8 s timeout (`AbortSignal.timeout`), `User-Agent: dsh-paper-desk/<version>
(mailto:paperdesk@example.invalid)` (Crossref etiquette), never throw to callers —
return `null` and let the route report `ok:false`. Strip HTML/JATS tags from
Crossref abstracts. `guessFromPdf` prefers PDF metadata Title/Author, falls back to
the largest font-block heuristic on page 1 or the first non-empty line; DOI/arXiv id
via regex over the first two pages. `year` from a 19xx/20xx match near the DOI or in
the filename; never guess a year < 1900 or > current+1.

### 3.6 `src/sync.ts` (owner: pdf-meta)

```ts
export function detectCloud(root: string): CloudInfo
export async function scanSnapshot(root: string): Promise<ScanSnapshot>
export async function loadSnapshot(root: string): Promise<ScanSnapshot | null>
export async function saveSnapshot(root: string, snap: ScanSnapshot): Promise<void>
export async function computeDelta(root: string): Promise<{ delta: ScanDelta; scannedAt: string }>
export async function listConflicts(root: string): Promise<ConflictEntry[]>
export async function listEvicted(root: string): Promise<{ relPath: string; paperId: string | null }[]>
export async function syncStatus(root: string, device: string): Promise<SyncStatus>
export async function writeConflictCopy(
  root: string, paperId: string, relTarget: string, content: string, device: string,
): Promise<string>                                             // returns relPath under .paperdesk/conflicts
export async function resolveConflict(
  root: string, relPath: string, action: 'use-conflict' | 'discard-conflict',
): Promise<{ ok: boolean; message?: string }>
export async function downloadEvicted(root: string, relPath: string): Promise<{ ok: boolean; message?: string }>
```

Details:
* `detectCloud` path patterns (`~/Library/Mobile Documents/com~apple~CloudDocs` ⇒
  `icloud`; `CloudStorage/OneDrive`/`OneDrive` ⇒ `onedrive`; `Dropbox` ⇒ `dropbox`;
  `Nutstore`/`坚果云` ⇒ `nutstore`; `BaiduNetdisk`/`百度网盘` ⇒ `baidu`;
  `Sync`/`.stfolder` ⇒ `syncthing`; otherwise `local`). Labels (zh): `iCloud 云盘`,
  `OneDrive`, `Dropbox`, `坚果云`, `百度网盘`, `Syncthing`, `本地目录`.
* `scanSnapshot` walks `papers/` + `_inbox/` + root `*.pdf`, excludes
  `.paperdesk/`, `.git/`, hidden dirs, returns sorted `FileFingerprint[]`.
  `computeDelta` diffs stored snapshot (in memory) against the fresh walk, persists,
  returns the delta. `removed` = relPaths gone.
* `writeConflictCopy` names `<paperId>-<YYYYMMDD-HHmmss>-<deviceShort>.md`
  (`.json` for meta conflicts) and writes atomically; never overwrite.
  Conflict copies include a 3-line header comment identifying source path, time and
  device, then the content.
* `resolveConflict('use-conflict')` copies the conflict file over its target
  (`papers/<id>/notes.md` / `meta.json`, derived from the file name) then deletes the
  conflict copy; `discard-conflict` only deletes. Return failures, don't throw.
* `listEvicted` detects iCloud placeholder files (`.<name>.icloud` siblings or
  zero-byte files next to a `.icloud`), and files with size 0 whose name matches.
* `downloadEvicted` runs `brctl download <abs>` on darwin only (spawn, 20 s timeout);
  on other platforms return `{ ok:false, message:'not supported' }`.
* `readOnly` in `SyncStatus`: `access(W_OK)` check on the root.

### 3.7 `src/notes.ts` (owner: host-core)

```ts
export const NOTE_SECTIONS: { keys: NoteSection['keys']; zh: string; en: string }[]
export function initialNotesMarkdown(meta: Pick<PaperMeta, 'title' | 'authors' | 'year'>, language: Language): string
export async function readNotes(root: string, paperId: string): Promise<NotesDocument>
export async function writeNotes(
  root: string, paperId: string, markdown: string,
  opts?: { baseHash?: string; device?: string },
): Promise<NotesWriteResult>
export async function appendToNotes(
  root: string, input: NoteAppendInput, opts?: { language?: Language; device?: string },
): Promise<NotesWriteResult>
export function extractNotePreview(markdown: string, cap?: number): string
export function noteSections(markdown: string): Record<string, string>
export function notesDisposition(root: string, paperId: string): { exists: boolean; size: number }
```

`readNotes`: missing file ⇒ `{ markdown:'', hash:'', mtimeMs:0, exists:false }`
(empty hash = "no base", so a later write is allowed to create the file).
`hash = sha256(markdown)`. `writeNotes` with a `baseHash` that does not match the
current hash writes a conflict copy via `sync.writeConflictCopy` and returns
`{ ok:false, conflict:true, conflictPath, notes:<current> }`. Writing identical
content is a no-op success.
`appendToNotes`: appends under the canonical heading for the section in the paper's
language (`opts.language`, default `zh`), creating it at the end when missing; never
loses existing text; uses `writeNotes` with the hash read in the same call (retry
once on conflict by re-reading — the append is additive so this is safe).

### 3.8 `src/library.ts` (owner: host-core)

```ts
export const PAPERS_DIR = 'papers'
export const INBOX_DIR = '_inbox'
export const INTERNAL_DIR = '.paperdesk'

export async function ensureLayout(root: string): Promise<void>
export async function listPaperIds(root: string): Promise<string[]>
export async function readMeta(root: string, paperId: string): Promise<PaperMeta | null>
export async function writeMeta(root: string, meta: PaperMeta): Promise<void>
export async function makePaperId(title: string, year: number | null, sha: string): Promise<string>
export async function findPaperBySha(root: string, sha: string): Promise<string | null>
export async function listPapers(root: string): Promise<PaperSummary[]>
export async function getPaper(root: string, paperId: string): Promise<PaperDetail | null>
export interface CreatePaperOptions {
  bytes?: Uint8Array                  // uploaded bytes
  sourcePath?: string                 // copy from an absolute path on the Host
  fileName?: string                   // for uploads
  source: PaperSource
  sourceUrl?: string
  meta?: Partial<PaperMeta>
  enrich?: boolean
  language: Language
  device?: string
}
export async function createPaper(root: string, opts: CreatePaperOptions): Promise<{
  id: string; meta: PaperMeta; duplicated: boolean
}>
export async function updateMeta(
  root: string, paperId: string, patch: Partial<PaperMeta>,
): Promise<PaperMeta>
export async function deletePaper(root: string, paperId: string): Promise<{ trashed: string }>
export async function stats(root: string): Promise<{ papers: number; unread: number; reading: number; read: number; withNotes: number; pdfsMissing: number }>
export async function importInbox(root: string, language: Language): Promise<string[]>   // paperIds
export async function bibtexOf(root: string, ids?: string[]): Promise<string>
export function toSummary(meta: PaperMeta, extras: { pdfBytes: number; hasNotes: boolean; notePreview: string; pdfEvicted: boolean }): PaperSummary
```

`createPaper` flow: copy/write bytes atomically to `<paperId>/paper.pdf` → sha256 →
id → duplicate check → `writeMeta` with merged guesses (`guessFromPdf`,
`guessFromFileName`, explicit `meta` wins, `enrich` triggers Crossref and fills only
empty fields) → `initialNotesMarkdown` when notes.md absent → return. `pageCount` from
pdfjs; text extraction is **not** part of import (the route can call `ensureText`
lazily). Never leave a half-created directory on failure (clean up on error).

`listPapers`: walk `papers/*/meta.json`, tolerate corrupt/missing meta (fall back to a
synthetic meta with the directory name), include summary extras; sort by `addedAt`
desc. `pdfEvicted`/`pdfBytes` from filesystem, `notePreview` first 160 chars of notes.

`updateMeta`: whitelist of editable fields (title, authors, year, venue, doi, url,
abstract, keywords, tags, status, rating, pdfFile) — never accept `id`, `addedAt`,
`schemaVersion`, path fields from the client; refresh `updatedAt`.

`bibtexOf`: standard `@article{...}` entries, key `lastnameYearFirstWord`, escape
braces/backslashes; `ids` empty ⇒ all papers sorted by year desc.

### 3.9 `src/prompt.ts` (owner: lead)

```ts
export function systemPromptText(settings: EffectiveSettings): string
export function assistPayload(input: AssistRequest, meta: PaperMeta, notes: NotesDocument, settings: EffectiveSettings): AssistPayload
```

### 3.10 `src/tools.ts` (owner: lead) — tools registered with `ctx.tools.register(defineTool(...))`

| tool | parameters | behaviour |
|---|---|---|
| `paper_list` | `status?`, `tag?`, `limit?` | library summary rows |
| `paper_search` | `query`, `limit?` | title/author/abstract/notes/text search |
| `paper_info` | `paperId` | meta + notes + page count |
| `paper_text` | `paperId`, `page?`, `pages?`, `maxChars?` | extracted text (lazy extraction), page windows |
| `paper_notes_read` | `paperId` | notes markdown + hash |
| `paper_note_append` | `paperId`, `section?`, `text`, `page?` | append note (conflict-safe); returns new hash |
| `paper_add` | `path`, `title?`, `authors?`, `year?`, `doi?`, `tags?` | import a PDF from an absolute path |
| `paper_update` | `paperId`, editable fields | patch metadata |
| `paper_sync` | — | sync status + external changes |

Tool descriptions must state that the library is configured/unconfigured and name the
root. Return compact, token-efficient JSON. They must never throw for missing config;
return a plain error object instead. Tools are only registered when a library path is
configured at activation (the panel settings change restarts the plugin/route — use a
per-call `effectiveSettings()` check inside the tool body, do not cache).

### 3.11 `src/http.ts` (owner: lead) and `src/index.ts` (owner: lead)

`index.ts`: exports `name`, `Config`, `apply`; `apply` logs version, mounts the HTTP
half (`ctx.plugin(httpPlugin, config)`), registers the system-prompt section and the
tools. HTTP half declares `inject = ['webServer']` so headless profiles stay inactive.

---

## 4. HTTP API (base `/api/paper-desk`)

All JSON unless noted. Errors: `{ error: string }` with 400/404/409/500. Every route
re-reads `effectiveSettings(config)` (settings can change in the UI without restart).

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/status` | — | `StatusPayload` |
| GET | `/settings` | — | `{ file, effective, loaded }` |
| POST | `/settings` | `SettingsFile` | `{ file, effective }` |
| GET | `/papers` | `?q&tag&status&sort=added\|title\|year\|updated&limit` | `{ count, papers: PaperSummary[] }` |
| POST | `/papers` | raw PDF bytes, header `x-file-name` (URI-encoded); or `?path=<abs>` to import a Host file; `?enrich=0\|1` | `{ id, meta, duplicated, text: 'none' }` |
| GET | `/paper` | `?id` | `PaperDetail` (404 when unknown) |
| PATCH | `/paper` | `?id` + `Partial<PaperMeta>` body | `{ meta }` |
| DELETE | `/paper` | `?id` | `{ trashed }` |
| GET | `/notes` | `?id` | `NotesDocument` |
| PUT | `/notes` | `?id` + `{ markdown, baseHash? }` | `NotesWriteResult` (200, or 409 with the same body when conflict) |
| POST | `/notes/append` | `?id` + `{ section?, text, page?, by? }` | `NotesWriteResult` |
| POST | `/enrich` | `?id` | `{ meta, enrich: EnrichResult }` |
| POST | `/text` | `?id&force=1` | `{ text: ExtractedText }` |
| GET | `/file` | `?id` | PDF bytes, `content-type: application/pdf`, `content-disposition: inline` |
| GET | `/search` | `?q&limit` | `{ count, hits: SearchHit[] }` |
| GET | `/sync` | — | `SyncStatus` |
| POST | `/sync/scan` | — | `{ delta: ScanDelta, lastScanAt }` |
| POST | `/sync/conflicts` | `{ relPath, action }` | `{ ok, message?, sync: SyncStatus }` |
| POST | `/sync/download` | `{ relPath }` | `{ ok, message? }` |
| POST | `/inbox` | — | `{ imported: string[], papers: PaperSummary[] }` |
| GET | `/bibtex` | `?ids=a,b` (empty ⇒ all) | `text/x-bibtex; charset=utf-8` |
| POST | `/assist` | `AssistRequest` | `AssistPayload` |
| POST | `/reveal` | `{ id }` | `{ ok, message? }` (macOS `open -R`, Windows explorer, Linux xdg-open) |

Search order: title (6) > author (5) > tag (4) > abstract (3) > notes (2) > text (1);
snippet ≈ 120 chars around the match; cap 60 hits. Text search only reads cached
`text.json` files (never extracts during search).

Body limits: JSON 1 MiB; PDF upload configurable via `maxPdfBytes` (25 MiB default).
`safeJoin` on every `id`; `id` must match `^[a-z0-9][a-z0-9-]{0,63}$`.

---

## 5. Browser half

### 5.1 Registration (Lead — `client/index.tsx`)

```ts
export const name = 'paper-desk'
export const inject = ['slots', 'locale']
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('paper-desk', dict), '…')
  const t = ctx.locale.bind('paper-desk')
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: 'paper-desk', locale: 'paper-desk' }, <App ctx={ctx} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: 'paper-desk', order: 40, label: () => t('title'), locale: 'paper-desk' },
    ({ size }) => <PanelIcon size={size} />))
}
```

The host exposes `main` and `sidebar.panellist` slots for panel and sidebar registration.

### 5.2 Component contract

`client/App.tsx` exports `App` with props `{ ctx: ClientContext }` and owns:
nav state (`library | sync | settings`), search string, filters, selected paper id,
detail data, toasts. It renders `LibraryView`, `ReaderView`, `SyncView`,
`SettingsView` and passes callbacks. All views are pure presentational components
receiving data + callbacks; no fetch inside views — use `client/api.ts`.

| file | exports | notes |
|---|---|---|
| `client/api.ts` (Lead) | typed functions for every route + `ApiError` | single place with `fetch` |
| `client/i18n.ts` (client-ui) | `dict`, `TContext`, `useT()`, `I18nProvider` | every UI string; zh + en |
| `client/styles.ts` (client-ui) | `const CSS: string` | all `pd-` classes, host tokens |
| `client/ui.tsx` (client-ui) | `Button`, `IconButton`, `Field`, `TextInput`, `Select`, `Tabs`, `Modal`, `Toast`, `EmptyState`, `Spinner`, `Chip` | small own primitives |
| `client/icons.tsx` (client-ui) | `PanelIcon`, `IconImport`, `IconSync`, `IconGear`, `IconSearch`, `IconSpark`, `IconTrash`, `IconEdit`, `IconBook`, `IconNote`, `IconFolder`, `IconRefresh`, `IconClose` | 16px stroke SVGs |
| `client/LibraryView.tsx` | `LibraryView` | list rows, filters, import, search |
| `client/ReaderView.tsx` | `ReaderView` | detail: header actions, tabs (阅读 / 笔记 / 信息), PDF iframe, text view, assist bar |
| `client/NotesEditor.tsx` | `NotesEditor` | markdown textarea + section jump + save/conflict banner + append quote |
| `client/MetaEditor.tsx` | `MetaEditor` | editable metadata form + tags + enrichment |
| `client/SyncView.tsx` | `SyncView` | cloud badge, counters, delta list, conflicts, iCloud download, rescan |
| `client/SettingsView.tsx` | `SettingsView` | library path picker (`ctx.uiWorkspace.pickDirectory()`), language, enrich toggle, inbox scan, default location button |
| `client/agent.ts` (client-ui) | `startPaperSession(ctx, assist)` | creates/reuses the library workspace and prefills the prompt |
| `client/markdown.tsx` (client-ui) | `Markdown` | `marked` render, sanitized-ish (escape raw HTML) |

### 5.3 Layout (target: native in-app page, 3 panes)

```
┌ 论文库 · PaperDesk        [搜索论文…]   [导入 PDF]  [同步] [设置] ┐
│ ┌ 列表 320px ─────────┐ ┌ 详情 / 内容 ───────────────────────┐ │
│ │ 状态筛选 chips      │ │ title / authors / venue / year      │ │
│ │ 标签筛选            │ │ 阅读 | 笔记 | 信息                   │ │
│ │ ── 论文行 ──        │ │ PDF iframe / text / notes / meta    │ │
│ │ 标题 作者 年份 标签 │ │                                     │ │
│ └─────────────────────┘ └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

* First run (no library path): centered setup card — explain the layout, offer
  「选择目录」 (pickDirectory) and 「使用默认目录」 (`~/Documents/PaperDesk`), plus a
  short sync note. Do not render the library panes until configured.
* Library path set but directory missing: same setup card with the path prefilled and
  「创建并开始」.
* Empty library: `EmptyState` with 「导入 PDF」 + drag-and-drop onto the page (drop
  handler reads `File`, uploads via `api.importUpload`).
* Import progress: disabled button + spinner; on success select the new paper.
* Reader tabs: PDF (`<iframe src={api.pdfUrl(id)}>` with `title`), 文本 (lazy
  `api.getText`), 笔记. Reader header: status select, tags chips, rating stars,
  buttons: 更新元数据 (enrich), 导出 BibTeX (download blob), 在 Finder 中显示,
  删除 (confirm modal).
* Assist bar in the 笔记/阅读 tabs: 总结 · 方法 · 审阅 · 相关工作 · 提问 → calls
  `api.assist` then `startPaperSession`; show toast 「已在新会话中准备好提示词」.
* Notes: textarea with monospace, Cmd/Ctrl+S save, dirty indicator, unsaved-changes
  guard on paper switch, conflict banner offering 「使用我的版本」(re-save without
  baseHash) / 「加载磁盘版本」.
* Sync view: cloud badge (`iCloud 云盘` …) + `已在网盘同步` note; counters; 外部变更
  list; conflicts list with resolve buttons; evicted list with download buttons;
  「重新扫描」; 「打开目录」 (api.reveal).
* Settings: path picker + save, language select, enrich toggle, inbox scan button,
  device id display, `在 Finder 中显示`.
* All errors surface as toasts with the server's `error` text; never blank the page.

### 5.4 Styling rules

* Only host theme tokens (see §5.5) + `color-mix()`; no literal palette colors.
* Copy spacing/type scale from the host: page padding `clamp(16px,2.5cqi,32px)`,
  title `20px/500`, body `13px`, rows `11.5–12.5px`, borders `1px solid
  var(--dsw-alias-border-l1)`, radius `8–12px`, hover `--dsw-alias-interactive-bg-hover`.
* Container query `container: pd/inline-size` on the page root; collapse to single
  column under `720px`.
* CSS is injected once by `App` via a `<style data-plugin-css="paper-desk">` tag inside
  an effect (or a React `<style>` element) and removed on unmount.

### 5.5 Theme tokens available

`--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`,
`--dsw-alias-bg-overlay`, `--dsw-alias-border-l1`, `--dsw-alias-border-l2`,
`--dsw-alias-brand-primary`, `--dsw-alias-label-primary`,
`--dsw-alias-label-secondary`, `--dsw-alias-state-error-primary`,
`--dsw-alias-state-idle-primary`, `--dsw-alias-state-success-primary`,
`--dsw-alias-state-warn-primary`, `--dsw-specific-sidebar-fill`.
Common extra aliases used by installed plugins (safe with fallback):
`--dsw-alias-interactive-bg-hover`, `--dsw-alias-button-primary-fill`,
`--dsw-alias-label-primary-foreground`, `--dsw-alias-border-l4`,
`--dsw-shadow-lv1`, `--dsw-font-family`.

### 5.6 Agent hand-off (`client/agent.ts`)

```ts
export async function startPaperSession(ctx: ClientContext, assist: AssistPayload): Promise<void>
```
1. Find an existing workspace whose path equals `assist.workspacePath` from
   `ctx.get('workspaces')?.list` snapshot (`ws.path`), else
   `await ctx.workspaces.create({ path })`.
2. `ctx.uiWorkspace.startSession(workspaceId, { prompt: assist.prompt,
   whenDraftExists: 'append' })`.
3. Guard every optional service with `ctx.get(...)`, throw a readable Error when
   `uiWorkspace` is unavailable (UI shows it as a toast + copy-prompt fallback).

`ctx.slots`/`ctx.locale` are injected; `layout`, `workspaces`, `uiWorkspace` are
optional (`ctx.get`). The page can call `ctx.layout.selectPanel(null)` to return to
the conversation but must not require it.

---

## 6. Verification

Lead runs after integration:

```bash
cd /path/to/dsh-paper-desk
pnpm run typecheck && pnpm run build
node scripts/smoke.mjs        # creates a temp library, imports a real PDF, exercises modules
```

The plugin is then installed with `plugin_manager install_bundle` and verified live
(`cordis_inspect_query` Config status + page interaction). Teammates: run
`pnpm exec tsc --noEmit -p tsconfig.json` (or `-p tsconfig.client.json`) and fix errors
in your own files; report cross-module mismatches to the Lead instead of editing
other owners' files.

## 7. Ownership map

| owner | files |
|---|---|
| host-core (teammate) | `src/config.ts`, `src/util.ts`, `src/settings.ts`, `src/notes.ts`, `src/library.ts` |
| pdf-meta (teammate) | `src/pdf.ts`, `src/metadata.ts`, `src/sync.ts` |
| client-ui (teammate) | `client/App.tsx`, `client/i18n.ts`, `client/styles.ts`, `client/ui.tsx`, `client/icons.tsx`, `client/markdown.tsx`, `client/agent.ts`, `client/LibraryView.tsx`, `client/ReaderView.tsx`, `client/NotesEditor.tsx`, `client/MetaEditor.tsx`, `client/SyncView.tsx`, `client/SettingsView.tsx` |
| lead | `src/types.ts`, `src/search.ts`, `src/prompt.ts`, `src/tools.ts`, `src/http.ts`, `src/index.ts`, `client/index.tsx`, `client/api.ts`, `scripts/*`, `package.json`, `cordis.patch.yml`, `locale/*`, `icon.svg`, `README.md` |
