/**
 * Note cards distilled from AI answers (DESIGN-FEATURES §1 / §5).
 *
 * Storage: `papers/<paperId>/cards.json` (`CardsDocument`), atomic and
 * sync-friendly. Rules:
 *  - every path goes through `safeJoin` and the paper id is validated,
 *  - a missing file is an empty document; a corrupt one is *moved* to
 *    `.paperdesk/conflicts/cards-<timestamp>.json` (bytes preserved) and reads
 *    degrade to an empty document,
 *  - mutations are serialized within this Host and checked again before the
 *    atomic write; detected cloud edits are rejected, never silently replaced,
 *  - every change preserves the exact prior document in version history,
 *  - input is validated strictly (title/body/tags/pages/source), ids are
 *    generated as `c-<8 hex>` and unknown payload fields are never stored,
 *  - creating a card requires the paper to exist (`papers/<id>/meta.json`), so
 *    a stray request can never create a phantom paper directory.
 */

import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import { editDocument } from './history.js'
import type { CardContextTurn, CardSource, CardsDocument, NewNoteCard, NoteCard } from './types.js'
import { fileInfo, nowIso, posixJoin, safeJoin, sha256 } from './util.js'

/** File name of a paper's card document inside its directory. */
export const CARDS_FILE = 'cards.json'

/** Library layout constants (kept local; mirrors `src/library.ts`). */
const PAPERS_DIR = 'papers'
const META_FILE = 'meta.json'
const INTERNAL_DIR = '.paperdesk'
const CONFLICTS_DIR = 'conflicts'

/** Same id contract as `src/library.ts`. */
const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Defensive bound for a client-supplied card id. */
const MAX_CARD_ID_LENGTH = 128

const CARD_LIMITS = {
  items: 200,
  title: 200,
  body: 20000,
  tags: 12,
  tagLength: 40,
  pages: 20,
  page: 999,
  contextTurns: 12,
  contextText: 8000,
} as const

const SOURCES: readonly CardSource[] = ['ai', 'user', 'agent']
const DEFAULT_SOURCE: CardSource = 'ai'

function emptyDocument(paperId: string): CardsDocument {
  return { schemaVersion: 1, paperId, updatedAt: nowIso(), items: [] }
}

function assertPaperId(paperId: string): void {
  if (typeof paperId !== 'string' || !PAPER_ID_RE.test(paperId)) {
    throw fail(`invalid paper id: ${String(paperId)}`, 400)
  }
}

/** Absolute, confined path of one paper's cards file. */
function cardsPath(root: string, paperId: string): string {
  assertPaperId(paperId)
  return safeJoin(root, posixJoin(PAPERS_DIR, paperId, CARDS_FILE))
}

/* -------------------------------------------------------------------------- */
/* loading + corrupt-file quarantine                                           */
/* -------------------------------------------------------------------------- */

interface LoadedCards {
  doc: CardsDocument
  raw: string | null
}

/**
 * Read the card document of one paper. A missing file is an empty document; a
 * corrupt file is quarantined under `.paperdesk/conflicts/` and also yields an
 * empty document so a broken file never blocks the reader.
 */
export async function readCards(root: string, paperId: string): Promise<CardsDocument> {
  const loaded = await loadDocument(root, paperId)
  return loaded.doc
}

export async function readCardsState(root: string, paperId: string): Promise<{ document: CardsDocument; hash: string }> {
  const loaded = await loadDocument(root, paperId)
  return { document: loaded.doc, hash: loaded.raw === null ? '' : sha256(loaded.raw) }
}

async function loadDocument(root: string, paperId: string): Promise<LoadedCards> {
  const absPath = cardsPath(root, paperId)
  let raw: string
  try {
    raw = await readFile(absPath, 'utf8')
  } catch {
    // Missing (or unreadable) file: reads degrade to "no cards".
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
 * Parse + coerce a cards.json. `null` means "not a usable document": the caller
 * quarantines the original bytes instead of dropping user cards silently.
 * `paperId` is authoritative from the directory and stored ids are not used
 * for path resolution, so only content bounds are enforced strictly here.
 */
function parseDocument(raw: string, paperId: string): CardsDocument | null {
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
  if (rawItems.length > CARD_LIMITS.items) return null

  const items: NoteCard[] = []
  for (const entry of rawItems) {
    const card = coerceCard(entry)
    if (card === null) return null
    items.push(card)
  }
  const updatedAt = isoOr(record['updatedAt'], nowIso())
  return { schemaVersion: 1, paperId, updatedAt, items }
}

/** Coerce one stored card; `null` invalidates the whole document. */
function coerceCard(value: unknown): NoteCard | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  const id = record['id']
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_CARD_ID_LENGTH) return null

  const title = storedText(record['title'], CARD_LIMITS.title)
  if (title === null) return null
  const body = storedText(record['body'], CARD_LIMITS.body)
  if (body === null) return null

  const tags = coerceTags(record['tags'])
  if (tags === null) return null
  const pages = coercePages(record['pages'])
  if (pages === null) return null

  const source = isCardSource(record['source']) ? record['source'] : DEFAULT_SOURCE
  const context = coerceContext(record['context'])
  const createdAt = isoOr(record['createdAt'], nowIso())
  const updatedAt = isoOr(record['updatedAt'], createdAt)
  return {
    id,
    title,
    body,
    tags,
    pages,
    source,
    ...(context.length > 0 ? { context } : {}),
    createdAt,
    updatedAt,
  }
}

function isCardSource(value: unknown): value is CardSource {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
}

/** Non-empty trimmed stored text with a maximum length; `null` when invalid. */
function storedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length === 0 || text.length > max) return null
  return text
}

function isoOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/** Tolerant tag reader for stored documents; `null` ⇒ corrupt file. */
function coerceTags(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const tags: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const tag = entry.trim()
    if (tag.length === 0) continue
    if (tag.length > CARD_LIMITS.tagLength) return null
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags.length <= CARD_LIMITS.tags ? tags : null
}

/** Tolerant page reader for stored documents; `null` ⇒ corrupt file. */
function coercePages(value: unknown): number[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const pages: number[] = []
  for (const entry of value) {
    if (!isValidPage(entry)) return null
    if (!pages.includes(entry)) pages.push(entry)
  }
  return pages.length <= CARD_LIMITS.pages ? pages : null
}

function coerceContext(value: unknown): CardContextTurn[] {
  if (!Array.isArray(value)) return []
  const turns: CardContextTurn[] = []
  for (const entry of value.slice(0, CARD_LIMITS.contextTurns)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (record['role'] !== 'user' && record['role'] !== 'assistant') continue
    const rawText = typeof record['text'] === 'string' ? record['text'].trim() : ''
    if (rawText === '') continue
    const text = rawText.slice(0, CARD_LIMITS.contextText)
    const id = typeof record['id'] === 'string' && record['id'].length <= MAX_CARD_ID_LENGTH ? record['id'] : undefined
    turns.push({ ...(id !== undefined ? { id } : {}), role: record['role'], text })
  }
  return turns
}

function isValidPage(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= CARD_LIMITS.page
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
 * Move a corrupt cards.json to `.paperdesk/conflicts/cards-<ts>.json`. The
 * original bytes are never deleted, and the copy is created exclusively so an
 * earlier conflict copy with the same timestamp can never be overwritten.
 */
async function quarantineCorruptFile(root: string, absPath: string): Promise<void> {
  const conflictsDirAbs = safeJoin(root, posixJoin(INTERNAL_DIR, CONFLICTS_DIR))
  await mkdir(conflictsDirAbs, { recursive: true })
  const stamp = conflictTimestamp()

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const destination = path.join(conflictsDirAbs, `cards-${stamp}${suffix}.json`)
    try {
      // COPYFILE_EXCL fails with EEXIST instead of replacing an existing copy.
      await copyFile(absPath, destination, constants.COPYFILE_EXCL)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return // another process already quarantined it
      if (code === 'EEXIST') continue
      throw new Error(`could not quarantine the corrupt cards file: ${errorMessage(error)}`)
    }
    try {
      await unlink(absPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`could not remove the quarantined cards file: ${errorMessage(error)}`)
      }
    }
    return
  }
  throw new Error('could not allocate a conflict-copy name for the corrupt cards file')
}

/* -------------------------------------------------------------------------- */
/* validation + mutation                                                       */
/* -------------------------------------------------------------------------- */

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

function notFound(cardId: string): Error & { status: number } {
  return fail(`card not found: ${cardId}`, 404)
}

/** The paper must exist (`papers/<id>/meta.json`); new cards never create a paper. */
async function assertPaperExists(root: string, paperId: string): Promise<void> {
  const metaAbs = safeJoin(root, posixJoin(PAPERS_DIR, paperId, META_FILE))
  if ((await fileInfo(metaAbs)) === null) throw fail(`paper not found: ${paperId}`, 404)
}

function assertCardId(value: unknown): string {
  if (typeof value !== 'string') throw fail('invalid card id', 400)
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_CARD_ID_LENGTH) throw fail('invalid card id', 400)
  return id
}

interface NewCardFields {
  title: string
  body: string
  tags: string[]
  pages: number[]
  source: CardSource
  context: CardContextTurn[]
}

/** Validate a `NewNoteCard` payload, keeping only the known fields. */
function sanitizeNewCard(input: NewNoteCard): NewCardFields {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('card payload must be an object', 400)
  }
  const record = input as unknown as Record<string, unknown>
  const title = sanitizeTitle(record['title'])
  const body = sanitizeBody(record['body'])
  const tags = sanitizeTags(record['tags'])
  const pages = sanitizePages(record['pages'])
  const source = record['source'] === undefined ? DEFAULT_SOURCE : assertSource(record['source'])
  const context = sanitizeContext(record['context'])
  return { title, body, tags, pages, source, context }
}

function sanitizeContext(value: unknown): CardContextTurn[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail('card context must be an array', 400)
  const turns: CardContextTurn[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw fail('card context turns must be objects', 400)
    }
    const record = entry as Record<string, unknown>
    const role = record['role']
    if (role !== 'user' && role !== 'assistant') throw fail('card context role must be user or assistant', 400)
    const rawText = typeof record['text'] === 'string' ? record['text'].trim() : ''
    if (rawText === '') throw fail('card context text is empty or too long', 400)
    const text = rawText.slice(0, CARD_LIMITS.contextText)
    const id = typeof record['id'] === 'string' && record['id'].length <= MAX_CARD_ID_LENGTH ? record['id'] : undefined
    turns.push({ ...(id !== undefined ? { id } : {}), role, text })
  }
  if (turns.length > CARD_LIMITS.contextTurns) {
    throw fail(`too many card context turns (max ${CARD_LIMITS.contextTurns})`, 400)
  }
  return turns
}

function sanitizeTitle(value: unknown): string {
  if (typeof value !== 'string') throw fail('card title must be a string', 400)
  const title = value.trim()
  if (title.length === 0) throw fail('card title must not be empty', 400)
  if (title.length > CARD_LIMITS.title) {
    throw fail(`card title is too long (max ${CARD_LIMITS.title} characters)`, 400)
  }
  return title
}

function sanitizeBody(value: unknown): string {
  if (typeof value !== 'string') throw fail('card body must be a string', 400)
  const body = value.trim()
  if (body.length === 0) throw fail('card body must not be empty', 400)
  if (body.length > CARD_LIMITS.body) {
    throw fail(`card body is too long (max ${CARD_LIMITS.body} characters)`, 400)
  }
  return body
}

/** Strict tag validation for input. */
function sanitizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail('card tags must be an array of strings', 400)
  const tags: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') throw fail('card tags must be strings', 400)
    const tag = entry.trim()
    if (tag.length === 0) continue
    if (tag.length > CARD_LIMITS.tagLength) {
      throw fail(`card tag is too long (max ${CARD_LIMITS.tagLength} characters)`, 400)
    }
    if (!tags.includes(tag)) tags.push(tag)
  }
  if (tags.length > CARD_LIMITS.tags) {
    throw fail(`too many card tags (max ${CARD_LIMITS.tags})`, 400)
  }
  return tags
}

/** Strict page validation for input. */
function sanitizePages(value: unknown): number[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail('card pages must be an array of integers', 400)
  const pages: number[] = []
  for (const entry of value) {
    if (!isValidPage(entry)) {
      throw fail(`invalid card page: ${String(entry)} (expected an integer 1..${CARD_LIMITS.page})`, 400)
    }
    if (!pages.includes(entry)) pages.push(entry)
  }
  if (pages.length > CARD_LIMITS.pages) {
    throw fail(`too many card pages (max ${CARD_LIMITS.pages})`, 400)
  }
  return pages
}

function assertSource(value: unknown): CardSource {
  if (!isCardSource(value)) throw fail(`invalid card source: ${String(value)}`, 400)
  return value
}

/** `c-` + 8 lowercase hex characters, unique inside this document. */
function newCardId(items: readonly NoteCard[]): string {
  const used = new Set(items.map((item) => item.id))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = `c-${randomBytes(4).toString('hex')}`
    if (!used.has(id)) return id
  }
  // Astronomically unlikely; keep the shape valid even then.
  return `c-${randomBytes(4).toString('hex')}`
}

type CardMutation = (doc: CardsDocument) => CardsDocument

/**
 * Apply `mutation` to the current document and persist it atomically. The file
 * is snapshotted before writing; a detected concurrent change rejects the edit.
 */
async function mutateDocument(
  root: string,
  paperId: string,
  mutation: CardMutation,
  expectedHash?: string,
  reason = 'edit cards',
): Promise<CardsDocument> {
  let result: CardsDocument | undefined
  const saved = await editDocument(root, paperId, 'cards', (state) => {
    const current = state.content === null ? emptyDocument(paperId) : parseDocument(state.content, paperId)
    if (current === null) throw fail('invalid cards file; repair it before editing', 409)
    result = mutation(current)
    return JSON.stringify(result, null, 2) + '\n'
  }, { expectedHash, reason })
  return { ...result!, hash: saved.hash, ...(saved.activity ? { activity: saved.activity } : {}) }
}

/**
 * Append one card. Validates every field (title, body, tags, pages, source),
 * assigns a fresh `c-<8 hex>` id, caps a paper at {@link CARD_LIMITS.items}
 * cards and refreshes the document `updatedAt`.
 */
export async function addCard(
  root: string,
  paperId: string,
  input: NewNoteCard,
): Promise<CardsDocument> {
  assertPaperId(paperId)
  const fields = sanitizeNewCard(input)
  await assertPaperExists(root, paperId)
  return mutateDocument(root, paperId, (doc) => {
    if (doc.items.length >= CARD_LIMITS.items) {
      throw fail(`card limit reached: a paper can hold at most ${CARD_LIMITS.items} cards`, 400)
    }
    const now = nowIso()
    const card: NoteCard = { id: newCardId(doc.items), ...fields, createdAt: now, updatedAt: now }
    return { ...doc, items: [...doc.items, card], updatedAt: now }
  })
}

/**
 * Patch `title`, `body`, `tags` and/or `pages` of one card. `id`, `source` and
 * `createdAt` can never be changed through this call. Unknown ids throw a
 * not-found Error tagged with `status = 404`.
 */
export async function updateCard(
  root: string,
  paperId: string,
  cardId: string,
  patch: Partial<Pick<NoteCard, 'title' | 'body' | 'tags' | 'pages' | 'context'>>,
  expectedUpdatedAt?: string,
): Promise<CardsDocument> {
  assertPaperId(paperId)
  const id = assertCardId(cardId)
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw fail('card patch must be an object', 400)
  }
  const record = patch as unknown as Record<string, unknown>
  const update: Partial<Pick<NoteCard, 'title' | 'body' | 'tags' | 'pages' | 'context'>> = {}
  if (record['title'] !== undefined) update.title = sanitizeTitle(record['title'])
  if (record['body'] !== undefined) update.body = sanitizeBody(record['body'])
  if (record['tags'] !== undefined) update.tags = sanitizeTags(record['tags'])
  if (record['pages'] !== undefined) update.pages = sanitizePages(record['pages'])
  if (record['context'] !== undefined) update.context = sanitizeContext(record['context'])

  return mutateDocument(root, paperId, (doc) => {
    const index = doc.items.findIndex((item) => item.id === id)
    const current = index >= 0 ? doc.items[index] : undefined
    if (current === undefined) throw notFound(id)
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
      throw fail('card changed since it was read; read it again before updating', 409)
    }
    const now = new Date(Math.max(Date.now(), (Date.parse(current.updatedAt) || 0) + 1)).toISOString()
    const next: NoteCard = {
      ...current,
      title: update.title !== undefined ? update.title : current.title,
      body: update.body !== undefined ? update.body : current.body,
      tags: update.tags !== undefined ? update.tags : current.tags,
      pages: update.pages !== undefined ? update.pages : current.pages,
      ...(update.context === undefined ? {} : { context: update.context }),
      updatedAt: now,
    }
    const items = [...doc.items]
    items[index] = next
    return { ...doc, items, updatedAt: now }
  })
}

/** Remove one card. Unknown ids throw a not-found Error tagged `status = 404`. */
export async function removeCard(
  root: string,
  paperId: string,
  cardId: string,
  expectedUpdatedAt?: string,
): Promise<CardsDocument> {
  assertPaperId(paperId)
  const id = assertCardId(cardId)
  return mutateDocument(root, paperId, (doc) => {
    const current = doc.items.find((item) => item.id === id)
    if (!current) throw notFound(id)
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw fail('card changed; reload before deleting', 409)
    return {
      ...doc,
      items: doc.items.filter((item) => item.id !== id),
      updatedAt: nowIso(),
    }
  })
}

export interface CardEditOperation {
  action: 'create' | 'update' | 'remove' | 'move'
  cardId?: string
  position?: number
  context?: CardContextTurn[]
  title?: string
  body?: string
  tags?: string[]
  pages?: number[]
}

/** One validated commit for merge/split/rewrite operations; never leaves half a batch. */
export async function editCards(root: string, paperId: string, operations: readonly CardEditOperation[], expectedHash: string): Promise<CardsDocument> {
  if (typeof expectedHash !== 'string') throw fail('expectedHash is required', 400)
  if (Array.isArray(operations) && operations.some((op) => !op || typeof op !== 'object' || !['create', 'update', 'remove', 'move'].includes(op.action))) throw fail('invalid card operation', 400)
  if (!Array.isArray(operations) || !operations.length || operations.length > 400) throw fail('provide 1–400 card operations', 400)
  return mutateDocument(root, paperId, (doc) => {
    const items = [...doc.items]
    const now = nowIso()
    for (const op of operations) {
      if (op.action === 'create') {
        const fields = sanitizeNewCard({ title: op.title!, body: op.body!, tags: op.tags, pages: op.pages, source: 'agent' })
        items.push({ id: newCardId(items), ...fields, createdAt: now, updatedAt: now })
      } else {
        const index = items.findIndex((c) => c.id === assertCardId(op.cardId))
        const current = items[index]
        if (!current) throw notFound(String(op.cardId))
        if (op.action === 'remove') items.splice(index, 1)
        else if (op.action === 'move') {
          if (!Number.isInteger(op.position) || op.position! < 0 || op.position! >= items.length) throw fail('invalid card position', 400)
          items.splice(index, 1); items.splice(op.position!, 0, current)
        }
        else if (op.action === 'update') {
          if ([op.title, op.body, op.tags, op.pages, op.context].every((v) => v === undefined)) throw fail('empty card update', 400)
          items[index] = { ...current,
            title: op.title === undefined ? current.title : sanitizeTitle(op.title),
            body: op.body === undefined ? current.body : sanitizeBody(op.body),
            tags: op.tags === undefined ? current.tags : sanitizeTags(op.tags),
            pages: op.pages === undefined ? current.pages : sanitizePages(op.pages),
            ...(op.context === undefined ? {} : { context: sanitizeContext(op.context) }),
            updatedAt: new Date(Math.max(Date.now(), (Date.parse(current.updatedAt) || 0) + 1)).toISOString(),
          }
        } else throw fail('unknown card operation', 400)
      }
    }
    if (items.length > CARD_LIMITS.items) throw fail('card limit exceeded', 400)
    return { ...doc, items, updatedAt: now }
  }, expectedHash, 'reorganize cards')
}

/* -------------------------------------------------------------------------- */
/* markdown + count                                                            */
/* -------------------------------------------------------------------------- */

function localDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Markdown block inserted into `notes.md`:
 *
 * ```markdown
 * ### 卡片：<title>
 * - 来源：p.N / 2026-11-06
 *
 * <body>
 * ```
 */
export function cardToMarkdown(card: NoteCard): string {
  const pages = card.pages.length > 0 ? `p.${card.pages.join(', p.')}` : ''
  const source = pages.length > 0 ? `${pages} / ${localDate(card.createdAt)}` : localDate(card.createdAt)
  return [`### 卡片：${card.title}`, `- 来源：${source}`, '', card.body.trim(), ''].join('\n')
}

/** Cheap card count for `paper_info` (0 when the file is missing/corrupt). */
export async function cardCount(root: string, paperId: string): Promise<number> {
  try {
    return (await readCards(root, paperId)).items.length
  } catch {
    return 0
  }
}
