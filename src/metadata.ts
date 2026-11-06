/**
 * PDF metadata + Crossref enrichment (DESIGN §3.5).
 *
 * `guessFromPdf` combines three sources, best first:
 *   1. the PDF Info dictionary (Title/Author/Subject),
 *   2. the XMP packet (dc:title, dc:creator, dc:description, prism:doi…),
 *   3. a page-1 layout heuristic (largest font block in the top half of the
 *      page, then the first meaningful line).
 *
 * DOI/arXiv identifiers are searched over the first two pages and the raw XMP
 * packet. Crossref lookups are best-effort: they never throw to the caller, are
 * bounded by an 8 s timeout and respect Crossref's polite-pool User-Agent.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readPackageJson } from './util.js'

/** A normalized Crossref work record (only the fields PaperDesk uses). */
export interface CrossrefRecord {
  title?: string
  authors?: string[]
  year?: number | null
  venue?: string
  doi?: string
  url?: string
  abstract?: string
}

/** Metadata guessed for a paper without any user input. */
export interface PdfGuess {
  title?: string
  authors: string[]
  year?: number | null
  doi?: string
  arxivId?: string
  venue?: string
  abstract?: string
}

type PdfLoadingTask = ReturnType<typeof getDocument>
type PdfDocument = Awaited<PdfLoadingTask['promise']>
type PdfTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
type PdfMetadata = Awaited<ReturnType<PdfDocument['getMetadata']>>
type PdfXmp = PdfMetadata['metadata']

const CROSSREF_TIMEOUT_MS = 8_000
const CROSSREF_MAILTO = 'paperdesk@example.invalid'
const CROSSREF_API = 'https://api.crossref.org'
const PDF_READ_TIMEOUT_MS = 30_000
const MAX_ABSTRACT_CHARS = 4_000

const require = createRequire(import.meta.url)

/* -------------------------------------------------------------------------- */
/* pdfjs plumbing                                                              */
/* -------------------------------------------------------------------------- */

interface PdfAssetUrls {
  cMapUrl?: string
  standardFontDataUrl?: string
}

let cachedAssetUrls: PdfAssetUrls | undefined

function pdfAssetUrls(): PdfAssetUrls {
  if (cachedAssetUrls !== undefined) return cachedAssetUrls
  try {
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'))
    cachedAssetUrls = {
      cMapUrl: path.join(pkgDir, 'cmaps') + path.sep,
      standardFontDataUrl: path.join(pkgDir, 'standard_fonts') + path.sep,
    }
  } catch {
    cachedAssetUrls = {}
  }
  return cachedAssetUrls
}

function documentParams(data: Uint8Array) {
  return {
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    cMapPacked: true,
    ...pdfAssetUrls(),
  }
}

function timeoutError(ms: number): Error {
  return new Error(`PDF metadata read timed out after ${Math.round(ms / 1000)}s`)
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutError(ms)), ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function textFromItems(items: PdfTextContent['items']): string {
  const parts: string[] = []
  for (const item of items) {
    if (!('str' in item)) continue
    if (!item.str) continue
    parts.push(item.str, item.hasEOL ? '\n' : ' ')
  }
  return parts
    .join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* -------------------------------------------------------------------------- */
/* small text helpers                                                          */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function cleanInline(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trimEnd() : value
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' '
    })
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' '
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
}

/** Remove HTML/JATS markup (Crossref abstracts are JATS XML fragments). */
function stripMarkup(value: string): string {
  let text = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  text = decodeHtmlEntities(text)
  // Decoding may have produced entities that were tag delimiters; strip again.
  text = text.replace(/<[^>]*>/g, ' ').replace(/<\/[a-z][^>]*$/i, ' ')
  return cleanInline(text)
}

function stringAt(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) return entry
    }
  }
  return undefined
}

/* -------------------------------------------------------------------------- */
/* DOI / arXiv extraction                                                      */
/* -------------------------------------------------------------------------- */

const DOI_IN_TEXT = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/g
const DOI_STRICT = /^10\.\d{4,9}\/\S+$/
const DOI_TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"”’。，；：！？）】》]+$/u

/**
 * Canonicalize a DOI: strip `doi:`, `https://doi.org/` / `dx.doi.org`
 * prefixes, surrounding punctuation and whitespace. Returns `undefined` when
 * the value is not a DOI. The result is lowercased (DOIs are case-insensitive).
 */
export function normalizeDoi(text: string): string | undefined {
  if (typeof text !== 'string') return undefined
  let value = text.trim()
  if (!value) return undefined
  value = value.replace(/^[\s<([{'"“”]+/, '')
  value = value.replace(/^doi\s*:\s*/i, '')
  value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  value = value.replace(/^doi\.org\//i, '')
  value = value.replace(/\s+/g, '')
  value = value.replace(DOI_TRAILING_PUNCTUATION, '')
  if (!DOI_STRICT.test(value)) return undefined
  return value.toLowerCase()
}

function findDoi(text: string | undefined): string | undefined {
  if (!text) return undefined
  for (const match of text.matchAll(DOI_IN_TEXT)) {
    const candidate = normalizeDoi(match[0])
    if (candidate) return candidate
  }
  return undefined
}

const ARXIV_LABELED =
  /\barxiv\s*[:\s]\s*((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}))(v\d+)?/i
const ARXIV_URL =
  /arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}))(v\d+)?/i
const ARXIV_BARE = /(?:^|[^0-9a-z])(\d{4}\.\d{4,5})(v\d+)?(?:[^0-9a-z]|$)/i
const ARXIV_OLD_STYLE = /^[a-z-]+(?:\.[a-z]{2})?\/\d{7}$/i

function acceptArxivId(id: string | undefined): string | undefined {
  if (!id) return undefined
  const modern = /^(\d{2})(\d{2})\.\d{4,5}$/.exec(id)
  if (modern) {
    const month = Number(modern[2])
    return month >= 1 && month <= 12 ? id : undefined
  }
  return ARXIV_OLD_STYLE.test(id) ? id : undefined
}

function findArxivId(text: string | undefined): string | undefined {
  if (!text) return undefined
  const match = ARXIV_LABELED.exec(text) ?? ARXIV_URL.exec(text) ?? ARXIV_BARE.exec(text)
  if (!match) return undefined
  return acceptArxivId(match[1] ?? undefined)
}

function arxivIdFromFileName(fileName: string): string | undefined {
  const base = path.basename(fileName).replace(/\.pdf$/i, '')
  const modern = /(?:^|[^0-9a-z])(\d{4}\.\d{4,5})(v\d+)?(?:[^0-9a-z]|$)/i.exec(base)
  if (modern) return acceptArxivId(modern[1] ?? undefined)
  const oldStyle = /(?:^|[^a-z0-9])([a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?(?:[^a-z0-9]|$)/i.exec(base)
  if (oldStyle) return acceptArxivId(oldStyle[1] ?? undefined)
  return undefined
}

function plausibleYear(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const year = Math.trunc(value)
  const maxYear = new Date().getFullYear() + 1
  return year >= 1900 && year <= maxYear ? year : null
}

function yearFromArxivId(id: string): number | null {
  const modern = /^(\d{2})(\d{2})\./.exec(id)
  if (modern) {
    const month = Number(modern[2])
    if (month < 1 || month > 12) return null
    const yy = Number(modern[1])
    return plausibleYear(yy >= 90 ? 1900 + yy : 2000 + yy)
  }
  const oldStyle = /\/(\d{2})(\d{2})\d{3}$/.exec(id)
  if (oldStyle) {
    const month = Number(oldStyle[2])
    if (month < 1 || month > 12) return null
    const yy = Number(oldStyle[1])
    return plausibleYear(yy >= 90 ? 1900 + yy : 2000 + yy)
  }
  return null
}

function yearFromDoi(doi: string): number | null {
  const match = /(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/.exec(doi)
  if (!match) return null
  return plausibleYear(Number(match[1]))
}

function yearFromPageText(text: string): number | null {
  if (!text) return null
  let best: number | null = null
  for (const match of text.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    const year = plausibleYear(Number(match[1]))
    if (year !== null && (best === null || year > best)) best = year
  }
  return best
}

/* -------------------------------------------------------------------------- */
/* XMP helpers                                                                 */
/* -------------------------------------------------------------------------- */

function xmpScalar(xmp: PdfXmp | null | undefined, key: string): string | undefined {
  if (!xmp) return undefined
  try {
    const value: unknown = xmp.get(key)
    if (typeof value === 'string') return cleanInline(value) || undefined
    if (Array.isArray(value)) {
      const parts = value.filter((entry): entry is string => typeof entry === 'string')
      const joined = cleanInline(parts.join('; '))
      return joined || undefined
    }
  } catch {
    // Unknown key / malformed packet: ignore.
  }
  return undefined
}

function xmpList(xmp: PdfXmp | null | undefined, key: string): string[] {
  if (!xmp) return []
  try {
    const value: unknown = xmp.get(key)
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string')
    }
  } catch {
    // ignore
  }
  return []
}

function xmpRawString(xmp: PdfXmp | null | undefined): string {
  if (!xmp) return ''
  try {
    const raw: unknown = xmp.getRaw()
    if (typeof raw === 'string') return raw
    if (raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8')
  } catch {
    // ignore
  }
  return ''
}

/** Read a tag out of the raw XMP XML (fallback for keys pdfjs does not parse). */
function xmpRawTag(raw: string, tag: string): string | undefined {
  if (!raw) return undefined
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, 'i').exec(raw)
  if (!match) return undefined
  const inner = match[1] ?? ''
  const localized = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i.exec(inner)
  const value = stripMarkup(localized?.[1] ?? inner)
  return value || undefined
}

/* -------------------------------------------------------------------------- */
/* Page-1 title heuristic                                                      */
/* -------------------------------------------------------------------------- */

interface TextRow {
  y: number
  font: number
  text: string
}

function textRows(items: PdfTextContent['items']): TextRow[] {
  const byLine = new Map<number, { y: number; font: number; parts: string[] }>()
  for (const item of items) {
    if (!('str' in item)) continue
    if (!item.str || !item.str.trim()) continue
    const transform = item.transform
    const y = Math.round(transform[5] ?? 0)
    const font = Math.max(Math.hypot(transform[2] ?? 0, transform[3] ?? 0), 0.1)
    const line = byLine.get(y) ?? { y, font: 0, parts: [] }
    line.font = Math.max(line.font, font)
    line.parts.push(item.str)
    byLine.set(y, line)
  }
  return [...byLine.values()]
    .map((line) => ({ y: line.y, font: line.font, text: cleanInline(line.parts.join(' ')) }))
    .filter((row) => row.text.length > 0)
    .sort((a, b) => b.y - a.y || a.text.localeCompare(b.text))
}

const BOILERPLATE_ROW =
  /^(?:arxiv\s*:|\[[a-z-]+(?:\.[a-z]{2})?\]|abstract\b|introduction\b|keywords?\b|figure\s+\d|table\s+\d|doi\s*:|https?:\/\/|©|copyright\b|\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\s*$)/i

function isBoilerplateRow(text: string): boolean {
  return BOILERPLATE_ROW.test(text)
}

function isTitleCandidate(text: string): boolean {
  if (text.length < 4 || text.length > 300) return false
  if (isBoilerplateRow(text)) return false
  if (/^[\d\s./-]+$/.test(text)) return false
  return true
}

function isUsefulTitle(value: string | undefined): value is string {
  if (!value) return false
  const title = cleanInline(value)
  if (title.length < 3 || title.length > 300) return false
  if (/^microsoft (word|powerpoint)/i.test(title)) return false
  if (/^(untitled|no title|document|presentation|slides?)$/i.test(title)) return false
  if (/\.(docx?|pptx?|tex|dvi|indd|rtf)$/i.test(title)) return false
  if (/^[\d\s./-]+$/.test(title)) return false
  return true
}

function isAuthorLine(text: string): boolean {
  if (text.length < 4 || text.length > 250) return false
  if (/@|https?:|university|institute|department|laborator|school of|abstract|introduction/i.test(text)) {
    return false
  }
  if (/\b(?:19|20)\d{2}\b/.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 40) return false
  return /[A-Za-z\u00c0-\u024f\u4e00-\u9fff]/.test(text)
}

function splitByExplicitSeparator(text: string): string[] {
  const parts = text
    .split(/\s*(?:;|\||·|\band\b)\s*/i)
    .map((part) => cleanInline(part))
    .filter(Boolean)
  return parts.length > 1 ? parts : []
}

function titleFromPage(
  rows: TextRow[],
  pageHeight: number,
): { title?: string; authors: string[] } {
  if (rows.length === 0) return { authors: [] }
  const topRows = rows.filter((row) => row.y >= pageHeight * 0.45)
  const pool = (topRows.length > 0 ? topRows : rows).filter((row) => isTitleCandidate(row.text))
  if (pool.length === 0) {
    const first = rows.find((row) => !isBoilerplateRow(row.text) && row.text.length >= 4)
    return { title: first ? cleanInline(first.text) : undefined, authors: [] }
  }

  let best = pool[0]
  if (best === undefined) return { authors: [] }
  for (const row of pool) {
    if (row.font > best.font * 1.02) best = row
  }

  const anchorIndex = rows.indexOf(best)
  const titleParts: string[] = [best.text]
  let titleLength = best.text.length
  for (let index = anchorIndex + 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    const next = rows[index]
    if (previous === undefined || next === undefined) break
    if (next.font < best.font * 0.92 || next.font > best.font * 1.08) break
    if (previous.y - next.y > best.font * 2.2) break
    if (titleLength + next.text.length > 280) break
    titleParts.push(next.text)
    titleLength += next.text.length + 1
  }
  const title = cleanInline(titleParts.join(' '))

  const authors: string[] = []
  for (let index = anchorIndex + titleParts.length; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    const row = rows[index]
    if (previous === undefined || row === undefined) break
    if (previous.y - row.y > best.font * 8) break
    if (row.font > best.font * 1.05) continue
    if (isAuthorLine(row.text)) {
      authors.push(...splitByExplicitSeparator(row.text))
      break
    }
  }

  return { title: title || undefined, authors }
}

/* -------------------------------------------------------------------------- */
/* guessFromPdf                                                                */
/* -------------------------------------------------------------------------- */

function infoString(info: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = info[key]
    if (typeof value === 'string') {
      const cleaned = cleanInline(value)
      if (cleaned) return cleaned
    }
  }
  return undefined
}

function cleanAuthor(value: string): string {
  let cleaned = cleanInline(value)
    .replace(/^\s*(?:and|&)\s+/i, '')
    .replace(/^[\s\d]+/, '')
    .replace(/[;,]+$/, '')
    .trim()
  // Keep the period of "et al." (it is part of the name display).
  if (!/et al\.$/i.test(cleaned)) cleaned = cleaned.replace(/\.+$/, '')
  return cleaned.trim()
}

function splitAuthorString(value: string): string[] {
  const cleaned = cleanInline(value)
  if (!cleaned) return []
  let parts: string[]
  if (cleaned.includes(';')) parts = cleaned.split(';')
  else if (cleaned.includes('|')) parts = cleaned.split('|')
  else if (/\s+and\s+/i.test(cleaned)) parts = cleaned.split(/\s+and\s+/i)
  else parts = [cleaned]
  return parts.map(cleanAuthor).filter((part) => part.length > 0)
}

function uniqueAuthors(authors: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const author of authors) {
    const cleaned = cleanAuthor(author)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
  }
  return result
}

function readFileNameGuess(absPath: string): PdfGuess {
  return guessFromFileName(path.basename(absPath))
}

/**
 * Guess title/authors/year/DOI/arXiv id from the PDF itself. Never throws:
 * a corrupt PDF degrades to whatever the file name can tell us (empty guess
 * when nothing is usable).
 */
export async function guessFromPdf(absPath: string): Promise<PdfGuess> {
  const fallback = readFileNameGuess(absPath)
  let loadingTask: PdfLoadingTask | undefined
  try {
    const bytes = new Uint8Array(await readFile(absPath))
    loadingTask = getDocument(documentParams(bytes))
    const doc = await withDeadline(loadingTask.promise, PDF_READ_TIMEOUT_MS)
    const metadataResult: PdfMetadata | null = await doc.getMetadata().catch(() => null)
    const info = asRecord(metadataResult?.info) ?? {}
    const xmp = metadataResult?.metadata ?? null
    const rawXmp = xmpRawString(xmp)
    const fileName = path.basename(absPath)

    // Title: Info dictionary first, then XMP, then page 1 below.
    const infoTitle = infoString(info, 'Title')
    const xmpTitle = xmpScalar(xmp, 'dc:title')
    let title: string | undefined
    if (isUsefulTitle(infoTitle)) title = cleanInline(infoTitle)
    else if (isUsefulTitle(xmpTitle)) title = cleanInline(xmpTitle)

    // Authors: Info dictionary first, then XMP dc:creator, then page 1 below.
    let authors = splitAuthorString(infoString(info, 'Author') ?? '')
    if (authors.length === 0) {
      authors = xmpList(xmp, 'dc:creator').flatMap(splitAuthorString)
    }

    const pageTexts: string[] = []
    let pageTitle: string | undefined
    let pageAuthors: string[] = []
    const maxPage = Math.min(2, doc.numPages)
    for (let pageNumber = 1; pageNumber <= maxPage; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        pageTexts.push(textFromItems(content.items))
        if (pageNumber === 1) {
          const rows = textRows(content.items)
          let pageHeight = 0
          try {
            pageHeight = page.getViewport({ scale: 1 }).height
          } catch {
            pageHeight = 0
          }
          const fromPage = titleFromPage(rows, pageHeight)
          pageTitle = fromPage.title
          pageAuthors = fromPage.authors
        }
      } finally {
        page.cleanup()
      }
    }

    if (!title && isUsefulTitle(pageTitle)) title = cleanInline(pageTitle)
    if (authors.length === 0) authors = pageAuthors

    const documentText = pageTexts.join('\n')
    const firstPageText = pageTexts[0] ?? ''
    const doi =
      findDoi(documentText) ??
      findDoi(rawXmp) ??
      findDoi(fileName) ??
      undefined
    const arxivId =
      acceptArxivId(
        findArxivId(documentText) ??
          findArxivId(rawXmp) ??
          findArxivId(fileName) ??
          undefined,
      ) ?? undefined

    let year: number | null = arxivId ? yearFromArxivId(arxivId) : null
    if (year === null && doi) year = yearFromDoi(doi)
    if (year === null) year = yearFromPageText(firstPageText)

    const venue =
      xmpScalar(xmp, 'prism:publicationName') ??
      xmpRawTag(rawXmp, 'prism:publicationName') ??
      (arxivId ? 'arXiv' : undefined)

    const abstractSource = xmpScalar(xmp, 'dc:description') ?? xmpRawTag(rawXmp, 'dc:description')
    const abstract = abstractSource ? clip(stripMarkup(abstractSource), MAX_ABSTRACT_CHARS) : undefined

    const guess: PdfGuess = {
      authors: uniqueAuthors(authors.length > 0 ? authors : fallback.authors),
    }
    const resolvedTitle = title ?? fallback.title
    if (resolvedTitle) guess.title = resolvedTitle
    const resolvedYear = year ?? fallback.year ?? null
    if (resolvedYear !== null) guess.year = resolvedYear
    const resolvedDoi = doi ?? fallback.doi
    if (resolvedDoi) guess.doi = resolvedDoi
    const resolvedArxiv = arxivId ?? fallback.arxivId
    if (resolvedArxiv) guess.arxivId = resolvedArxiv
    const resolvedVenue = venue ?? fallback.venue
    if (resolvedVenue) guess.venue = resolvedVenue
    const resolvedAbstract = abstract ?? fallback.abstract
    if (resolvedAbstract) guess.abstract = resolvedAbstract
    return guess
  } catch {
    // Unreadable/encrypted PDF: degrade to the file-name guess.
    return fallback
  } finally {
    if (loadingTask !== undefined) {
      await loadingTask.destroy().catch(() => undefined)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* guessFromFileName                                                           */
/* -------------------------------------------------------------------------- */

function cleanTitleCandidate(value: string): string {
  return cleanInline(
    value
      .replace(/^[\s\-–—_.,;:]+/, '')
      .replace(/[\s\-–—_,;:.]+$/, '')
      .replace(/\s*\((?:arxiv|preprint)\)\s*$/i, '')
      .replace(/\s+/g, ' '),
  )
}

function isArxivIdLike(value: string): boolean {
  return acceptArxivId(value.replace(/v\d+$/i, '').trim()) !== undefined
}

function titleFromBareName(base: string): string | undefined {
  const cleaned = cleanTitleCandidate(base)
  if (cleaned.length < 3 || cleaned.length > 300) return undefined
  if (/^[\d\s./-]+$/.test(cleaned)) return undefined
  if (isArxivIdLike(cleaned)) return undefined
  if (normalizeDoi(cleaned)) return undefined
  return cleaned
}

/**
 * Best-effort metadata from a file name. Handles the common export styles:
 *   `Author - 2020 - Title.pdf`, `Title (2020).pdf`, `2020 - Title.pdf`,
 *   `Title - Journal - 2020.pdf`, `arXiv:2401.12345 Title.pdf`, `2401.12345.pdf`.
 */
export function guessFromFileName(fileName: string): PdfGuess {
  const guess: PdfGuess = { authors: [] }
  const bare = path.basename(fileName).replace(/\.pdf$/i, '').trim()
  if (!bare) return guess

  let working = bare.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  const arxivId = arxivIdFromFileName(bare)
  if (arxivId) guess.arxivId = arxivId
  const doi = findDoi(working)
  if (doi) guess.doi = doi

  // Style: "Author(s) - 2020 - Title"
  const authorYearTitle = /^(.{2,300}?)\s+-\s+((?:19|20)\d{2})\s+-\s+(.{2,300})$/.exec(working)
  if (authorYearTitle) {
    const [, authorPart, yearPart, titlePart] = authorYearTitle
    const authors = splitAuthorString(authorPart ?? '')
    if (authors.length > 0) guess.authors = authors
    const year = plausibleYear(Number(yearPart))
    if (year !== null) guess.year = year
    const title = cleanTitleCandidate(titlePart ?? '')
    if (title) working = title
    else working = ''
  } else {
    // Style: "Title (2020)" / "Title (2020).pdf"
    const titleYear = /^(.{2,300}?)\s*\(((?:19|20)\d{2})\)\s*$/.exec(working)
    if (titleYear) {
      const year = plausibleYear(Number(titleYear[2]))
      if (year !== null) guess.year = year
      working = cleanTitleCandidate(titleYear[1] ?? '')
    } else {
      // Style: "2020 - Title"
      const yearTitle = /^((?:19|20)\d{2})\s*-\s*(.{2,300})$/.exec(working)
      if (yearTitle) {
        const year = plausibleYear(Number(yearTitle[1]))
        if (year !== null) guess.year = year
        working = cleanTitleCandidate(yearTitle[2] ?? '')
      } else {
        // Style: "Title - Journal - 2020"
        const trailingYear = /^(.{3,240}?)\s*[-–—]\s*(.{1,120}?)\s*[-–—]\s*((?:19|20)\d{2})$/.exec(working)
        if (trailingYear) {
          const year = plausibleYear(Number(trailingYear[3]))
          if (year !== null) guess.year = year
          const venue = cleanTitleCandidate(trailingYear[2] ?? '')
          if (venue) guess.venue = venue
          working = cleanTitleCandidate(trailingYear[1] ?? '')
        }
      }
    }
  }

  if (working) {
    const title = titleFromBareName(working)
    if (title) guess.title = title
  }

  if (guess.year === undefined) {
    const yearMatch = /\b((?:19|20)\d{2})\b/.exec(bare)
    if (yearMatch) {
      const year = plausibleYear(Number(yearMatch[1]))
      if (year !== null) guess.year = year
    }
  }

  return guess
}

/* -------------------------------------------------------------------------- */
/* Crossref                                                                    */
/* -------------------------------------------------------------------------- */

function crossrefUserAgent(): string {
  let version = '0.0.0'
  try {
    version = readPackageJson()?.version ?? version
  } catch {
    // ignore
  }
  return `dsh-paper-desk/${version} (mailto:${CROSSREF_MAILTO})`
}

async function fetchCrossrefJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const timeout = AbortSignal.timeout(CROSSREF_TIMEOUT_MS)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': crossrefUserAgent(),
        Accept: 'application/json',
      },
      signal: combined,
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    // Network error, timeout, aborted request, malformed JSON: all "no data".
    return null
  }
}

function datePartYear(value: unknown): number | null {
  const record = asRecord(value)
  if (!record) return null
  const parts = record['date-parts']
  if (!Array.isArray(parts)) return null
  const first = parts[0]
  if (!Array.isArray(first)) return null
  const raw = first[0]
  const year = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(year) ? plausibleYear(year) : null
}

function crossrefYear(message: Record<string, unknown>): number | null {
  const candidates: unknown[] = [
    message.issued,
    message['published-print'],
    message['published-online'],
    message['published'],
    message.created,
  ]
  for (const candidate of candidates) {
    const year = datePartYear(candidate)
    if (year !== null) return year
  }
  return null
}

function crossrefAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const authors: string[] = []
  for (const entry of value) {
    const person = asRecord(entry)
    if (!person) continue
    const name = stringAt(person.name) ?? undefined
    const given = stringAt(person.given) ?? undefined
    const family = stringAt(person.family) ?? undefined
    const literal = stringAt(person.literal) ?? undefined
    let display = ''
    if (given && family) display = `${given} ${family}`
    else if (family) display = family
    else if (literal) display = literal
    else if (name) display = name
    else if (given) display = given
    const cleaned = cleanAuthor(display)
    if (cleaned) authors.push(cleaned)
  }
  return uniqueAuthors(authors)
}

function recordFromMessage(message: unknown): CrossrefRecord | null {
  const record = asRecord(message)
  if (!record) return null

  const result: CrossrefRecord = {}

  const rawTitle = firstString(record.title)
  if (rawTitle) {
    const title = clip(stripMarkup(rawTitle), 500)
    if (title) result.title = title
  }

  const authors = crossrefAuthors(record.author)
  if (authors.length > 0) result.authors = authors

  const year = crossrefYear(record)
  if (year !== null) result.year = year

  const venueRaw = firstString(record['container-title']) ?? stringAt(record.publisher)
  if (venueRaw) {
    const venue = clip(stripMarkup(venueRaw), 300)
    if (venue) result.venue = venue
  }

  const rawDoi = stringAt(record.DOI) ?? stringAt(record.doi)
  if (rawDoi) {
    const doi = normalizeDoi(rawDoi)
    if (doi) result.doi = doi
  }

  const rawUrl = stringAt(record.URL) ?? stringAt(record.url)
  if (rawUrl) result.url = rawUrl
  else if (result.doi) result.url = `https://doi.org/${result.doi}`

  const rawAbstract = stringAt(record.abstract)
  if (rawAbstract) {
    const abstract = clip(stripMarkup(rawAbstract), MAX_ABSTRACT_CHARS)
    if (abstract) result.abstract = abstract
  }

  return Object.keys(result).length > 0 ? result : null
}

/** Crossref lookup by DOI. Returns `null` on any failure (never throws). */
export async function crossrefByDoi(
  doi: string,
  signal?: AbortSignal,
): Promise<CrossrefRecord | null> {
  const normalized = normalizeDoi(doi)
  if (!normalized) return null
  try {
    const url = `${CROSSREF_API}/works/${encodeURIComponent(normalized)}`
    const payload = await fetchCrossrefJson(url, signal)
    const message = asRecord(asRecord(payload)?.message)
    return recordFromMessage(message)
  } catch {
    return null
  }
}

/** Crossref bibliographic search (best match). Returns `null` on any failure. */
export async function crossrefSearch(
  query: string,
  signal?: AbortSignal,
): Promise<CrossrefRecord | null> {
  const cleaned = cleanInline(query)
  if (!cleaned) return null
  try {
    const url = new URL(`${CROSSREF_API}/works`)
    url.searchParams.set('query.bibliographic', cleaned.slice(0, 400))
    url.searchParams.set('rows', '5')
    url.searchParams.set('mailto', CROSSREF_MAILTO)
    const payload = await fetchCrossrefJson(url.toString(), signal)
    const items = asRecord(asRecord(payload)?.message)?.items
    if (!Array.isArray(items)) return null
    for (const item of items) {
      const record = recordFromMessage(item)
      if (record?.title) return record
    }
    return null
  } catch {
    return null
  }
}

/**
 * Merge a Crossref record into a PDF guess, filling only empty fields (the PDF
 * and the user always win).
 */
export function mergeGuess(base: PdfGuess, extra: CrossrefRecord): PdfGuess {
  const merged: PdfGuess = { ...base, authors: [...base.authors] }
  if (!merged.title && extra.title) merged.title = extra.title
  if (merged.authors.length === 0 && extra.authors && extra.authors.length > 0) {
    merged.authors = [...extra.authors]
  }
  if ((merged.year === undefined || merged.year === null) && extra.year !== undefined) {
    merged.year = extra.year
  }
  if (!merged.venue && extra.venue) merged.venue = extra.venue
  if (!merged.doi && extra.doi) merged.doi = normalizeDoi(extra.doi) ?? extra.doi
  if (!merged.abstract && extra.abstract) merged.abstract = extra.abstract
  return merged
}
