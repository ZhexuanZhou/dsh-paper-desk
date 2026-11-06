/**
 * Per-paper PDF annotations (`papers/<paperId>/annotations.json`).
 *
 * Storage rules (DESIGN-VIEWER §1):
 *  - every path is resolved through `util.safeJoin` and the paper id is
 *    validated, so a client-supplied id can never escape the library root,
 *  - a missing file is an empty document; a corrupt one is *moved* to
 *    `.paperdesk/conflicts/annotations-<timestamp>.json` (never deleted) and
 *    reads degrade to an empty document,
 *  - mutations are read-modify-write inside one call and persisted atomically
 *    (tmp file + rename), which keeps the file sync-friendly,
 *  - input is validated strictly: rct coordinates are clamped to 0..1,
 *    degenerate rectangles are dropped, and unknown payload fields are never
 *    copied into storage.
 *
 * Concurrency: annotations are additive. Before writing, a mutation re-reads
 * the document once; when another writer (another device, another request)
 * changed it meanwhile, the mutation is re-applied to the fresh copy and the
 * merged result is written. Two writers in the same instant still resolve
 * last-writer-wins at the atomic rename, but neither call can lose an item it
 * had already read. This is intentionally simpler than the notes conflict
 * protocol: concurrent highlights from two devices are both valuable.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AnnotationColor,
  AnnotationDocument,
  AnnotationItem,
  AnnotationKind,
  AnnotationPatch,
  AnnotationRect,
  NewAnnotation,
} from './types.js'
import { ANNOTATION_LIMITS } from './types.js'
import { atomicWrite, nowIso, posixJoin, safeJoin } from './util.js'

/** File name of a paper's annotation document inside its directory. */
export const ANNOTATIONS_FILE = 'annotations.json'

/** Library layout constants (kept local; mirrors `src/library.ts`). */
const PAPERS_DIR = 'papers'
const INTERNAL_DIR = '.paperdesk'
const CONFLICTS_DIR = 'conflicts'

/** Same id contract as `src/library.ts`. */
const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Generated annotation ids: `a-` plus 8 lowercase hex characters. */
const ANNOTATION_ID_RE = /^a-[0-9a-f]{8}$/
/** Rectangles smaller than this (after clamping) carry no visible text. */
const MIN_RECT_SIZE = 0.001
/** Defensive bound for a client-supplied annotation id. */
const MAX_ANNOTATION_ID_LENGTH = 128

const KINDS: readonly AnnotationKind[] = ['highlight', 'underline', 'note', 'question']
const COLORS: readonly AnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']

/** Marker colour used when a new annotation does not specify one. */
const DEFAULT_COLOR: Record<AnnotationKind, AnnotationColor> = {
  highlight: 'yellow',
  underline: 'blue',
  note: 'green',
  question: 'pink',
}

/* -------------------------------------------------------------------------- */
/* public type guards                                                          */
/* -------------------------------------------------------------------------- */

/** True when `value` is one of the four annotation kinds. */
export function isAnnotationKind(value: unknown): value is AnnotationKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

/** True when `value` is one of the five marker colours. */
export function isAnnotationColor(value: unknown): value is AnnotationColor {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value)
}

/* -------------------------------------------------------------------------- */
/* reading                                                                     */
/* -------------------------------------------------------------------------- */

interface LoadedDocument {
  doc: AnnotationDocument
  /** Raw file text, used to detect concurrent modification; `null` when missing. */
  raw: string | null
}

function emptyDocument(paperId: string): AnnotationDocument {
  return { schemaVersion: 1, paperId, updatedAt: nowIso(), items: [] }
}

function assertPaperId(paperId: string): void {
  if (typeof paperId !== 'string' || !PAPER_ID_RE.test(paperId)) {
    throw new Error(`invalid paper id: ${paperId}`)
  }
}

/** Absolute, confined path of one paper's annotations file. */
function annotationsPath(root: string, paperId: string): string {
  assertPaperId(paperId)
  return safeJoin(root, posixJoin(PAPERS_DIR, paperId, ANNOTATIONS_FILE))
}

/**
 * Read the annotation document of one paper.
 *
 * Missing file ⇒ empty document (no write). Corrupt file ⇒ quarantine under
 * `.paperdesk/conflicts/` and return an empty document. The returned document
 * always has `schemaVersion: 1`, the requested `paperId` and `items` array.
 */
export async function readAnnotations(
  root: string,
  paperId: string,
): Promise<AnnotationDocument> {
  const loaded = await loadDocument(root, paperId)
  return loaded.doc
}

async function loadDocument(root: string, paperId: string): Promise<LoadedDocument> {
  const absPath = annotationsPath(root, paperId)
  let raw: string
  try {
    raw = await readFile(absPath, 'utf8')
  } catch {
    // Missing file (or unreadable): reads degrade to "no annotations".
    return { doc: emptyDocument(paperId), raw: null }
  }

  const parsed = parseDocument(raw, paperId)
  if (parsed === null) {
    await quarantineCorruptFile(root, absPath)
    return { doc: emptyDocument(paperId), raw: null }
  }
  return { doc: parsed, raw }
}

/**
 * Parse + coerce one annotations.json. Returns `null` for anything that is not
 * a valid schema-v1 document; callers then quarantine the original bytes so no
 * user annotation is ever silently discarded.
 */
function parseDocument(raw: string, paperId: string): AnnotationDocument | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record['schemaVersion'] !== undefined && record['schemaVersion'] !== 1) return null
  const rawItems = record['items']
  if (!Array.isArray(rawItems)) return null

  const items: AnnotationItem[] = []
  for (const entry of rawItems) {
    const item = coerceItem(entry)
    if (item === null) return null
    items.push(item)
  }

  const updatedAt =
    typeof record['updatedAt'] === 'string' && record['updatedAt'].length > 0
      ? record['updatedAt']
      : nowIso()
  // `paperId` is authoritative from the directory; ignore the stored value.
  return { schemaVersion: 1, paperId, updatedAt, items }
}

/** Coerce one stored item; `null` means "this document is not schema v1". */
function coerceItem(value: unknown): AnnotationItem | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  const id = record['id']
  if (typeof id !== 'string' || !ANNOTATION_ID_RE.test(id)) return null

  const page = record['page']
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return null

  const kind = record['kind']
  if (!isAnnotationKind(kind)) return null

  const rects = readRects(record['rects'])
  if (rects === null) return null

  const quote = record['quote']
  if (
    typeof quote !== 'string' ||
    quote.length === 0 ||
    quote.length > ANNOTATION_LIMITS.quote
  ) {
    return null
  }

  const rawComment = record['comment']
  const comment =
    rawComment === undefined || rawComment === null
      ? ''
      : typeof rawComment === 'string' && rawComment.length <= ANNOTATION_LIMITS.comment
        ? rawComment
        : null
  if (comment === null) return null

  let color: AnnotationColor
  if (record['color'] === undefined) color = DEFAULT_COLOR[kind]
  else if (isAnnotationColor(record['color'])) color = record['color']
  else return null

  const source = record['source'] === 'agent' ? 'agent' : 'user'
  const createdAt =
    typeof record['createdAt'] === 'string' && record['createdAt'].length > 0
      ? record['createdAt']
      : nowIso()
  const updatedAt =
    typeof record['updatedAt'] === 'string' && record['updatedAt'].length > 0
      ? record['updatedAt']
      : createdAt

  return { id, page, kind, color, rects, quote, comment, createdAt, updatedAt, source }
}

/** Tolerant variant of {@link sanitizeRects} used while loading. */
function readRects(value: unknown): AnnotationRect[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0 || value.length > ANNOTATION_LIMITS.rects) return null
  const rects: AnnotationRect[] = []
  for (const entry of value) {
    const rect = clampRect(entry)
    if (rect === null) return null
    if (rect.w < MIN_RECT_SIZE || rect.h < MIN_RECT_SIZE) continue
    rects.push(rect)
  }
  return rects.length > 0 ? rects : null
}

/* -------------------------------------------------------------------------- */
/* corrupt-file quarantine                                                     */
/* -------------------------------------------------------------------------- */

function conflictTimestamp(date = new Date()): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
    pad(date.getMilliseconds(), 3),
  ].join('-')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

/**
 * Move a corrupt annotations.json to `.paperdesk/conflicts/annotations-<ts>.json`.
 * The original bytes are never deleted. A numeric suffix is used if a copy with
 * the same timestamp already exists; a rename failure falls back to copy+unlink.
 */
async function quarantineCorruptFile(root: string, absPath: string): Promise<void> {
  const conflictsDirAbs = safeJoin(root, posixJoin(INTERNAL_DIR, CONFLICTS_DIR))
  await mkdir(conflictsDirAbs, { recursive: true })
  const stamp = conflictTimestamp()

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const destination = path.join(conflictsDirAbs, `annotations-${stamp}${suffix}.json`)
    try {
      await rename(absPath, destination)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // Another process already quarantined/removed it: nothing left to move.
      if (code === 'ENOENT') return
      if (code === 'EEXIST') continue
      // Rename can fail across filesystems: copy the bytes then remove.
      try {
        const content = await readFile(absPath)
        await writeFile(destination, content, { flag: 'wx' })
        await unlink(absPath)
        return
      } catch (fallbackError) {
        const fallbackCode = (fallbackError as NodeJS.ErrnoException).code
        if (fallbackCode === 'ENOENT') return
        if (fallbackCode === 'EEXIST') continue
        throw new Error(
          `could not quarantine the corrupt annotations file: ${errorMessage(fallbackError)}`,
        )
      }
    }
  }
  throw new Error('could not allocate a conflict-copy name for the corrupt annotations file')
}

/* -------------------------------------------------------------------------- */
/* validation helpers                                                          */
/* -------------------------------------------------------------------------- */

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Clamp one rect's fields to 0..1; `null` when the shape is not numeric. */
function clampRect(value: unknown): AnnotationRect | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const x = finiteNumber(record['x'])
  const y = finiteNumber(record['y'])
  const w = finiteNumber(record['w'])
  const h = finiteNumber(record['h'])
  if (x === null || y === null || w === null || h === null) return null
  return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) }
}

/** Strict rect validation for new annotations (throws a readable Error). */
function sanitizeRects(value: unknown): AnnotationRect[] {
  if (!Array.isArray(value)) throw new Error('annotation rects must be an array')
  if (value.length === 0) throw new Error('annotation rects must not be empty')
  if (value.length > ANNOTATION_LIMITS.rects) {
    throw new Error(`too many annotation rects (max ${ANNOTATION_LIMITS.rects})`)
  }
  const rects: AnnotationRect[] = []
  for (let index = 0; index < value.length; index += 1) {
    const rect = clampRect(value[index])
    if (rect === null) throw new Error(`annotation rect ${index + 1} is invalid`)
    if (rect.w < MIN_RECT_SIZE || rect.h < MIN_RECT_SIZE) continue
    rects.push(rect)
  }
  if (rects.length === 0) {
    throw new Error('annotation rects are all degenerate (smaller than 0.001)')
  }
  return rects
}

function assertPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('annotation page must be an integer >= 1')
  }
  return value
}

function assertKind(value: unknown): AnnotationKind {
  if (!isAnnotationKind(value)) {
    throw new Error(`invalid annotation kind: ${String(value)}`)
  }
  return value
}

function assertColor(value: unknown): AnnotationColor {
  if (!isAnnotationColor(value)) {
    throw new Error(`invalid annotation color: ${String(value)}`)
  }
  return value
}

function assertSource(value: unknown): 'user' | 'agent' {
  if (value !== 'user' && value !== 'agent') {
    throw new Error(`invalid annotation source: ${String(value)}`)
  }
  return value
}

function sanitizeQuote(value: unknown): string {
  if (typeof value !== 'string') throw new Error('annotation quote must be a string')
  const quote = value.trim()
  if (quote.length === 0) throw new Error('annotation quote must not be empty')
  if (quote.length > ANNOTATION_LIMITS.quote) {
    throw new Error(`annotation quote is too long (max ${ANNOTATION_LIMITS.quote} characters)`)
  }
  return quote
}

function sanitizeComment(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('annotation comment must be a string')
  if (value.length > ANNOTATION_LIMITS.comment) {
    throw new Error(
      `annotation comment is too long (max ${ANNOTATION_LIMITS.comment} characters)`,
    )
  }
  return value
}

function assertAnnotationId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid annotation id')
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_ANNOTATION_ID_LENGTH) {
    throw new Error('invalid annotation id')
  }
  return id
}

function notFound(annotationId: string): Error {
  const error = new Error(`annotation not found: ${annotationId}`) as Error & { status?: number }
  // The HTTP layer can map this to 404 without parsing the message.
  error.status = 404
  return error
}

/* -------------------------------------------------------------------------- */
/* mutation                                                                    */
/* -------------------------------------------------------------------------- */

type NewAnnotationFields = Omit<AnnotationItem, 'id'>
type AnnotationMutation = (doc: AnnotationDocument) => AnnotationDocument

/** Validate a `NewAnnotation` payload, keeping only the known fields. */
function sanitizeNewAnnotation(input: NewAnnotation): NewAnnotationFields {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('annotation payload must be an object')
  }
  const page = assertPage(input.page)
  const kind = assertKind(input.kind)
  const rects = sanitizeRects(input.rects)
  const quote = sanitizeQuote(input.quote)
  const comment = sanitizeComment(input.comment)
  const color = input.color === undefined ? DEFAULT_COLOR[kind] : assertColor(input.color)
  const source = input.source === undefined ? 'user' : assertSource(input.source)
  const now = nowIso()
  return { page, kind, color, rects, quote, comment, source, createdAt: now, updatedAt: now }
}

/** `a-` + 8 lowercase hex characters, unique inside this document. */
function newAnnotationId(items: readonly AnnotationItem[]): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = `a-${randomUUID().replace(/-/g, '').slice(0, 8)}`
    if (!items.some((item) => item.id === id)) return id
  }
  // Astronomically unlikely; keep the shape valid even then.
  return `a-${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/**
 * Apply `mutation` to the current document and persist the result atomically.
 * Re-reads once before writing so a concurrent additive change is merged
 * instead of overwritten (see the module header).
 */
async function mutateDocument(
  root: string,
  paperId: string,
  mutation: AnnotationMutation,
): Promise<AnnotationDocument> {
  const first = await loadDocument(root, paperId)
  const candidate = mutation(first.doc)
  const second = await loadDocument(root, paperId)
  const result = second.raw === first.raw ? candidate : mutation(second.doc)
  await atomicWrite(annotationsPath(root, paperId), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

/* -------------------------------------------------------------------------- */
/* public mutations                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Append one annotation. Validates every field (page, kind, rects, quote,
 * comment, colour, source), assigns a fresh `a-<8 hex>` id, caps the document
 * at {@link ANNOTATION_LIMITS.items} and refreshes `updatedAt`.
 */
export async function addAnnotation(
  root: string,
  paperId: string,
  input: NewAnnotation,
): Promise<AnnotationDocument> {
  assertPaperId(paperId)
  const fields = sanitizeNewAnnotation(input)
  return mutateDocument(root, paperId, (doc) => {
    if (doc.items.length >= ANNOTATION_LIMITS.items) {
      throw new Error(
        `annotation limit reached: a paper can hold at most ${ANNOTATION_LIMITS.items} annotations`,
      )
    }
    const items = [...doc.items, { id: newAnnotationId(doc.items), ...fields }]
    return { ...doc, items, updatedAt: nowIso() }
  })
}

/**
 * Patch `comment`, `color` and/or `kind` of one annotation. Other fields can
 * never be changed through this call. Throws a not-found Error for unknown ids.
 */
export async function updateAnnotation(
  root: string,
  paperId: string,
  annotationId: string,
  patch: AnnotationPatch,
): Promise<AnnotationDocument> {
  assertPaperId(paperId)
  const id = assertAnnotationId(annotationId)
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('annotation patch must be an object')
  }

  const update: AnnotationPatch = {}
  if (patch.comment !== undefined) update.comment = sanitizeComment(patch.comment)
  if (patch.color !== undefined) update.color = assertColor(patch.color)
  if (patch.kind !== undefined) update.kind = assertKind(patch.kind)

  return mutateDocument(root, paperId, (doc) => {
    const index = doc.items.findIndex((item) => item.id === id)
    const current = index >= 0 ? doc.items[index] : undefined
    if (current === undefined) throw notFound(id)
    const next: AnnotationItem = {
      ...current,
      comment: update.comment !== undefined ? update.comment : current.comment,
      color: update.color !== undefined ? update.color : current.color,
      kind: update.kind !== undefined ? update.kind : current.kind,
      updatedAt: nowIso(),
    }
    const items = [...doc.items]
    items[index] = next
    return { ...doc, items, updatedAt: nowIso() }
  })
}

/** Remove one annotation. Throws a not-found Error for unknown ids. */
export async function removeAnnotation(
  root: string,
  paperId: string,
  annotationId: string,
): Promise<AnnotationDocument> {
  assertPaperId(paperId)
  const id = assertAnnotationId(annotationId)
  return mutateDocument(root, paperId, (doc) => {
    if (!doc.items.some((item) => item.id === id)) throw notFound(id)
    return {
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
      updatedAt: nowIso(),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* stats                                                                       */
/* -------------------------------------------------------------------------- */

/** Counters for the reader's annotation rail ("高亮 12 · 提问 3"). */
export function annotationStats(doc: AnnotationDocument): {
  total: number
  highlights: number
  notes: number
  questions: number
} {
  let highlights = 0
  let notes = 0
  let questions = 0
  for (const item of doc.items) {
    if (item.kind === 'highlight') highlights += 1
    else if (item.kind === 'note') notes += 1
    else if (item.kind === 'question') questions += 1
  }
  return { total: doc.items.length, highlights, notes, questions }
}
