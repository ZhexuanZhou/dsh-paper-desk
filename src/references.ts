/**
 * Citation edges auto-extracted from PDF reference lists (DESIGN-FEATURES2 §3).
 *
 * Pipeline:
 *  1. `buildPaperIndex` maps the library's DOI / arXiv ids / normalized title
 *     token sets to paper ids,
 *  2. `extractReferences` finds the paper's reference list (last 45% of pages,
 *     heading "References" / "Bibliography" / "参考文献" …, with a last-3-pages
 *     DOI/arXiv fallback) and returns one hit per plausible reference entry,
 *  3. `findCitationCandidates` matches those hits against the index (DOI exact,
 *     arXiv exact, title containment) without ever matching the paper itself,
 *  4. `syncCitationEdges` writes deduped `cites` relations for the selected
 *     papers, reporting added / skipped / no-text / errors.
 *
 * Extraction reuses the per-paper `text.json` cache via `ensureText`, so a
 * second run is cheap; this module never writes files other than relations.
 */

import type {
  CitationSyncResult,
  ExtractedText,
  PaperMeta,
  PaperRelation,
  PageText,
} from './types.js'
import { listPaperIds, readMeta } from './library.js'
import { normalizeDoi } from './metadata.js'
import { ensureText } from './pdf.js'
import { addRelation } from './relations.js'
import { posixJoin, safeJoin, sha256File } from './util.js'

export interface ReferenceHit {
  page: number
  raw: string
  doi?: string
  arxivId?: string
}

export interface CitationCandidate {
  toId: string
  via: 'doi' | 'arxiv' | 'title'
  reference: string
  confidence: number
}

export interface PaperIndex {
  /** A DOI may be stored on several papers (e.g. a cited DOI mis-detected at
   * import); matching skips the source paper and can still resolve the target. */
  byDoi: Map<string, string[]>
  byArxiv: Map<string, string[]>
  byTitle: Map<string, { id: string; tokens: Set<string> }[]>
}

const PAPERS_DIR = 'papers'

/** Heading line of a reference list; leading "12." / "12)" numbering allowed. */
const REFERENCE_HEADING_RE =
  /^\s*(?:\d+[.)、]?\s*)?(?:references|bibliography|works cited|参考文献|引用文献)\s*[:：]?\s*$/i

/** Reference-block hard cap (characters). */
const BLOCK_CAP = 60_000
/** Chunks shorter than this are noise (headers, page numbers). */
const CHUNK_MIN = 20
/** Chunk cap sent to the matcher / stored as the edge note source. */
const CHUNK_MAX = 2_000
/** Fallback looks at this many trailing pages when no heading exists. */
const FALLBACK_PAGES = 3
/** Only titles with this many normalized tokens are used for title matching. */
const TITLE_MIN_TOKENS = 4
/** Required coverage of the paper title's tokens inside a reference chunk. */
const TITLE_COVERAGE = 0.9
/** Label written on auto-extracted edges. */
const CITES_LABEL = '自动解析'
/** Note is the raw reference slice, capped to stay readable on the edge. */
const NOTE_CAP = 280
/** DOI body as it appears in reference lists (normalized afterwards). */
const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/g
const ARXIV_RES = [
  /arXiv:\s*(\d{4}\.\d{4,5})/gi,
  /abs\/(\d{4}\.\d{4,5})/gi,
  /arXiv\.(\d{4}\.\d{4,5})/gi,
]
const ARXIV_ID_RE = /^(\d{4}\.\d{4,5})$/

/* -------------------------------------------------------------------------- */
/* text loading                                                                */
/* -------------------------------------------------------------------------- */

/** Extracted text for one paper, reusing (or creating) its text.json cache. */
async function loadExtractedText(root: string, paperId: string): Promise<ExtractedText> {
  const meta = await readMeta(root, paperId)
  if (meta === null) throw new Error(`paper not found: ${paperId}`)
  if (meta.pdfFile === null) throw new Error(`paper ${paperId} has no PDF attached`)
  const pdfAbs = safeJoin(root, posixJoin(PAPERS_DIR, paperId, meta.pdfFile))
  const sha = meta.pdfSha256 ?? (await sha256File(pdfAbs))
  return await ensureText(root, paperId, { pdfAbs, sha })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

/* -------------------------------------------------------------------------- */
/* paper index                                                                 */
/* -------------------------------------------------------------------------- */

/** DOI stored on the paper, or one embedded in its url/sourceUrl. */
function metaDoi(meta: PaperMeta): string | undefined {
  const direct = normalizeDoi(meta.doi ?? '')
  if (direct) return direct
  for (const source of [meta.url, meta.sourceUrl]) {
    if (!source) continue
    for (const match of source.matchAll(DOI_RE)) {
      const doi = normalizeDoi(match[0])
      if (doi) return doi
    }
  }
  return undefined
}

/** First arXiv identifier found in the paper's metadata (url/title/DOI/venue). */
function metaArxivId(meta: PaperMeta): string | undefined {
  const haystack = [meta.url, meta.sourceUrl, meta.doi, meta.title, meta.venue]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
  if (haystack.length === 0) return undefined
  for (const pattern of ARXIV_RES) {
    pattern.lastIndex = 0
    const match = pattern.exec(haystack)
    const id = match?.[1]
    if (id !== undefined) return id
  }
  return undefined
}

/** Lowercase, accent/punctuation-free token set used for title matching. */
function normalizeTokens(text: string): Set<string> {
  if (!text) return new Set()
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  return new Set(tokens.filter((token) => token.length > 0))
}

/**
 * Index every paper in the library by DOI, arXiv id and (for titles with at
 * least 4 tokens) normalized title token set. Corrupt/missing meta is skipped.
 */
export async function buildPaperIndex(root: string): Promise<PaperIndex> {
  const index: PaperIndex = { byDoi: new Map(), byArxiv: new Map(), byTitle: new Map() }
  for (const paperId of await listPaperIds(root)) {
    const meta = await readMeta(root, paperId).catch(() => null)
    if (meta === null) continue

    const doi = metaDoi(meta)
    if (doi !== undefined) {
      const list = index.byDoi.get(doi)
      if (list === undefined) index.byDoi.set(doi, [paperId])
      else if (!list.includes(paperId)) list.push(paperId)
    }

    const arxivId = metaArxivId(meta)
    if (arxivId !== undefined) {
      const list = index.byArxiv.get(arxivId)
      if (list === undefined) index.byArxiv.set(arxivId, [paperId])
      else if (!list.includes(paperId)) list.push(paperId)
    }

    const tokens = normalizeTokens(meta.title)
    if (tokens.size >= TITLE_MIN_TOKENS) {
      const key = [...tokens].join(' ')
      const list = index.byTitle.get(key)
      const entry = { id: paperId, tokens }
      if (list === undefined) index.byTitle.set(key, [entry])
      else list.push(entry)
    }
  }
  return index
}

/* -------------------------------------------------------------------------- */
/* reference extraction                                                        */
/* -------------------------------------------------------------------------- */

interface Extraction {
  hits: ReferenceHit[]
  /** Pages whose text contributed to the reference block. */
  pages: number[]
  /** True when no heading was found and only the last pages were scanned. */
  fallback: boolean
}

interface PageSlice {
  page: number
  text: string
}

/** DOI found in a chunk, normalized (trailing punctuation stripped). */
function findDoi(text: string): string | undefined {
  for (const match of text.matchAll(DOI_RE)) {
    const doi = normalizeDoi(match[0])
    if (doi !== undefined) return doi
  }
  return undefined
}

/** arXiv id found in a chunk (arXiv:/abs/arXiv. forms, version suffixes dropped). */
function findArxivId(text: string): string | undefined {
  for (const pattern of ARXIV_RES) {
    pattern.lastIndex = 0
    const match = pattern.exec(text)
    const id = match?.[1]
    if (id !== undefined && ARXIV_ID_RE.test(id)) return id
  }
  return undefined
}

/**
 * Split one page's reference block into plausible entries: blank lines and
 * `[n]` / `n.` / `n)` style numbering start a new entry. Chunks are bounded to
 * 20..2000 characters.
 */
function splitChunks(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const chunks: string[] = []
  let buffer: string[] = []

  const flush = (): void => {
    const chunk = buffer.join('\n').trim()
    buffer = []
    if (chunk.length === 0) return
    for (let start = 0; start < chunk.length; start += CHUNK_MAX) {
      const slice = chunk.slice(start, start + CHUNK_MAX).trim()
      if (slice.length >= CHUNK_MIN) chunks.push(slice)
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      flush()
      continue
    }
    // A reference number such as "[12]" or "12." starts a new entry; four-digit
    // years ("2024. Title…") are deliberately not treated as numbering.
    if (/^\[\d{1,4}\]/.test(trimmed) || /^\d{1,3}[.)]\s+\S/.test(trimmed)) flush()
    buffer.push(trimmed)
  }
  flush()
  return chunks
}

/** Hits for one page slice; duplicate DOIs/arXiv ids inside a page are merged. */
function hitsFromSlice(slice: PageSlice): ReferenceHit[] {
  const hits: ReferenceHit[] = []
  for (const chunk of splitChunks(slice.text)) {
    const doi = findDoi(chunk)
    const arxivId = findArxivId(chunk)
    if (doi === undefined && arxivId === undefined) continue
    const hit: ReferenceHit = { page: slice.page, raw: chunk }
    if (doi !== undefined) hit.doi = doi
    if (arxivId !== undefined) hit.arxivId = arxivId
    hits.push(hit)
  }
  return hits
}

/** Cap the referenced page slices at BLOCK_CAP characters in total. */
function capSlices(slices: PageSlice[]): PageSlice[] {
  const out: PageSlice[] = []
  let used = 0
  for (const slice of slices) {
    if (used >= BLOCK_CAP) break
    const remaining = BLOCK_CAP - used
    const text = slice.text.slice(0, remaining)
    if (text.length === 0) continue
    out.push({ page: slice.page, text })
    used += text.length
  }
  return out
}

function dedupeHits(hits: ReferenceHit[]): ReferenceHit[] {
  const seen = new Set<string>()
  const out: ReferenceHit[] = []
  for (const hit of hits) {
    const key = hit.doi ?? hit.arxivId ?? hit.raw.slice(0, 120)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out
}

/**
 * Locate and parse the reference block of one paper. Throws when the text
 * cannot be loaded (missing PDF / extraction failure).
 */
async function referencesForPaper(root: string, paperId: string): Promise<Extraction> {
  const text = await loadExtractedText(root, paperId)
  const pages = text.pages
    .filter((page: PageText) => page.text.trim().length > 0)
    .slice()
    .sort((a, b) => a.page - b.page)
  if (pages.length === 0) return { hits: [], pages: [], fallback: false }

  // Only the last 45% of the paper may contain the reference heading.
  const lastPage = Math.max(text.pageCount, pages[pages.length - 1]!.page)
  const firstCandidate = Math.max(1, Math.floor(lastPage * 0.55) + 1)
  const candidates = pages.filter((page) => page.page >= firstCandidate)

  for (let index = 0; index < candidates.length; index += 1) {
    const page = candidates[index]!
    const lines = page.text.replace(/\r\n?/g, '\n').split('\n')
    const headingLine = lines.findIndex((line) => REFERENCE_HEADING_RE.test(line))
    if (headingLine < 0) continue

    const slices: PageSlice[] = [{ page: page.page, text: lines.slice(headingLine + 1).join('\n') }]
    for (const following of pages) {
      if (following.page > page.page) slices.push({ page: following.page, text: following.text })
    }
    return buildExtraction(capSlices(slices), false)
  }

  // No heading: fall back to DOI/arXiv patterns in the trailing pages.
  const fallbackSlices = capSlices(pages.slice(-FALLBACK_PAGES))
  return buildExtraction(fallbackSlices, true)
}

function buildExtraction(slices: PageSlice[], fallback: boolean): Extraction {
  const hits: ReferenceHit[] = []
  const pagesWithHits = new Set<number>()
  for (const slice of slices) {
    for (const hit of hitsFromSlice(slice)) {
      hits.push(hit)
      pagesWithHits.add(hit.page)
    }
  }
  const deduped = dedupeHits(hits)
  return {
    hits: deduped,
    pages: fallback ? [...pagesWithHits].sort((a, b) => a - b) : slices.map((slice) => slice.page),
    fallback,
  }
}

/**
 * Reference hits of one paper. `pages` lists the pages the reference block was
 * read from (for the "jump to reference" action).
 */
export async function extractReferences(
  root: string,
  paperId: string,
): Promise<{ hits: ReferenceHit[]; pages: number[] }> {
  const extraction = await referencesForPaper(root, paperId)
  return { hits: extraction.hits, pages: extraction.pages }
}

/* -------------------------------------------------------------------------- */
/* candidate matching                                                          */
/* -------------------------------------------------------------------------- */

/** Confidence for a hit, slightly lower when it came from the no-heading fallback. */
function doiConfidence(fallback: boolean): number {
  return fallback ? 0.9 : 1.0
}

function arxivConfidence(fallback: boolean): number {
  return fallback ? 0.85 : 0.95
}

/** Token coverage of `tokens` inside `haystack`. */
function coverage(tokens: Set<string>, haystack: Set<string>): number {
  if (tokens.size === 0) return 0
  let matched = 0
  for (const token of tokens) if (haystack.has(token)) matched += 1
  return matched / tokens.size
}

function matchCandidates(
  paperId: string,
  extraction: Extraction,
  index: PaperIndex,
): CitationCandidate[] {
  const best = new Map<string, CitationCandidate>()
  const offer = (candidate: CitationCandidate): void => {
    const previous = best.get(candidate.toId)
    if (previous === undefined || candidate.confidence > previous.confidence) {
      best.set(candidate.toId, candidate)
    }
  }

  for (const hit of extraction.hits) {
    if (hit.doi !== undefined) {
      for (const toId of index.byDoi.get(hit.doi) ?? []) {
        if (toId === paperId) continue
        offer({
          toId,
          via: 'doi',
          reference: hit.raw,
          confidence: doiConfidence(extraction.fallback),
        })
      }
    }
    if (hit.arxivId !== undefined) {
      for (const toId of index.byArxiv.get(hit.arxivId) ?? []) {
        if (toId === paperId) continue
        offer({
          toId,
          via: 'arxiv',
          reference: hit.raw,
          confidence: arxivConfidence(extraction.fallback),
        })
      }
    }
    // Title containment is only trusted inside an explicit reference section.
    if (extraction.fallback) continue
    const referenceTokens = normalizeTokens(hit.raw)
    if (referenceTokens.size < TITLE_MIN_TOKENS) continue
    for (const entries of index.byTitle.values()) {
      for (const entry of entries) {
        if (entry.id === paperId) continue
        if (entry.tokens.size < TITLE_MIN_TOKENS) continue
        if (coverage(entry.tokens, referenceTokens) < TITLE_COVERAGE) continue
        offer({ toId: entry.id, via: 'title', reference: hit.raw, confidence: 0.8 })
      }
    }
  }

  return [...best.values()].sort(
    (a, b) => b.confidence - a.confidence || a.toId.localeCompare(b.toId),
  )
}

/**
 * Candidates for one paper against an index. Text/extraction problems degrade
 * to an empty list (callers that need the distinction use the sync path).
 */
export async function findCitationCandidates(
  root: string,
  paperId: string,
  index: PaperIndex,
): Promise<CitationCandidate[]> {
  let extraction: Extraction
  try {
    extraction = await referencesForPaper(root, paperId)
  } catch {
    return []
  }
  return matchCandidates(paperId, extraction, index)
}

/* -------------------------------------------------------------------------- */
/* sync                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Parse the selected papers (default: the whole library, capped at `maxPapers`,
 * 20) and add `cites` relations for every matched reference. A duplicate edge
 * (409) counts as skipped; other write errors are reported; a paper whose text
 * cannot be extracted goes to `skippedNoText`.
 */
export async function syncCitationEdges(
  root: string,
  ids?: string[],
  opts?: { maxPapers?: number },
): Promise<CitationSyncResult> {
  const result: CitationSyncResult = {
    scanned: 0,
    added: [],
    skipped: 0,
    skippedNoText: [],
    errors: [],
  }

  const cap = Math.max(1, Math.trunc(opts?.maxPapers ?? 20))
  const requested = ids !== undefined ? ids : await listPaperIds(root)
  const targets = [...new Set(requested)].slice(0, cap)
  if (targets.length === 0) return result

  const index = await buildPaperIndex(root)
  for (const paperId of targets) {
    let extraction: Extraction
    try {
      extraction = await referencesForPaper(root, paperId)
    } catch {
      result.skippedNoText.push(paperId)
      continue
    }
    result.scanned += 1

    for (const candidate of matchCandidates(paperId, extraction, index)) {
      try {
        const document = await addRelation(root, {
          from: paperId,
          to: candidate.toId,
          kind: 'cites',
          label: CITES_LABEL,
          note: candidate.reference.slice(0, NOTE_CAP),
          source: 'agent',
        })
        const relation = document.items.find(
          (item) =>
            item.from === paperId &&
            item.to === candidate.toId &&
            item.kind === 'cites' &&
            item.source === 'agent' &&
            item.label === CITES_LABEL,
        )
        if (relation !== undefined) result.added.push(relation)
      } catch (error) {
        if ((error as { status?: unknown })?.status === 409) {
          result.skipped += 1
          continue
        }
        result.errors.push(`${paperId} → ${candidate.toId}: ${errorMessage(error)}`)
      }
    }
  }
  return result
}

/** Re-exported for callers that need the label constant in tests/UI. */
export const CITATION_EDGE_LABEL = CITES_LABEL

/** Re-exported for callers that need the accepted arXiv id shape. */
export function isArxivId(value: unknown): value is string {
  return typeof value === 'string' && ARXIV_ID_RE.test(value)
}

/** Unused type guard kept internal? (referenced to keep PaperRelation import typed) */
export type AddedCitationEdge = PaperRelation
