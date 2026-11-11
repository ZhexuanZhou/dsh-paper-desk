/**
 * PDF text extraction (DESIGN §3.4).
 *
 * Uses the pdfjs-dist *legacy* build so it runs in plain Node (no DOM/worker
 * setup required). Every extraction is bounded by a hard deadline and the
 * pdfjs loading task is always destroyed — a malformed PDF must never hang the
 * Host process.
 *
 * The extraction result is cached as `<root>/papers/<paperId>/text.json`
 * (`ExtractedText` in src/types.ts). The cache is rebuildable at any time and
 * carries the sha256 of the PDF it was produced from, so a re-imported or
 * replaced PDF invalidates it automatically.
 */

import { open, readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ExtractedText, PageText } from './types.js'
import { nowIso, posixJoin, readJsonFile, safeJoin, sha256, writeJsonFile } from './util.js'

/** Directory name of paper subdirectories inside the library root (DESIGN §2). */
const PAPERS_DIR = 'papers'
/** File name of the per-paper text cache inside a paper directory. */
const TEXT_CACHE_FILE = 'text.json'

/** Maximum characters kept for a single page (tables/OCR PDFs can be huge). */
const MAX_PAGE_CHARS = 20_000
/** "Low text" heuristic: fewer than this many non-space chars… */
const LOW_TEXT_LIMIT = 200
/** …across the first N pages → the PDF is probably scanned. */
const LOW_TEXT_PAGES = 3

/** Hard wall-clock bound for a full text extraction. */
const EXTRACT_TIMEOUT_MS = 60_000
/** Hard wall-clock bound for a metadata-only page count. */
const PAGE_COUNT_TIMEOUT_MS = 30_000

type PdfTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
type PdfLoadingTask = ReturnType<typeof getDocument>

const require = createRequire(import.meta.url)

interface PdfAssetUrls {
  cMapUrl?: string
  standardFontDataUrl?: string
}

let cachedAssetUrls: PdfAssetUrls | undefined

/**
 * Resolve the bundled CMap / standard-font directories from the installed
 * `pdfjs-dist` package. They are required for CJK encodings and for PDFs that
 * rely on the standard 14 fonts; pdfjs logs warnings and may drop glyphs
 * without them.
 */
function pdfAssetUrls(): PdfAssetUrls {
  if (cachedAssetUrls !== undefined) return cachedAssetUrls
  try {
    const pkgJson = require.resolve('pdfjs-dist/package.json')
    const pkgDir = path.dirname(pkgJson)
    cachedAssetUrls = {
      cMapUrl: path.join(pkgDir, 'cmaps') + path.sep,
      standardFontDataUrl: path.join(pkgDir, 'standard_fonts') + path.sep,
    }
  } catch {
    // Keep extraction working (degraded) if the package layout changes.
    cachedAssetUrls = {}
  }
  return cachedAssetUrls
}

/** Shared pdfjs document options. */
function documentParams(data: Uint8Array) {
  return {
    data,
    // Node has no browser fetch/worker for the bundled assets.
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    cMapPacked: true,
    ...pdfAssetUrls(),
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

/** Turn pdfjs failures into stable, descriptive errors for the HTTP layer. */
function pdfFailure(error: unknown, absPath: string): Error {
  if (error instanceof Error && /timed out/i.test(error.message)) return error
  if (error instanceof Error && /Cannot read PDF/i.test(error.message)) return error
  const name = (error as { name?: unknown } | null)?.name
  const message = errorMessage(error)
  const base = path.basename(absPath)
  if (name === 'PasswordException' || /password|encrypt/i.test(message)) {
    return new Error(`PDF is encrypted or password-protected and cannot be read: ${base}`)
  }
  if (name === 'InvalidPDFException' || /invalid pdf|format error|bad pdf/i.test(message)) {
    return new Error(`PDF file is invalid or corrupted: ${base}`)
  }
  return new Error(`Failed to open PDF ${base}: ${message}`)
}

function timeoutError(absPath: string, ms: number): Error {
  return new Error(
    `PDF ${path.basename(absPath)} timed out: extraction exceeded ${Math.round(ms / 1000)}s`,
  )
}

/**
 * Race a promise against an absolute deadline. The deadline is derived from a
 * per-call `deadline` (epoch ms) so a slow PDF cannot reset its own budget.
 */
async function withDeadline<T>(
  deadline: number,
  work: Promise<T>,
  absPath: string,
  totalMs: number,
): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw timeoutError(absPath, totalMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutError(absPath, totalMs)), remaining)
    timer.unref?.()
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function readPdfBytes(absPath: string): Promise<Uint8Array> {
  try {
    const buffer = await readFile(absPath)
    // Copy out of the Buffer pool: pdfjs transfers (detaches) the typed array.
    return new Uint8Array(buffer)
  } catch (error) {
    throw new Error(`Cannot read PDF "${absPath}": ${errorMessage(error)}`)
  }
}

/** Join pdfjs text items into readable text, preserving line breaks. */
function textFromItems(items: PdfTextContent['items']): string {
  const parts: string[] = []
  for (const item of items) {
    if (!('str' in item)) continue
    const str = item.str
    if (!str) continue
    parts.push(str, item.hasEOL ? '\n' : ' ')
  }
  return parts
    .join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function countVisibleChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

function isLowText(pages: PageText[]): boolean {
  let count = 0
  for (const page of pages) {
    if (page.page > LOW_TEXT_PAGES) break
    count += countVisibleChars(page.text)
  }
  return count < LOW_TEXT_LIMIT
}

/**
 * Extract text from every page of a PDF, capped per page, and report whether
 * the document looks like a scanned PDF (`lowText`).
 *
 * Throws a descriptive `Error` for unreadable/encrypted/corrupt PDFs and on
 * timeout; callers (e.g. `ensureText`) may degrade to `text: null`.
 */
export async function extractText(absPath: string, maxPages = 0): Promise<ExtractedText> {
  const bytes = await readPdfBytes(absPath)
  const sourceSha256 = sha256(bytes)
  const deadline = Date.now() + EXTRACT_TIMEOUT_MS
  const loadingTask = getDocument(documentParams(bytes))
  try {
    const doc = await withDeadline(deadline, loadingTask.promise, absPath, EXTRACT_TIMEOUT_MS)
    const pageCount = doc.numPages
    const pages: PageText[] = []

    const lastPage = maxPages > 0 ? Math.min(pageCount, Math.floor(maxPages)) : pageCount
    for (let pageNumber = 1; pageNumber <= lastPage; pageNumber += 1) {
      const page = await withDeadline(
        deadline,
        doc.getPage(pageNumber),
        absPath,
        EXTRACT_TIMEOUT_MS,
      )
      try {
        const content = await withDeadline(
          deadline,
          page.getTextContent(),
          absPath,
          EXTRACT_TIMEOUT_MS,
        )
        const text = textFromItems(content.items).slice(0, MAX_PAGE_CHARS)
        if (text.length > 0) pages.push({ page: pageNumber, text })
      } finally {
        page.cleanup()
      }
    }

    return {
      schemaVersion: 1,
      sourceSha256,
      pageCount,
      extractedAt: nowIso(),
      pages,
      lowText: isLowText(pages),
    }
  } catch (error) {
    throw pdfFailure(error, absPath)
  } finally {
    await loadingTask.destroy().catch(() => undefined)
  }
}

/** Number of pages in a PDF, or `null` when it cannot be opened. */
export async function pdfPageCount(absPath: string): Promise<number | null> {
  let loadingTask: PdfLoadingTask | undefined
  try {
    const bytes = await readPdfBytes(absPath)
    loadingTask = getDocument(documentParams(bytes))
    const doc = await withDeadline(
      Date.now() + PAGE_COUNT_TIMEOUT_MS,
      loadingTask.promise,
      absPath,
      PAGE_COUNT_TIMEOUT_MS,
    )
    return doc.numPages
  } catch {
    return null
  } finally {
    if (loadingTask !== undefined) {
      await loadingTask.destroy().catch(() => undefined)
    }
  }
}

/**
 * Content-based PDF check: a real PDF starts with `%PDF-` within the first
 * 1 KiB (the spec tolerates leading junk). A `.pdf` extension alone is not
 * enough — the importer must reject renamed text files.
 */
export async function isPdfFile(absPath: string): Promise<boolean> {
  try {
    const handle = await open(absPath, 'r')
    try {
      const buffer = Buffer.alloc(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead <= 0) return false
      const header = buffer.subarray(0, bytesRead).toString('latin1')
      const index = header.indexOf('%PDF-')
      return index >= 0
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

function isValidExtractedText(value: unknown): value is ExtractedText {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) return false
  if (typeof record.sourceSha256 !== 'string') return false
  if (typeof record.pageCount !== 'number' || !Number.isFinite(record.pageCount)) return false
  if (!Array.isArray(record.pages)) return false
  for (const page of record.pages) {
    if (typeof page !== 'object' || page === null) return false
    const entry = page as Record<string, unknown>
    if (typeof entry.page !== 'number' || typeof entry.text !== 'string') return false
  }
  return true
}

function textCachePath(root: string, paperId: string): string {
  return safeJoin(root, posixJoin(PAPERS_DIR, paperId, TEXT_CACHE_FILE))
}

/** Read the cached extraction for a paper, or `null` when absent/corrupt. */
export async function readTextCache(
  root: string,
  paperId: string,
): Promise<ExtractedText | null> {
  try {
    const value = await readJsonFile<ExtractedText>(textCachePath(root, paperId))
    return isValidExtractedText(value) ? value : null
  } catch {
    // Invalid paperId (path escape) or unreadable cache: treat as absent.
    return null
  }
}

/**
 * Return the cached extraction when it matches `sha`, otherwise extract and
 * persist it. Cache write failures do not fail the call: the text itself is
 * still usable.
 */
export async function ensureText(
  root: string,
  paperId: string,
  opts: { pdfAbs: string; sha: string; force?: boolean },
): Promise<ExtractedText> {
  if (opts.force !== true) {
    const cached = await readTextCache(root, paperId)
    if (cached !== null && cached.sourceSha256 === opts.sha) return cached
  }

  const text = await extractText(opts.pdfAbs)

  try {
    const cacheAbs = textCachePath(root, paperId)
    await mkdir(path.dirname(cacheAbs), { recursive: true })
    await writeJsonFile(cacheAbs, text)
  } catch {
    // The cache is rebuildable; a read-only library must not break extraction.
  }

  return text
}

/** Text of one 1-based page (empty string when the page has no text). */
export function pageText(text: ExtractedText, page: number): string {
  const found = text.pages.find((entry) => entry.page === page)
  return found?.text ?? ''
}

/**
 * First case-insensitive match of `query` across the extracted pages.
 * `cap` bounds the snippet length (default 120 characters, ellipsis included).
 */
export function searchInText(
  text: ExtractedText,
  query: string,
  cap?: number,
): { page: number; snippet: string } | null {
  const needle = query.trim()
  if (needle.length === 0) return null
  const limit = typeof cap === 'number' && Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 120
  const lowerNeedle = needle.toLowerCase()

  for (const page of text.pages) {
    const haystack = page.text.toLowerCase()
    const index = haystack.indexOf(lowerNeedle)
    if (index < 0) continue

    const before = Math.max(0, Math.floor((limit - needle.length) / 2))
    const start = Math.max(0, index - before)
    const end = Math.min(page.text.length, index + needle.length + before)
    let snippet = page.text.slice(start, end).replace(/\s+/g, ' ').trim()
    if (start > 0) snippet = `…${snippet}`
    if (end < page.text.length) snippet = `${snippet}…`
    return { page: page.page, snippet }
  }

  return null
}


