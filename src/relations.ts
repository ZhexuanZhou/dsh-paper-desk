/**
 * Typed undirected paper relations (DESIGN-FEATURES §3 / §5).
 *
 * Storage: `<root>/.paperdesk/relations.json` (`RelationsDocument`), atomic and
 * sync-friendly. Rules:
 *  - a missing file is an empty document; a corrupt one is *moved* to
 *    `.paperdesk/conflicts/relations-<timestamp>.json` (bytes preserved) and
 *    reads degrade to an empty graph,
 *  - both endpoints must be existing papers (`papers/<id>/meta.json`) and an
 *    edge cannot link a paper to itself,
 *  - one unordered pair may not hold the same `kind` twice
 *    ("relation already exists"), and the graph is capped at 2000 edges,
 *  - mutations are read-modify-write with one re-read before the atomic write,
 *    so a concurrent additive change on another device is merged,
 *  - ids are `r-<8 hex>` and unknown fields are never stored.
 */

import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import type {
  NewRelation,
  PaperRelation,
  RelationKind,
  RelationsDocument,
} from './types.js'
import { fileInfo, nowIso, posixJoin, safeJoin, writeJsonFile } from './util.js'

/** File name of the relation graph inside `.paperdesk/`. */
export const RELATIONS_FILE = 'relations.json'

/** Library layout constants (kept local; mirrors `src/library.ts`). */
const PAPERS_DIR = 'papers'
const META_FILE = 'meta.json'
const INTERNAL_DIR = '.paperdesk'
const CONFLICTS_DIR = 'conflicts'

/** Same id contract as `src/library.ts`. */
const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Defensive bound for a client-supplied relation id. */
const MAX_RELATION_ID_LENGTH = 128

const RELATION_LIMITS = { items: 2000, label: 80, note: 1000 } as const

const KINDS: readonly RelationKind[] = [
  'cites',
  'related',
  'method',
  'contrast',
  'same-topic',
  'custom',
]
const DEFAULT_SOURCE = 'user' as const

function emptyDocument(): RelationsDocument {
  return { schemaVersion: 1, updatedAt: nowIso(), items: [] }
}

/** Absolute, confined path of the relation graph file. */
function relationsPath(root: string): string {
  return safeJoin(root, posixJoin(INTERNAL_DIR, RELATIONS_FILE))
}

/* -------------------------------------------------------------------------- */
/* loading + corrupt-file quarantine                                           */
/* -------------------------------------------------------------------------- */

interface LoadedRelations {
  doc: RelationsDocument
  raw: string | null
}

/**
 * Read the relation graph. A missing file is an empty document; a corrupt file
 * is quarantined under `.paperdesk/conflicts/` and also yields an empty graph.
 */
export async function readRelations(root: string): Promise<RelationsDocument> {
  const loaded = await loadDocument(root)
  return loaded.doc
}

async function loadDocument(root: string): Promise<LoadedRelations> {
  const absPath = relationsPath(root)
  let raw: string
  try {
    raw = await readFile(absPath, 'utf8')
  } catch {
    // Missing (or unreadable) file: reads degrade to "no relations".
    return { doc: emptyDocument(), raw: null }
  }
  const parsed = parseDocument(raw)
  if (parsed === null) {
    await quarantineCorruptFile(root, absPath)
    return { doc: emptyDocument(), raw: null }
  }
  return { doc: parsed, raw }
}

/**
 * Parse + coerce relations.json. `null` means "not a usable document": the
 * caller quarantines the original bytes instead of dropping the graph silently.
 */
function parseDocument(raw: string): RelationsDocument | null {
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
  if (rawItems.length > RELATION_LIMITS.items) return null

  const items: PaperRelation[] = []
  for (const entry of rawItems) {
    const relation = coerceRelation(entry)
    if (relation === null) return null
    items.push(relation)
  }
  const updatedAt = isoOr(record['updatedAt'], nowIso())
  return { schemaVersion: 1, updatedAt, items }
}

/** Coerce one stored edge; `null` invalidates the whole document. */
function coerceRelation(value: unknown): PaperRelation | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  const id = record['id']
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_RELATION_ID_LENGTH) return null

  const from = validPaperId(record['from'])
  const to = validPaperId(record['to'])
  if (from === null || to === null || from === to) return null

  const kind = record['kind']
  if (!isRelationKind(kind)) return null

  const label = storedLabel(record['label'])
  if (label === null) return null
  const note = storedNote(record['note'])
  if (note === null) return null

  const source = record['source'] === 'agent' ? 'agent' : 'user'
  const createdAt = isoOr(record['createdAt'], nowIso())
  const updatedAt = isoOr(record['updatedAt'], createdAt)
  return { id, from, to, kind, label, note, source, createdAt, updatedAt }
}

function validPaperId(value: unknown): string | null {
  return typeof value === 'string' && PAPER_ID_RE.test(value) ? value : null
}

function isoOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/** Tolerant label reader for stored documents; `null` ⇒ corrupt file. */
function storedLabel(value: unknown): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > RELATION_LIMITS.label) return null
  return value.trim()
}

/** Tolerant note reader for stored documents; `null` ⇒ corrupt file. */
function storedNote(value: unknown): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > RELATION_LIMITS.note) return null
  return value.trim()
}

function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
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
 * Move a corrupt relations.json to
 * `.paperdesk/conflicts/relations-<ts>.json`. The original bytes are never
 * deleted, and the copy is created exclusively so an earlier conflict copy with
 * the same timestamp can never be overwritten.
 */
async function quarantineCorruptFile(root: string, absPath: string): Promise<void> {
  const conflictsDirAbs = safeJoin(root, posixJoin(INTERNAL_DIR, CONFLICTS_DIR))
  await mkdir(conflictsDirAbs, { recursive: true })
  const stamp = conflictTimestamp()

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const destination = path.join(conflictsDirAbs, `relations-${stamp}${suffix}.json`)
    try {
      // COPYFILE_EXCL fails with EEXIST instead of replacing an existing copy.
      await copyFile(absPath, destination, constants.COPYFILE_EXCL)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return // another process already quarantined it
      if (code === 'EEXIST') continue
      throw new Error(`could not quarantine the corrupt relations file: ${errorMessage(error)}`)
    }
    try {
      await unlink(absPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`could not remove the quarantined relations file: ${errorMessage(error)}`)
      }
    }
    return
  }
  throw new Error('could not allocate a conflict-copy name for the corrupt relations file')
}

/* -------------------------------------------------------------------------- */
/* validation + mutation                                                       */
/* -------------------------------------------------------------------------- */

function notFound(message: string): Error & { status: number } {
  return fail(message, 404)
}

/**
 * Tagged domain error: the HTTP layer maps `status` to the response code, so
 * validation failures become 400, conflicts 409 and unknown ids 404 without
 * the transport parsing message strings.
 */
function fail(message: string, status: number): Error & { status: number } {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error as Error & { status: number }
}

function assertPaperId(value: unknown, field: 'from' | 'to'): string {
  if (typeof value !== 'string' || !PAPER_ID_RE.test(value.trim())) {
    throw fail(`invalid ${field} paper id: ${String(value)}`, 400)
  }
  return value.trim()
}

function assertRelationId(value: unknown): string {
  if (typeof value !== 'string') throw fail('invalid relation id', 400)
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_RELATION_ID_LENGTH) throw fail('invalid relation id', 400)
  return id
}

function assertKind(value: unknown): RelationKind {
  if (!isRelationKind(value)) throw fail(`invalid relation kind: ${String(value)}`, 400)
  return value
}

function assertSource(value: unknown): 'user' | 'agent' {
  if (value !== 'user' && value !== 'agent') {
    throw fail(`invalid relation source: ${String(value)}`, 400)
  }
  return value
}

function sanitizeLabel(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw fail('relation label must be a string', 400)
  const label = value.trim()
  if (label.length > RELATION_LIMITS.label) {
    throw fail(`relation label is too long (max ${RELATION_LIMITS.label} characters)`, 400)
  }
  return label
}

function sanitizeNote(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw fail('relation note must be a string', 400)
  const note = value.trim()
  if (note.length > RELATION_LIMITS.note) {
    throw fail(`relation note is too long (max ${RELATION_LIMITS.note} characters)`, 400)
  }
  return note
}

/** Both endpoints must be existing papers (`papers/<id>/meta.json`). */
async function assertPapersExist(root: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const metaAbs = safeJoin(root, posixJoin(PAPERS_DIR, id, META_FILE))
    if ((await fileInfo(metaAbs)) === null) throw fail(`paper not found: ${id}`, 400)
  }
}

/** Undirected pair equality, used for the pair+kind uniqueness rule. */
function samePair(a: Pick<PaperRelation, 'from' | 'to'>, b: Pick<PaperRelation, 'from' | 'to'>): boolean {
  return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from)
}

/** `r-` + 8 lowercase hex characters, unique inside the document. */
function newRelationId(items: readonly PaperRelation[]): string {
  const used = new Set(items.map((item) => item.id))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = `r-${randomBytes(4).toString('hex')}`
    if (!used.has(id)) return id
  }
  // Astronomically unlikely; keep the shape valid even then.
  return `r-${randomBytes(4).toString('hex')}`
}

type RelationsMutation = (doc: RelationsDocument) => RelationsDocument

/**
 * Apply `mutation` to the current document and persist it atomically. The file
 * is re-read once before writing so a concurrent additive change is re-applied
 * instead of overwritten (see the module header).
 */
async function mutateDocument(root: string, mutation: RelationsMutation): Promise<RelationsDocument> {
  const first = await loadDocument(root)
  const candidate = mutation(first.doc)
  const second = await loadDocument(root)
  const result = second.raw === first.raw ? candidate : mutation(second.doc)
  await writeJsonFile(relationsPath(root), result)
  return result
}

/**
 * Add one typed edge. Validates the ids, the endpoints' existence, the kind,
 * label/note bounds and the pair+kind uniqueness rule, then assigns a fresh
 * `r-<8 hex>` id. The graph is capped at {@link RELATION_LIMITS.items} edges.
 */
export async function addRelation(root: string, input: NewRelation): Promise<RelationsDocument> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('relation payload must be an object', 400)
  }
  const record = input as unknown as Record<string, unknown>
  const from = assertPaperId(record['from'], 'from')
  const to = assertPaperId(record['to'], 'to')
  if (from === to) throw fail('a relation cannot link a paper to itself', 400)
  const kind = assertKind(record['kind'])
  const label = sanitizeLabel(record['label'])
  const note = sanitizeNote(record['note'])
  const source = record['source'] === undefined ? DEFAULT_SOURCE : assertSource(record['source'])
  await assertPapersExist(root, [from, to])

  return mutateDocument(root, (doc) => {
    if (doc.items.length >= RELATION_LIMITS.items) {
      throw fail(`relation limit reached: at most ${RELATION_LIMITS.items} relations`, 400)
    }
    const duplicate = doc.items.some(
      (item) => item.kind === kind && samePair(item, { from, to }),
    )
    if (duplicate) throw fail('relation already exists', 409)
    const now = nowIso()
    const relation: PaperRelation = {
      id: newRelationId(doc.items),
      from,
      to,
      kind,
      label,
      note,
      source,
      createdAt: now,
      updatedAt: now,
    }
    return { ...doc, items: [...doc.items, relation], updatedAt: now }
  })
}

/**
 * Patch `kind`, `label` and/or `note` of one edge. Changing `kind` re-checks the
 * pair+kind uniqueness rule. Unknown ids throw a not-found Error tagged 404.
 */
export async function updateRelation(
  root: string,
  relationId: string,
  patch: { kind?: RelationKind; label?: string; note?: string },
): Promise<RelationsDocument> {
  const id = assertRelationId(relationId)
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw fail('relation patch must be an object to update', 400)
  }
  const record = patch as unknown as Record<string, unknown>
  const update: { kind?: RelationKind; label?: string; note?: string } = {}
  if (record['kind'] !== undefined) update.kind = assertKind(record['kind'])
  if (record['label'] !== undefined) update.label = sanitizeLabel(record['label'])
  if (record['note'] !== undefined) update.note = sanitizeNote(record['note'])

  return mutateDocument(root, (doc) => {
    const index = doc.items.findIndex((item) => item.id === id)
    const current = index >= 0 ? doc.items[index] : undefined
    if (current === undefined) throw notFound(`relation not found: ${id}`)

    const kind = update.kind !== undefined ? update.kind : current.kind
    const duplicate = doc.items.some(
      (item) => item.id !== id && item.kind === kind && samePair(item, current),
    )
    if (duplicate) throw fail('relation already exists', 409)

    const now = nowIso()
    const next: PaperRelation = {
      ...current,
      kind,
      label: update.label !== undefined ? update.label : current.label,
      note: update.note !== undefined ? update.note : current.note,
      updatedAt: now,
    }
    const items = [...doc.items]
    items[index] = next
    return { ...doc, items, updatedAt: now }
  })
}

/** Remove one edge. Unknown ids throw a not-found Error tagged `status = 404`. */
export async function removeRelation(
  root: string,
  relationId: string,
): Promise<RelationsDocument> {
  const id = assertRelationId(relationId)
  return mutateDocument(root, (doc) => {
    if (!doc.items.some((item) => item.id === id)) throw notFound(`relation not found: ${id}`)
    return {
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
      updatedAt: nowIso(),
    }
  })
}

/** Pure split of the graph around one paper (used by the reader/`paper_info`). */
export function relationForPaper(
  doc: RelationsDocument,
  paperId: string,
): { outgoing: PaperRelation[]; incoming: PaperRelation[] } {
  return {
    outgoing: doc.items.filter((item) => item.from === paperId),
    incoming: doc.items.filter((item) => item.to === paperId),
  }
}
