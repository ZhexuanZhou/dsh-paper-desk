/**
 * Shared domain types for PaperDesk. This file is the contract between the
 * Host half (src/*), the HTTP API, the agent tools and the browser half
 * (client/*). Change it first, then the producers and consumers.
 *
 * Everything here is plain JSON-serializable data: it crosses the HTTP
 * boundary and the model boundary.
 */

/** A paper's reading state (Mendeley-style). */
export type PaperStatus = 'unread' | 'reading' | 'read' | 'archived'

/** How the paper entered the library. */
export type PaperSource = 'import' | 'arxiv' | 'doi' | 'inbox' | 'agent'

/** Authors are kept as display strings ("Mingyang Deng"); no name splitting. */
export interface PaperMeta {
  schemaVersion: 1
  /** Stable directory id under `<root>/papers/`, ASCII, url-safe. */
  id: string
  title: string
  authors: string[]
  year: number | null
  /** Journal / conference / arXiv category etc. */
  venue: string
  doi: string
  url: string
  abstract: string
  keywords: string[]
  /** User-defined free-form tags. */
  tags: string[]
  status: PaperStatus
  /** 0 = unrated, 1..5 stars. */
  rating: number
  /** ISO timestamps. */
  addedAt: string
  updatedAt: string
  /** File name of the PDF inside the paper directory ("paper.pdf"). */
  pdfFile: string | null
  /** Lowercase hex sha256 of the PDF bytes (sync + duplicate detection). */
  pdfSha256: string | null
  pageCount: number | null
  source: PaperSource
  /** Where the PDF came from when source is import/arxiv/doi. */
  sourceUrl: string
}

/** Lightweight row returned by the list/search endpoints. */
export interface PaperSummary {
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string
  doi: string
  tags: string[]
  status: PaperStatus
  rating: number
  addedAt: string
  updatedAt: string
  pageCount: number | null
  /** Bytes on disk for the PDF (0 when missing / not downloaded from iCloud). */
  pdfBytes: number
  /** True when notes.md exists and is non-trivial. */
  hasNotes: boolean
  /** First line of notes.md's summary, trimmed for the list. */
  notePreview: string
  /** True when the PDF file is an iCloud placeholder that is not downloaded. */
  pdfEvicted: boolean
}

/** One page of extracted PDF text. */
export interface PageText {
  page: number
  text: string
}

/** Cached extraction result (`<paper>/text.json`). */
export interface ExtractedText {
  schemaVersion: 1
  /** sha256 of the source PDF the text came from. */
  sourceSha256: string
  pageCount: number
  extractedAt: string
  pages: PageText[]
  /** True when the extractor produced little or no text (scanned PDF). */
  lowText: boolean
}

/** Parsed `notes.md`. */
export interface NotesDocument {
  /** Raw markdown body (frontmatter excluded — notes have none). */
  markdown: string
  /** Stable hash of the markdown used for optimistic-concurrency writes. */
  hash: string
  /** File mtime in ms (0 when missing). */
  mtimeMs: number
  exists: boolean
}

/** A named note section; notes.md is assembled from these canonical sections. */
export interface NoteSection {
  keys: 'summary' | 'points' | 'questions' | 'quotes' | 'thoughts' | 'conversation'
  heading: string
}

/** Append request used by the UI and the agent. */
export interface NoteAppendInput {
  paperId: string
  /** Target section; free-form text is appended to `thoughts` by default. */
  section?: NoteSection['keys']
  text: string
  /** Optional page anchor for quotes. */
  page?: number
  /** Optional author label ("agent" / "user"). */
  by?: 'agent' | 'user'
}

/** Result of a note write, including conflict handling. */
export interface NotesWriteResult {
  ok: boolean
  /** True when a conflict copy was written instead of overwriting. */
  conflict: boolean
  conflictPath?: string
  notes: NotesDocument
}

/** Cloud/sync provider detected from the library path. */
export type CloudKind =
  | 'icloud'
  | 'onedrive'
  | 'dropbox'
  | 'nutstore'
  | 'baidu'
  | 'syncthing'
  | 'local'

export interface CloudInfo {
  kind: CloudKind
  /** Human readable label, localized by the client where needed. */
  label: string
  /** True when the library lives inside a directory managed by a sync client. */
  synced: boolean
}

/** One file fingerprint used to detect changes made by other devices/tools. */
export interface FileFingerprint {
  relPath: string
  size: number
  mtimeMs: number
}

/** Persisted scan snapshot (`.paperdesk/scan.json`). */
export interface ScanSnapshot {
  schemaVersion: 1
  scannedAt: string
  files: FileFingerprint[]
}

/** File added / changed / removed since the previous scan. */
export interface ScanDelta {
  added: FileFingerprint[]
  changed: FileFingerprint[]
  removed: string[]
}

/** Conflict copy left behind when a writer raced another device. */
export interface ConflictEntry {
  relPath: string
  /** Paper the conflict copy belongs to (when derivable). */
  paperId: string | null
  /** Epoch ms of the conflict copy's mtime. */
  mtimeMs: number
  size: number
}

/** Everything the sync panel needs. */
export interface SyncStatus {
  cloud: CloudInfo
  /** Root path (absolute). */
  root: string
  /** Number of files tracked by the scan snapshot. */
  trackedFiles: number
  /** Number of PDFs in the library. */
  pdfCount: number
  /** Files another device/tool changed since the last scan. */
  delta: ScanDelta
  conflicts: ConflictEntry[]
  /** iCloud placeholder files that are not downloaded locally. */
  evicted: { relPath: string; paperId: string | null }[]
  lastScanAt: string | null
  /** Device id this library was last scanned from (informational). */
  deviceId: string
  /** True when the library directory is read-only or otherwise unwritable. */
  readOnly: boolean
}

/** Metadata enrichment result (Crossref). */
export interface EnrichResult {
  ok: boolean
  /** Which fields actually changed. */
  changed: string[]
  /** Crossref score/URL, informational. */
  source: 'doi' | 'bibliographic' | 'none'
  message?: string
}

/** A library-wide search hit (title/abstract/notes/text). */
export interface SearchHit {
  paper: PaperSummary
  /** Which field matched: title | author | abstract | notes | text | tag. */
  field: 'title' | 'author' | 'abstract' | 'notes' | 'text' | 'tag'
  /** Context snippet around the match. */
  snippet: string
  score: number
}

/** Detail payload for the reader view. */
export interface PaperDetail {
  meta: PaperMeta
  notes: NotesDocument
  /** Present when text.json exists. */
  text: ExtractedText | null
  /** File stats for the PDF (0 when missing). */
  pdfBytes: number
  pdfExists: boolean
  pdfEvicted: boolean
  /** Directory path relative to the root, for display. */
  dirRelPath: string
}

/** Agent-assist task presets offered in the reader. */
export type AssistTask =
  | 'summary'
  | 'method'
  | 'critique'
  | 'related'
  | 'questions'
  | 'quote'
  | 'compare'
  | 'discover'
  | 'custom'

/** Request/response of `/api/paper-desk/assist`. */
export interface AssistRequest {
  paperId: string
  task: AssistTask
  /** Optional extra instruction appended to the preset prompt. */
  extra?: string
  /** Selected passage the user annotated (for `quote` tasks). */
  quote?: string
  /** 1-based page of the selected passage. */
  page?: number
  /** The user's question about the selected passage. */
  question?: string
  /** Papers to compare (task `compare`, 2..6). */
  paperIds?: string[]
}

export interface AssistPayload {
  /** Session workspace path (the library root). */
  workspacePath: string
  /** Journal-style prompt ready to prefill into a new session. */
  prompt: string
  /** Short human label for the button/toast. */
  title: string
}

/** Effective, resolved settings handed to routes and the UI. */
export interface EffectiveSettings {
  libraryPath: string
  /** file | config | env | none */
  source: 'file' | 'config' | 'env' | 'none'
  language: 'zh' | 'en'
  enrich: boolean
  autoImportInbox: boolean
  maxPdfBytes: number
  /** Absolute path of the settings file (for diagnostics). */
  settingsFile: string
  /** Parse PDF reference lists and auto-create cites edges after import. */
  citationSync: boolean
}

/** Status payload of `/api/paper-desk/status`. */
export interface StatusPayload {
  ok: boolean
  plugin: string
  version: string
  configured: boolean
  libraryExists: boolean
  settings: EffectiveSettings
  cloud: CloudInfo
  counts: {
    papers: number
    unread: number
    reading: number
    read: number
    withNotes: number
    pdfsMissing: number
  }
  /** Non-fatal problem to show in the panel (missing dir, unreadable…). */
  problem?: string
}

/* ── PDF annotations (highlight / underline / note / question) ───────────── */

/** What the user did on the PDF. */
export type AnnotationKind = 'highlight' | 'underline' | 'note' | 'question'

/** Marker palette; the viewer maps these to theme-safe colors. */
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

/**
 * One selection rectangle, normalised to the PDF page box:
 * x/y/w/h in 0..1, top-left origin, independent of zoom and DPR.
 */
export interface AnnotationRect {
  x: number
  y: number
  w: number
  h: number
}

/** One stored annotation (`papers/<id>/annotations.json`). */
export interface AnnotationItem {
  id: string
  /** 1-based page number. */
  page: number
  kind: AnnotationKind
  color: AnnotationColor
  rects: AnnotationRect[]
  /** The selected text. */
  quote: string
  /** User/agent comment; for `question` this holds the question. */
  comment: string
  createdAt: string
  updatedAt: string
  source: 'user' | 'agent'
}

/** Whole annotations file for one paper. */
export interface AnnotationDocument {
  schemaVersion: 1
  paperId: string
  updatedAt: string
  items: AnnotationItem[]
}

/** Input accepted by `POST /annotations`. */
export interface NewAnnotation {
  page: number
  kind: AnnotationKind
  rects: AnnotationRect[]
  quote: string
  comment?: string
  color?: AnnotationColor
  source?: 'user' | 'agent'
}

/** Fields `PATCH /annotations` may change. */
export interface AnnotationPatch {
  comment?: string
  color?: AnnotationColor
  kind?: AnnotationKind
}

/** Bounds shared by the Host validator and the viewer. */
export const ANNOTATION_LIMITS = {
  quote: 4000,
  comment: 4000,
  rects: 60,
  items: 2000,
} as const

/* ── Note cards generated from AI answers ───────────────────────────────── */

/** Where a note card came from. */
export type CardSource = 'ai' | 'user' | 'agent'

/** One distilled note card attached to a paper (`papers/<id>/cards.json`). */
export interface NoteCard {
  id: string
  title: string
  /** Markdown body (usually an AI answer, possibly edited). */
  body: string
  tags: string[]
  /** Pages the card refers to (1-based). */
  pages: number[]
  source: CardSource
  createdAt: string
  updatedAt: string
}

export interface CardsDocument {
  schemaVersion: 1
  paperId: string
  updatedAt: string
  items: NoteCard[]
}

export interface NewNoteCard {
  title: string
  body: string
  tags?: string[]
  pages?: number[]
  source?: CardSource
}

/* ── Paper relations (knowledge graph) ─────────────────────────────────── */

/** Edge type between two papers. */
export type RelationKind = 'cites' | 'related' | 'method' | 'contrast' | 'same-topic' | 'custom'

export interface PaperRelation {
  id: string
  /** paperId of the source node. */
  from: string
  /** paperId of the target node. */
  to: string
  kind: RelationKind
  /** Optional short label shown on the edge. */
  label: string
  note: string
  source: 'user' | 'agent'
  createdAt: string
  updatedAt: string
}

/** Whole graph file (`.paperdesk/relations.json`). */
export interface RelationsDocument {
  schemaVersion: 1
  updatedAt: string
  items: PaperRelation[]
}

export interface NewRelation {
  from: string
  to: string
  kind: RelationKind
  label?: string
  note?: string
  source?: 'user' | 'agent'
}

/* ── Saved multi-paper comparisons (`comparisons/<id>.json`) ───────────── */

export interface PaperComparison {
  id: string
  title: string
  /** 2..6 paper ids, in presentation order. */
  paperIds: string[]
  /** AI-generated Markdown (table + conclusions). */
  markdown: string
  createdAt: string
  updatedAt: string
}

export interface ComparisonSummary {
  id: string
  title: string
  paperIds: string[]
  createdAt: string
  updatedAt: string
  /** First ~180 chars of the markdown, for the saved list. */
  preview: string
}

/* ── Citation edges auto-extracted from PDF reference lists ─────────────── */

export interface CitationSyncResult {
  /** Number of papers whose references were parsed. */
  scanned: number
  /** Relations actually created. */
  added: PaperRelation[]
  /** Candidates skipped (already linked or below confidence). */
  skipped: number
  /** Existing citation edges whose evidence note was corrected. */
  updated: number
  /** Paper ids whose text could not be extracted. */
  skippedNoText: string[]
  errors: string[]
}


/* ── Per-paper AI conversations (plugin-owned transcripts) ─────────────── */

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  at: string
}

export interface PaperChat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

export interface ChatsDocument {
  schemaVersion: 1
  paperId: string
  updatedAt: string
  items: PaperChat[]
}

export interface NewPaperChat {
  title?: string
}
