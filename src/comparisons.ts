/**
 * Saved multi-paper comparisons (DESIGN-FEATURES §2 / §5).
 *
 * Storage: `<root>/comparisons/<id>.json` (top-level folder so it syncs with the
 * library), one `PaperComparison` per file, atomic writes. Rules:
 *  - validation: 2..6 existing paper ids in presentation order, markdown
 *    1..60000 chars, title 1..200 (defaulted from the paper titles),
 *  - ids are `cmp-<YYYYMMDD-HHmmss>-<4hex>`,
 *  - the folder is created lazily; a missing folder is an empty list,
 *  - `listComparisons` never throws: unreadable/corrupt files are skipped and
 *    the result is sorted newest-first,
 *  - unknown/missing ids surface as not-found Errors tagged `status = 404`
 *    (except `readComparison`, whose contract returns `null`).
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'

import type { ComparisonSummary, PaperComparison } from './types.js'
import { fileInfo, nowIso, posixJoin, readJsonFile, safeJoin, writeJsonFile } from './util.js'

/** Top-level library folder holding saved comparisons. */
export const COMPARISONS_DIR = 'comparisons'

/** Library layout constants (kept local; mirrors `src/library.ts`). */
const PAPERS_DIR = 'papers'
const META_FILE = 'meta.json'

/** Same id contract as `src/library.ts`. */
const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Generated comparison ids: `cmp-<YYYYMMDD-HHmmss>-<4 lower hex>`. */
const COMPARISON_ID_RE = /^cmp-\d{8}-\d{6}-[0-9a-f]{4}$/

const COMPARISON_LIMITS = {
  minPapers: 2,
  maxPapers: 6,
  title: 200,
  markdown: 60000,
  preview: 180,
} as const

/** Absolute, confined path of the comparisons folder. */
function comparisonsDirAbs(root: string): string {
  return safeJoin(root, COMPARISONS_DIR)
}

/** Absolute, confined path of one comparison file (id already validated). */
function comparisonPath(root: string, id: string): string {
  return safeJoin(root, posixJoin(COMPARISONS_DIR, `${id}.json`))
}

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

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

function assertPaperId(value: unknown): string {
  if (typeof value !== 'string' || !PAPER_ID_RE.test(value.trim())) {
    throw fail(`invalid paper id: ${String(value)}`, 400)
  }
  return value.trim()
}

/** Validate the ordered 2..6 paper id list (distinct, correctly shaped). */
function sanitizePaperIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw fail('comparison paperIds must be an array', 400)
  if (value.length < COMPARISON_LIMITS.minPapers || value.length > COMPARISON_LIMITS.maxPapers) {
    throw fail(
      `a comparison needs ${COMPARISON_LIMITS.minPapers}..${COMPARISON_LIMITS.maxPapers} papers`,
      400,
    )
  }
  const paperIds: string[] = []
  for (const entry of value) {
    const id = assertPaperId(entry)
    if (paperIds.includes(id)) throw fail('comparison paper ids must be distinct', 400)
    paperIds.push(id)
  }
  return paperIds
}

function sanitizeTitle(value: unknown): string {
  if (typeof value !== 'string') throw fail('comparison title must be a string', 400)
  const title = value.trim()
  if (title.length === 0) throw fail('comparison title must not be empty', 400)
  if (title.length > COMPARISON_LIMITS.title) {
    throw fail(`comparison title is too long (max ${COMPARISON_LIMITS.title} characters)`, 400)
  }
  return title
}

function sanitizeMarkdown(value: unknown): string {
  if (typeof value !== 'string') throw fail('comparison markdown must be a string', 400)
  if (value.trim().length === 0) throw fail('comparison markdown must not be empty', 400)
  if (value.length > COMPARISON_LIMITS.markdown) {
    throw fail(
      `comparison markdown is too long (max ${COMPARISON_LIMITS.markdown} characters)`,
      400,
    )
  }
  return value
}

/** Every endpoint must be an existing paper (`papers/<id>/meta.json`). */
async function assertPapersExist(root: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const metaAbs = safeJoin(root, posixJoin(PAPERS_DIR, id, META_FILE))
    if ((await fileInfo(metaAbs)) === null) throw fail(`paper not found: ${id}`, 400)
  }
}

/** Default report title from the paper titles, truncated to the title limit. */
async function defaultTitle(root: string, paperIds: readonly string[]): Promise<string> {
  const titles: string[] = []
  for (const id of paperIds) {
    const metaAbs = safeJoin(root, posixJoin(PAPERS_DIR, id, META_FILE))
    const raw = await readJsonFile<Record<string, unknown>>(metaAbs)
    const stored = raw?.['title']
    const title = typeof stored === 'string' ? stored.trim() : ''
    titles.push(title.length > 0 ? title : id)
  }
  return titles.join(' vs ').slice(0, COMPARISON_LIMITS.title).trimEnd()
}

/* -------------------------------------------------------------------------- */
/* ids + timestamps                                                            */
/* -------------------------------------------------------------------------- */

function localStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join('-')
}

/** `cmp-<stamp>-<4hex>`; retried if that exact file already exists. */
async function allocateId(root: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = `cmp-${localStamp()}-${randomBytes(2).toString('hex')}`
    if ((await fileInfo(comparisonPath(root, id))) === null) return id
  }
  throw new Error('could not allocate a unique comparison id')
}

/** Valid stored/requested id, or `null` when the shape is wrong. */
function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return COMPARISON_ID_RE.test(id) ? id : null
}

/* -------------------------------------------------------------------------- */
/* reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Read one saved comparison; `null` when missing, corrupt or malformed id. */
export async function readComparison(
  root: string,
  id: string,
): Promise<PaperComparison | null> {
  const cleanId = normalizeId(id)
  if (cleanId === null) return null
  let raw: string
  try {
    raw = await readFile(comparisonPath(root, cleanId), 'utf8')
  } catch {
    return null
  }
  return parseComparison(raw, cleanId)
}

/**
 * Parse + coerce one comparison file. `null` means the file is not a usable
 * comparison; `listComparisons` skips it and `readComparison` returns `null`.
 */
function parseComparison(
  raw: string,
  id: string,
  fallbackIso = nowIso(),
): PaperComparison | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>

  const rawIds = record['paperIds']
  if (!Array.isArray(rawIds)) return null
  if (rawIds.length < COMPARISON_LIMITS.minPapers || rawIds.length > COMPARISON_LIMITS.maxPapers) {
    return null
  }
  const paperIds: string[] = []
  for (const entry of rawIds) {
    if (typeof entry !== 'string' || !PAPER_ID_RE.test(entry)) return null
    paperIds.push(entry)
  }

  const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
  if (title.length === 0 || title.length > COMPARISON_LIMITS.title) return null

  const markdown = record['markdown']
  if (
    typeof markdown !== 'string' ||
    markdown.trim().length === 0 ||
    markdown.length > COMPARISON_LIMITS.markdown
  ) {
    return null
  }

  const createdAt = isoOr(record['createdAt'], fallbackIso)
  const updatedAt = isoOr(record['updatedAt'], createdAt)
  // The file name is authoritative for the id (also protects against a copied
  // file whose stored id still points at the original path).
  return { id, title, paperIds, markdown, createdAt, updatedAt }
}

function isoOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function previewOf(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').trim().slice(0, COMPARISON_LIMITS.preview)
}

function toSummary(comparison: PaperComparison): ComparisonSummary {
  return {
    id: comparison.id,
    title: comparison.title,
    paperIds: comparison.paperIds,
    createdAt: comparison.createdAt,
    updatedAt: comparison.updatedAt,
    preview: previewOf(comparison.markdown),
  }
}

function isoTime(value: string): number {
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

function compareNewestFirst(a: PaperComparison, b: PaperComparison): number {
  return (
    isoTime(b.createdAt) - isoTime(a.createdAt) ||
    isoTime(b.updatedAt) - isoTime(a.updatedAt) ||
    b.id.localeCompare(a.id)
  )
}

/**
 * Summaries of every saved comparison, newest first. Unreadable, corrupt or
 * misnamed files are skipped; this function never throws.
 */
export async function listComparisons(root: string): Promise<ComparisonSummary[]> {
  let entries
  try {
    entries = await readdir(comparisonsDirAbs(root), { withFileTypes: true })
  } catch {
    return []
  }

  const comparisons: PaperComparison[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.toLowerCase().endsWith('.json')) continue
    const id = entry.name.slice(0, -'.json'.length)
    if (!COMPARISON_ID_RE.test(id)) continue
    try {
      const absPath = safeJoin(root, posixJoin(COMPARISONS_DIR, entry.name))
      const raw = await readFile(absPath, 'utf8')
      const info = await fileInfo(absPath)
      const fallbackIso = info !== null ? new Date(info.mtimeMs).toISOString() : nowIso()
      const comparison = parseComparison(raw, id, fallbackIso)
      if (comparison !== null) comparisons.push(comparison)
    } catch {
      // Unreadable or corrupt: skip this row but keep the rest of the list.
    }
  }
  comparisons.sort(compareNewestFirst)
  return comparisons.map(toSummary)
}

/* -------------------------------------------------------------------------- */
/* mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Save one AI comparison report. Validates the paper list (existence included),
 * markdown and title (defaulted from the paper titles when empty), creates the
 * folder lazily and writes the file atomically.
 */
export async function saveComparison(
  root: string,
  input: { title: string; paperIds: string[]; markdown: string },
): Promise<PaperComparison> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('comparison payload must be an object', 400)
  }
  const record = input as unknown as Record<string, unknown>
  const paperIds = sanitizePaperIds(record['paperIds'])
  await assertPapersExist(root, paperIds)
  const markdown = sanitizeMarkdown(record['markdown'])

  const requestedTitle = typeof record['title'] === 'string' ? record['title'].trim() : ''
  const title =
    requestedTitle.length > 0
      ? sanitizeTitle(requestedTitle)
      : await defaultTitle(root, paperIds)

  await mkdir(comparisonsDirAbs(root), { recursive: true })
  const id = await allocateId(root)
  const now = nowIso()
  const comparison: PaperComparison = {
    id,
    title,
    paperIds,
    markdown,
    createdAt: now,
    updatedAt: now,
  }
  await writeJsonFile(comparisonPath(root, id), comparison)
  return comparison
}

/**
 * Patch the title and/or markdown of a saved comparison; the paper list is
 * immutable. A missing file throws a not-found Error tagged `status = 404`.
 */
export async function updateComparison(
  root: string,
  id: string,
  patch: { title?: string; markdown?: string },
): Promise<PaperComparison> {
  const cleanId = normalizeId(id)
  if (cleanId === null) throw notFound(`comparison not found: ${String(id)}`)
  const current = await readComparison(root, cleanId)
  if (current === null) throw notFound(`comparison not found: ${cleanId}`)
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw fail('comparison patch must be an object', 400)
  }
  const record = patch as unknown as Record<string, unknown>
  const next: PaperComparison = { ...current }
  if (record['title'] !== undefined) next.title = sanitizeTitle(record['title'])
  if (record['markdown'] !== undefined) next.markdown = sanitizeMarkdown(record['markdown'])
  next.updatedAt = nowIso()
  await writeJsonFile(comparisonPath(root, cleanId), next)
  return next
}

/** Delete one saved comparison file. Missing files throw a tagged 404 Error. */
export async function deleteComparison(root: string, id: string): Promise<void> {
  const cleanId = normalizeId(id)
  if (cleanId === null) throw notFound(`comparison not found: ${String(id)}`)
  const absPath = comparisonPath(root, cleanId)
  if ((await fileInfo(absPath)) === null) throw notFound(`comparison not found: ${cleanId}`)
  await rm(absPath, { force: true })
}
