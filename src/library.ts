/**
 * Library storage (DESIGN §2 / §3.8): layout, paper CRUD, inbox imports,
 * BibTeX and aggregate stats. The library is a plain directory; everything
 * here can be rebuilt by re-reading it.
 *
 * Safety rules enforced in this module:
 *   - every path is resolved through `safeJoin` (inside the root),
 *   - meta/notes writes are atomic and preserve unknown meta.json keys,
 *   - a failed import never leaves a half-created paper directory behind,
 *   - one corrupt paper can never fail `listPapers`.
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Language } from './config.js'
import {
  crossrefByDoi,
  crossrefRecordMatches,
  crossrefSearch,
  guessFromFileName,
  guessFromPdf,
  mergeGuess,
  normalizeDoi,
} from './metadata.js'
import type { PdfGuess } from './metadata.js'
import { autoTags, type AutoTagFn } from './autotag.js'
import {
  extractNotePreview,
  initialNotesMarkdown,
  noteSections,
  notesDisposition,
  readNotes,
} from './notes.js'
import { isPdfFile, pdfPageCount, readTextCache } from './pdf.js'
import type {
  PaperDetail,
  PaperMeta,
  PaperSource,
  PaperStatus,
  PaperSummary,
} from './types.js'
import {
  atomicWrite,
  fileInfo,
  nowIso,
  posixJoin,
  readJsonFile,
  safeJoin,
  sha256,
  sha256File,
  slugify,
  writeJsonFile,
} from './util.js'

export const PAPERS_DIR = 'papers'
export const INBOX_DIR = '_inbox'
export const INTERNAL_DIR = '.paperdesk'

const CONFLICTS_DIR = 'conflicts'
const TRASH_DIR = 'trash'
const CACHE_DIR = 'cache'
const META_FILE = 'meta.json'
const NOTES_FILE = 'notes.md'
const DEFAULT_PDF_FILE = 'paper.pdf'

const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const STATUSES: PaperStatus[] = ['unread', 'reading', 'read', 'archived']
const SOURCES: PaperSource[] = ['import', 'arxiv', 'doi', 'inbox', 'agent']

function assertPaperId(paperId: string): void {
  if (!PAPER_ID_RE.test(paperId)) throw new Error(`invalid paper id: ${paperId}`)
}

function paperDirRel(paperId: string): string {
  return posixJoin(PAPERS_DIR, paperId)
}

function metaRel(paperId: string): string {
  return posixJoin(PAPERS_DIR, paperId, META_FILE)
}

/** Keep a client-supplied PDF file name a single safe basename. */
function sanitizePdfFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name === '.' || name === '..' || name.includes('\0')) return null
  if (name.includes('/') || name.includes('\\')) return null
  if (name !== path.basename(name)) return null
  return name
}

/** Anchors the {@link trashStamp} / conflict copy formats. */
function trashStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed.length > 0) out.push(trimmed)
  }
  return out
}

function isStatus(value: unknown): value is PaperStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value)
}

function isSource(value: unknown): value is PaperSource {
  return typeof value === 'string' && (SOURCES as string[]).includes(value)
}

function normalizeYear(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const year = Math.trunc(value)
  if (year < 1000 || year > 9999) return null
  return year
}

function clampRating(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.trunc(value), 0), 5)
}

/** A complete meta object for a paper that has no readable meta.json. */
function emptyMeta(id: string): PaperMeta {
  const now = nowIso()
  return {
    schemaVersion: 1,
    id,
    title: '',
    authors: [],
    year: null,
    venue: '',
    doi: '',
    url: '',
    abstract: '',
    keywords: [],
    tags: [],
    status: 'unread',
    rating: 0,
    addedAt: now,
    updatedAt: now,
    pdfFile: DEFAULT_PDF_FILE,
    pdfSha256: null,
    pageCount: null,
    source: 'import',
    sourceUrl: '',
  }
}

/** Coerce arbitrary JSON into a PaperMeta; `null` only when it is not an object. */
function coerceMeta(raw: unknown, id: string): PaperMeta | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const base = emptyMeta(id)
  const addedAt = typeof record.addedAt === 'string' && record.addedAt.length > 0 ? record.addedAt : base.addedAt
  const updatedAt =
    typeof record.updatedAt === 'string' && record.updatedAt.length > 0 ? record.updatedAt : addedAt
  return {
    schemaVersion: 1,
    id,
    title: typeof record.title === 'string' ? record.title : '',
    authors: stringArray(record.authors),
    year: normalizeYear(record.year),
    venue: typeof record.venue === 'string' ? record.venue : '',
    doi: typeof record.doi === 'string' ? record.doi : '',
    url: typeof record.url === 'string' ? record.url : '',
    abstract: typeof record.abstract === 'string' ? record.abstract : '',
    keywords: stringArray(record.keywords),
    tags: stringArray(record.tags),
    status: isStatus(record.status) ? record.status : 'unread',
    rating: clampRating(record.rating),
    addedAt,
    updatedAt,
    pdfFile: record.pdfFile === null ? null : sanitizePdfFileName(record.pdfFile) ?? DEFAULT_PDF_FILE,
    pdfSha256: typeof record.pdfSha256 === 'string' ? record.pdfSha256.toLowerCase() : null,
    pageCount:
      typeof record.pageCount === 'number' && Number.isInteger(record.pageCount) && record.pageCount > 0
        ? record.pageCount
        : null,
    source: isSource(record.source) ? record.source : 'import',
    sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl : '',
  }
}

/** Synthetic meta for a directory whose meta.json is missing or corrupt. */
async function fallbackMeta(id: string, dirAbs: string): Promise<PaperMeta> {
  const info = await fileInfo(dirAbs)
  const meta = emptyMeta(id)
  meta.title = id
  if (info !== null) {
    const stamp = new Date(info.mtimeMs).toISOString()
    meta.addedAt = stamp
    meta.updatedAt = stamp
  }
  return meta
}

/** Create the library layout if needed (idempotent). */
export async function ensureLayout(root: string): Promise<void> {
  const dirs = [
    PAPERS_DIR,
    INBOX_DIR,
    posixJoin(INTERNAL_DIR, CONFLICTS_DIR),
    posixJoin(INTERNAL_DIR, TRASH_DIR),
    posixJoin(INTERNAL_DIR, CACHE_DIR),
  ]
  for (const dir of dirs) await mkdir(safeJoin(root, dir), { recursive: true })
}

/** Sorted ids of all paper directories (invalid names are ignored). */
export async function listPaperIds(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(safeJoin(root, PAPERS_DIR), { withFileTypes: true })
  } catch {
    return []
  }
  const ids: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!PAPER_ID_RE.test(entry.name)) continue
    ids.push(entry.name)
  }
  return ids.sort()
}

/** Read and coerce one paper's meta.json; `null` when missing/corrupt. */
export async function readMeta(root: string, paperId: string): Promise<PaperMeta | null> {
  assertPaperId(paperId)
  const raw = await readJsonFile<unknown>(safeJoin(root, metaRel(paperId)))
  return coerceMeta(raw, paperId)
}

/**
 * Persist meta.json atomically: unknown keys already on disk are preserved and
 * `updatedAt` / `schemaVersion` are refreshed on every write.
 */
export async function writeMeta(root: string, meta: PaperMeta): Promise<void> {
  assertPaperId(meta.id)
  const absPath = safeJoin(root, metaRel(meta.id))
  const existing = await readJsonFile<unknown>(absPath)
  const preserved =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  const updatedAt = nowIso()
  meta.updatedAt = updatedAt
  meta.schemaVersion = 1
  await writeJsonFile(absPath, { ...preserved, ...meta })
}

/** `slug(title|fileBase)-<8 hex sha>` (≤ 64 chars, ASCII). */
export async function makePaperId(title: string, year: number | null, sha: string): Promise<string> {
  const slugSource = title.trim() || (year !== null ? `paper ${year}` : 'paper')
  const base = slugify(slugSource, 48) || 'paper'
  const hex = /^[0-9a-f]{8,}$/i.test(sha) ? sha.slice(0, 8).toLowerCase() : sha256(`${sha}|${slugSource}|${Date.now()}`).slice(0, 8)
  const id = `${base}-${hex}`
  return id.length <= 64 ? id : id.slice(0, 64).replace(/-+$/, '')
}

/** Find an existing paper whose recorded PDF sha256 matches. */
export async function findPaperBySha(root: string, sha: string): Promise<string | null> {
  const target = sha.trim().toLowerCase()
  if (target.length === 0) return null
  for (const id of await listPaperIds(root)) {
    const meta = await readMeta(root, id).catch(() => null)
    if (meta?.pdfSha256 !== null && meta?.pdfSha256 === target) return id
  }
  return null
}

/** True when the notes body contains at least one non-empty section or free text. */
function hasSubstantiveNotes(markdown: string): boolean {
  if (markdown.trim().length === 0) return false
  const sections = noteSections(markdown)
  if (Object.values(sections).some((body) => body.trim().length > 0)) return true
  // Free-form text outside the canonical sections still counts as notes.
  let inFence = false
  for (const raw of markdown.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) return true
    if (!trimmed) continue
    if (/^#{1,6}\s/.test(trimmed)) continue
    return true
  }
  return false
}

/**
 * iCloud "not downloaded" detection: the real file is replaced by a
 * `.<name>.icloud` placeholder (sometimes next to a zero-byte stub).
 */
async function isEvicted(absPdf: string, fileName: string, info: { size: number } | null): Promise<boolean> {
  let placeholder = await fileInfo(path.join(path.dirname(absPdf), `.${fileName}.icloud`))
  if (placeholder === null) {
    // Older macOS builds add a `.icloud` extension instead of a dot prefix.
    placeholder = await fileInfo(`${absPdf}.icloud`)
  }
  if (placeholder === null) return false
  return info === null || info.size === 0
}

interface PdfExtras {
  pdfBytes: number
  pdfExists: boolean
  pdfEvicted: boolean
}

async function pdfExtras(root: string, paperId: string, pdfFile: string | null): Promise<PdfExtras> {
  if (pdfFile === null) return { pdfBytes: 0, pdfExists: false, pdfEvicted: false }
  const absPath = safeJoin(root, posixJoin(PAPERS_DIR, paperId, pdfFile))
  const info = await fileInfo(absPath)
  return {
    pdfBytes: info?.size ?? 0,
    pdfExists: info !== null,
    pdfEvicted: await isEvicted(absPath, pdfFile, info),
  }
}

/** One list row; tolerates every kind of broken paper. */
async function summaryOf(root: string, paperId: string): Promise<PaperSummary> {
  const dirAbs = safeJoin(root, paperDirRel(paperId))
  const meta = (await readMeta(root, paperId)) ?? (await fallbackMeta(paperId, dirAbs))
  const pdfFile = sanitizePdfFileName(meta.pdfFile)
  const pdf = await pdfExtras(root, paperId, pdfFile)

  let markdown = ''
  try {
    markdown = (await readNotes(root, paperId)).markdown
  } catch {
    markdown = ''
  }
  const hasNotes = hasSubstantiveNotes(markdown)
  return toSummary(meta, {
    pdfBytes: pdf.pdfBytes,
    hasNotes,
    notePreview: hasNotes ? extractNotePreview(markdown) : '',
    pdfEvicted: pdf.pdfEvicted,
  })
}

/** Rows for the library list, newest first. Never throws for one bad paper. */
export async function listPapers(root: string): Promise<PaperSummary[]> {
  const ids = await listPaperIds(root)
  const rows: PaperSummary[] = []
  for (const id of ids) {
    try {
      rows.push(await summaryOf(root, id))
    } catch {
      try {
        const meta = await fallbackMeta(id, safeJoin(root, paperDirRel(id)))
        rows.push(
          toSummary(meta, { pdfBytes: 0, hasNotes: false, notePreview: '', pdfEvicted: false }),
        )
      } catch {
        // A directory we cannot even stat is simply skipped.
      }
    }
  }
  rows.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id))
  return rows
}

/** Full reader payload: meta, notes, cached text and PDF state. */
export async function getPaper(root: string, paperId: string): Promise<PaperDetail | null> {
  assertPaperId(paperId)
  const dirRel = paperDirRel(paperId)
  const dirAbs = safeJoin(root, dirRel)
  const [meta, dirInfo] = await Promise.all([readMeta(root, paperId), fileInfo(dirAbs)])
  if (meta === null && dirInfo === null) return null
  const effective = meta ?? (await fallbackMeta(paperId, dirAbs))

  let notes = { markdown: '', hash: '', mtimeMs: 0, exists: false }
  try {
    notes = await readNotes(root, paperId)
  } catch {
    // Invalid id was already rejected above; a read error means "no notes".
  }
  let text = null
  try {
    text = await readTextCache(root, paperId)
  } catch {
    text = null
  }
  const pdf = await pdfExtras(root, paperId, sanitizePdfFileName(effective.pdfFile))
  return {
    meta: effective,
    notes,
    text,
    pdfBytes: pdf.pdfBytes,
    pdfExists: pdf.pdfExists,
    pdfEvicted: pdf.pdfEvicted,
    dirRelPath: dirRel,
  }
}

/** Options for {@link createPaper}. */
export interface CreatePaperOptions {
  bytes?: Uint8Array
  sourcePath?: string
  fileName?: string
  source: PaperSource
  sourceUrl?: string
  meta?: Partial<PaperMeta>
  enrich?: boolean
  /** Optional host-side tagger (LLM); falls back to the local taxonomy. */
  autoTag?: AutoTagFn
  language: Language
  device?: string
}

function stripPdfExtension(fileName: string): string {
  return path.basename(fileName).replace(/\.pdf$/i, '').trim()
}

/** Combine the PDF guess with the (lower-priority) file-name guess. */
function combineGuesses(pdfGuess: PdfGuess, fileGuess: PdfGuess): PdfGuess {
  const combined: PdfGuess = {
    authors: pdfGuess.authors.length > 0 ? pdfGuess.authors : fileGuess.authors,
  }
  const title = pdfGuess.title?.trim() || fileGuess.title?.trim()
  if (title) combined.title = title
  const year = pdfGuess.year ?? fileGuess.year ?? null
  if (year !== null) combined.year = year
  const doi = pdfGuess.doi ?? fileGuess.doi
  if (doi) combined.doi = normalizeDoi(doi) ?? doi
  const arxivId = pdfGuess.arxivId ?? fileGuess.arxivId
  if (arxivId) combined.arxivId = arxivId
  const venue = pdfGuess.venue?.trim() || fileGuess.venue?.trim()
  if (venue) combined.venue = venue
  const abstract = pdfGuess.abstract?.trim() || fileGuess.abstract?.trim()
  if (abstract) combined.abstract = abstract
  return combined
}

/** Guess metadata from the PDF + file name, optionally filling gaps from Crossref. */
async function buildGuess(
  pdfAbs: string,
  fileName: string,
  enrich: boolean,
): Promise<{ guess: PdfGuess; crossrefUrl: string }> {
  const pdfGuess = await guessFromPdf(pdfAbs).catch((): PdfGuess => ({ authors: [] }))
  const fileGuess = guessFromFileName(fileName)
  let guess = combineGuesses(pdfGuess, fileGuess)

  let crossrefUrl = ''
  const searchTitle = guess.title?.trim() ?? ''
  // Only ask Crossref when we have a real identifier, or a title substantial
  // enough to be a bibliographic query (a bare file name is too weak).
  if (enrich && (guess.doi !== undefined || searchTitle.length >= 8)) {
    const query = [searchTitle, guess.authors.slice(0, 3).join(' ')]
      .filter((part) => part.length > 0)
      .join(' ')
    const record = guess.doi
      ? await crossrefByDoi(guess.doi).catch(() => null)
      : await crossrefSearch(query, undefined, searchTitle, guess.year ?? null).catch(() => null)
    // Never merge a record whose title/year do not match the PDF: Crossref
    // always returns a best match, and a wrong DOI/abstract is worse than an
    // empty field.
    if (record !== null && crossrefRecordMatches(record, searchTitle, guess.year ?? null)) {
      guess = mergeGuess(guess, record)
      crossrefUrl = record.url?.trim() ?? ''
    }
  }
  return { guess, crossrefUrl }
}

/** Pick a free id in the (extremely unlikely) case of a slug collision. */
async function uniquePaperId(root: string, title: string, year: number | null, sha: string): Promise<string> {
  const base = await makePaperId(title, year, sha)
  let candidate = base
  let counter = 1
  for (;;) {
    const exists = (await fileInfo(safeJoin(root, paperDirRel(candidate)))) !== null
    if (!exists) return candidate
    counter += 1
    const suffix = `-${counter}`
    candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`
  }
}

/**
 * Import a PDF (uploaded bytes or a Host path), dedupe by sha256, merge
 * metadata and write meta + initial notes. A failure removes the entire
 * half-created paper directory.
 */
export async function createPaper(
  root: string,
  opts: CreatePaperOptions,
): Promise<{ id: string; meta: PaperMeta; duplicated: boolean }> {
  await ensureLayout(root)

  const sourceName =
    opts.fileName ?? (opts.sourcePath !== undefined ? path.basename(opts.sourcePath) : DEFAULT_PDF_FILE)
  const safeName = path.basename(sourceName).replace(/\0/g, '') || DEFAULT_PDF_FILE
  const tempDirRel = posixJoin(INTERNAL_DIR, CACHE_DIR, `import-${randomUUID()}`)
  const tempDirAbs = safeJoin(root, tempDirRel)
  const tempAbs = safeJoin(root, posixJoin(tempDirRel, safeName))
  let createdDirAbs: string | null = null

  try {
    await mkdir(tempDirAbs, { recursive: true })

    if (opts.bytes !== undefined) {
      if (opts.bytes.length === 0) throw new Error('PDF content is empty')
      await writeFile(tempAbs, opts.bytes)
    } else if (opts.sourcePath !== undefined) {
      if (!path.isAbsolute(opts.sourcePath)) throw new Error(`sourcePath must be absolute: ${opts.sourcePath}`)
      const absolute = path.resolve(opts.sourcePath)
      const info = await stat(absolute).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw new Error(`file not found: ${absolute}`)
      if (info.size === 0) {
        throw new Error(`file is empty or not downloaded from the cloud yet: ${absolute}`)
      }
      await copyFile(absolute, tempAbs)
    } else {
      throw new Error('createPaper requires bytes or sourcePath')
    }

    if (!(await isPdfFile(tempAbs))) throw new Error(`not a PDF file: ${safeName}`)
    const sha = (await sha256File(tempAbs)).toLowerCase()

    const duplicateId = await findPaperBySha(root, sha)
    if (duplicateId !== null) {
      const duplicateMeta =
        (await readMeta(root, duplicateId)) ??
        (await fallbackMeta(duplicateId, safeJoin(root, paperDirRel(duplicateId))))
      // The temp copy has served its purpose: never leave it behind in cache/.
      await rm(tempDirAbs, { recursive: true, force: true }).catch(() => {})
      return { id: duplicateId, meta: duplicateMeta, duplicated: true }
    }

    const explicit = opts.meta ?? {}
    const { guess, crossrefUrl } = await buildGuess(tempAbs, safeName, opts.enrich === true)

    const explicitTitle = explicit.title?.trim() ?? ''
    const explicitAuthors = stringArray(explicit.authors)
    const title =
      explicitTitle ||
      guess.title?.trim() ||
      stripPdfExtension(safeName) ||
      'Untitled'
    const authors = explicitAuthors.length > 0 ? explicitAuthors : guess.authors
    const year = normalizeYear(explicit.year) ?? normalizeYear(guess.year ?? null)
    const doi = normalizeDoi(explicit.doi ?? '') ?? guess.doi ?? ''
    const venue = explicit.venue?.trim() || guess.venue?.trim() || ''
    const abstract = explicit.abstract?.trim() || guess.abstract?.trim() || ''
    const arxivId = guess.arxivId
    const url =
      explicit.url?.trim() ||
      crossrefUrl ||
      (doi ? `https://doi.org/${doi}` : '') ||
      (arxivId ? `https://arxiv.org/abs/${arxivId}` : '')
    const keywords = stringArray(explicit.keywords)
    const explicitTags = stringArray(explicit.tags)
    let tags = explicitTags
    if (tags.length === 0 && abstract.trim().length > 0) {
      // Prefer the Host LLM (abstract + introduction). If no model is
      // available the tagger itself falls back to the deterministic taxonomy.
      let generated: readonly string[] = []
      if (opts.autoTag !== undefined) {
        try {
          generated = await opts.autoTag({ title, abstract, keywords, venue, pdfAbs: tempAbs })
        } catch {
          generated = []
        }
      }
      if (generated.length === 0) {
        generated = autoTags({ title, abstract, keywords, venue })
      }
      tags = generated
        .map((tag) => String(tag).trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 5)
    }

    const id = await uniquePaperId(root, title, year, sha)
    const dirRel = paperDirRel(id)
    const dirAbs = safeJoin(root, dirRel)
    await mkdir(dirAbs, { recursive: true })
    createdDirAbs = dirAbs

    const pdfRel = posixJoin(dirRel, DEFAULT_PDF_FILE)
    const pdfAbs = safeJoin(root, pdfRel)
    await rename(tempAbs, pdfAbs)
    // The PDF now lives in papers/<id>/; drop the empty staging directory.
    await rm(tempDirAbs, { recursive: true, force: true }).catch(() => {})
    const pageCount = await pdfPageCount(pdfAbs).catch(() => null)

    const now = nowIso()
    const meta: PaperMeta = {
      schemaVersion: 1,
      id,
      title,
      authors,
      year,
      venue,
      doi,
      url,
      abstract,
      keywords,
      tags,
      status: isStatus(explicit.status) ? explicit.status : 'unread',
      rating: clampRating(explicit.rating),
      addedAt: now,
      updatedAt: now,
      pdfFile: DEFAULT_PDF_FILE,
      pdfSha256: sha,
      pageCount,
      source: opts.source,
      sourceUrl: opts.sourceUrl?.trim() || explicit.sourceUrl?.trim() || '',
    }
    await writeMeta(root, meta)

    if (!(await notesDisposition(root, id)).exists) {
      await atomicWrite(safeJoin(root, posixJoin(dirRel, NOTES_FILE)), initialNotesMarkdown(meta, opts.language))
    }

    return { id, meta, duplicated: false }
  } catch (error) {
    await rm(tempDirAbs, { recursive: true, force: true }).catch(() => {})
    if (createdDirAbs !== null) await rm(createdDirAbs, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** Apply the whitelisted editable metadata fields from a patch. */
function applyMetaPatch(meta: PaperMeta, patch: Partial<PaperMeta>): void {
  if (patch.title !== undefined) {
    if (typeof patch.title === 'string') meta.title = patch.title.trim()
  }
  if (Array.isArray(patch.authors)) meta.authors = stringArray(patch.authors)
  if (patch.year !== undefined) {
    if (patch.year === null) meta.year = null
    else {
      const year = normalizeYear(patch.year)
      if (year !== null) meta.year = year
    }
  }
  if (patch.venue !== undefined && typeof patch.venue === 'string') meta.venue = patch.venue.trim()
  if (patch.doi !== undefined && typeof patch.doi === 'string') {
    meta.doi = normalizeDoi(patch.doi) ?? patch.doi.trim()
  }
  if (patch.url !== undefined && typeof patch.url === 'string') meta.url = patch.url.trim()
  if (patch.abstract !== undefined && typeof patch.abstract === 'string') {
    meta.abstract = patch.abstract.trim()
  }
  if (Array.isArray(patch.keywords)) meta.keywords = stringArray(patch.keywords)
  if (Array.isArray(patch.tags)) {
    const tags: string[] = []
    for (const tag of stringArray(patch.tags)) if (!tags.includes(tag)) tags.push(tag)
    meta.tags = tags
  }
  if (patch.status !== undefined && isStatus(patch.status)) meta.status = patch.status
  if (typeof patch.rating === 'number') meta.rating = clampRating(patch.rating)
  if (patch.pdfFile !== undefined) {
    if (patch.pdfFile === null) meta.pdfFile = null
    else {
      const name = sanitizePdfFileName(patch.pdfFile)
      if (name !== null) meta.pdfFile = name
    }
  }
}

/**
 * Update whitelisted metadata fields (id/addedAt/schemaVersion/path fields can
 * never be patched through here) and refresh `updatedAt`.
 */
export async function updateMeta(
  root: string,
  paperId: string,
  patch: Partial<PaperMeta>,
): Promise<PaperMeta> {
  assertPaperId(paperId)
  const current = await readMeta(root, paperId)
  if (current === null) throw new Error(`paper not found: ${paperId}`)
  const next: PaperMeta = {
    ...current,
    authors: [...current.authors],
    keywords: [...current.keywords],
    tags: [...current.tags],
  }
  applyMetaPatch(next, patch)
  next.updatedAt = nowIso()
  await writeMeta(root, next)
  return next
}

/** Move a paper directory into `.paperdesk/trash/` (never unlink). */
export async function deletePaper(root: string, paperId: string): Promise<{ trashed: string }> {
  assertPaperId(paperId)
  const sourceAbs = safeJoin(root, paperDirRel(paperId))
  const info = await fileInfo(sourceAbs)
  if (info === null) throw new Error(`paper not found: ${paperId}`)

  const trashRel = posixJoin(INTERNAL_DIR, TRASH_DIR)
  await mkdir(safeJoin(root, trashRel), { recursive: true })
  const stamp = trashStamp()
  let name = `${paperId}-${stamp}`
  let relTarget = posixJoin(trashRel, name)
  let counter = 1
  while ((await fileInfo(safeJoin(root, relTarget))) !== null) {
    counter += 1
    name = `${paperId}-${stamp}-${counter}`
    relTarget = posixJoin(trashRel, name)
  }
  await rename(sourceAbs, safeJoin(root, relTarget))
  return { trashed: relTarget }
}

/** Library counters used by `/status` and the tools. */
export async function stats(
  root: string,
): Promise<{ papers: number; unread: number; reading: number; read: number; withNotes: number; pdfsMissing: number }> {
  const papers = await listPapers(root)
  let unread = 0
  let reading = 0
  let read = 0
  let withNotes = 0
  let pdfsMissing = 0
  for (const paper of papers) {
    if (paper.status === 'unread') unread += 1
    else if (paper.status === 'reading') reading += 1
    else if (paper.status === 'read') read += 1
    if (paper.hasNotes) withNotes += 1
    if (paper.pdfBytes === 0) pdfsMissing += 1
  }
  return { papers: papers.length, unread, reading, read, withNotes, pdfsMissing }
}

/**
 * Import every PDF dropped into `_inbox/`. Successfully imported files are
 * removed from the inbox (known duplicates too). Returns the ids of
 * *newly* created papers (an already-known paper is not counted).
 */
export async function importInbox(root: string, language: Language, autoTag?: AutoTagFn): Promise<string[]> {
  let entries
  try {
    entries = await readdir(safeJoin(root, INBOX_DIR), { withFileTypes: true })
  } catch {
    return []
  }
  const imported: string[] = []
  const seen = new Set<string>()
  const candidates = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && /\.pdf$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  for (const name of candidates) {
    const absPath = safeJoin(root, posixJoin(INBOX_DIR, name))
    const info = await fileInfo(absPath)
    // Zero-byte files are usually iCloud placeholders: leave them for later.
    if (info === null || info.size === 0) continue
    try {
      const created = await createPaper(root, { sourcePath: absPath, source: 'inbox', language, autoTag })
      await rm(absPath, { force: true }).catch(() => {})
      if (!created.duplicated && !seen.has(created.id)) {
        seen.add(created.id)
        imported.push(created.id)
      }
    } catch {
      // Unreadable or invalid PDF: keep it in the inbox so the user can see it.
    }
  }
  return imported
}

const BIBTEX_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'on',
  'in',
  'for',
  'to',
  'and',
  'with',
  'towards',
  'toward',
  'from',
  'by',
  'at',
  'as',
  'is',
  'are',
  'using',
  'via',
])

/** Escape a BibTeX field value (braces/backslashes) and collapse whitespace. */
function bibtexEscape(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/([{}])/g, '\\$1')
}

/** Citation key style `lastnameYearFirstWord` (stopwords skipped). */
function bibtexKey(meta: PaperMeta): string {
  const firstAuthor = meta.authors[0]?.trim() ?? ''
  const lastName = firstAuthor.split(/\s+/).filter(Boolean).pop() ?? ''
  const authorPart = slugify(lastName, 24).replace(/-/g, '') || 'paper'
  const yearPart = meta.year !== null ? String(meta.year) : ''
  const words = meta.title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0)
  const firstWord = words.find((word) => !BIBTEX_STOPWORDS.has(word.toLowerCase())) ?? words[0] ?? ''
  const titlePart = slugify(firstWord, 24).replace(/-/g, '') || 'untitled'
  return `${authorPart}${yearPart}${titlePart}`
}

function bibtexEntry(meta: PaperMeta, key: string): string {
  const fields: string[] = []
  const push = (name: string, value: string): void => {
    if (value.length > 0) fields.push(`  ${name} = {${bibtexEscape(value)}}`)
  }
  push('title', meta.title)
  push('author', meta.authors.join(' and '))
  push('journal', meta.venue)
  push('year', meta.year !== null ? String(meta.year) : '')
  push('doi', meta.doi)
  push('url', meta.url)
  push('keywords', meta.keywords.join(', '))
  return `@article{${key},\n${fields.join(',\n')}${fields.length > 0 ? '\n' : ''}}`
}

/**
 * BibTeX for the whole library (year desc) or an explicit id list (given
 * order). Unknown ids are skipped instead of failing the export.
 */
export async function bibtexOf(root: string, ids?: string[]): Promise<string> {
  const metas: PaperMeta[] = []
  if (ids !== undefined && ids.length > 0) {
    const seen = new Set<string>()
    for (const raw of ids) {
      const id = raw.trim()
      if (!PAPER_ID_RE.test(id) || seen.has(id)) continue
      seen.add(id)
      const meta = await readMeta(root, id).catch(() => null)
      if (meta !== null) metas.push(meta)
    }
  } else {
    for (const id of await listPaperIds(root)) {
      const meta = await readMeta(root, id).catch(() => null)
      if (meta !== null) metas.push(meta)
    }
    metas.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title))
  }

  const used = new Map<string, number>()
  const entries = metas.map((meta) => {
    const base = bibtexKey(meta)
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    let key = base
    if (count > 0) key = count <= 26 ? `${base}${String.fromCharCode(96 + count)}` : `${base}${count}`
    return bibtexEntry(meta, key)
  })
  return entries.length > 0 ? `${entries.join('\n\n')}\n` : ''
}

/** Map a PaperMeta + filesystem extras into the list row type. */
export function toSummary(
  meta: PaperMeta,
  extras: { pdfBytes: number; hasNotes: boolean; notePreview: string; pdfEvicted: boolean },
): PaperSummary {
  return {
    id: meta.id,
    title: meta.title,
    authors: meta.authors,
    year: meta.year,
    venue: meta.venue,
    doi: meta.doi,
    tags: meta.tags,
    status: meta.status,
    rating: meta.rating,
    addedAt: meta.addedAt,
    updatedAt: meta.updatedAt,
    pageCount: meta.pageCount,
    pdfBytes: extras.pdfBytes,
    hasNotes: extras.hasNotes,
    notePreview: extras.notePreview,
    pdfEvicted: extras.pdfEvicted,
  }
}
