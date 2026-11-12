/**
 * Library queries used by the HTTP routes and the agent tools: filtering the
 * paper list and full-text search across metadata, notes and cached PDF text.
 * Reads only; never writes to the library.
 */
import type { PaperStatus, PaperSummary, SearchHit } from './types.js'
import { listPapers, readMeta } from './library.js'
import { readNotes } from './notes.js'
import { readTextCache } from './pdf.js'

export interface PaperQuery {
  q?: string
  tag?: string
  status?: PaperStatus | 'all'
  sort?: 'added' | 'title' | 'year' | 'updated'
  limit?: number
}

const DEFAULT_LIMIT = 200
const MAX_SEARCH_HITS = 60

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

/** Filter + sort + cap the library list. */
export async function queryPapers(root: string, options: PaperQuery = {}): Promise<PaperSummary[]> {
  const all = await listPapers(root)
  const query = (options.q ?? '').trim().toLowerCase()
  const tag = (options.tag ?? '').trim().toLowerCase()
  let rows = all
  if (query.length > 0) {
    // Use the same search contract as the agent, then apply list filters/sort.
    const matches = new Map((await searchLibrary(root, query, 1000)).map((hit) => [hit.paper.id, hit.snippet]))
    rows = rows.filter((paper) => matches.has(paper.id)).map((paper) => ({ ...paper, searchMatch: matches.get(paper.id) }))
  }
  if (tag.length > 0) rows = rows.filter((paper) => paper.tags.some((value) => value.toLowerCase() === tag))
  if (options.status !== undefined && options.status !== 'all') {
    rows = rows.filter((paper) => paper.status === options.status)
  }

  const sort = options.sort ?? 'added'
  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case 'title':
        return compareText(a.title, b.title)
      case 'year':
        return (b.year ?? 0) - (a.year ?? 0) || compareText(a.title, b.title)
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt)
      default:
        return b.addedAt.localeCompare(a.addedAt)
    }
  })
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 1000)
  return sorted.slice(0, limit)
}

/** Distinct tags across the library, most frequent first. */
export async function listTags(root: string): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>()
  for (const paper of await listPapers(root)) {
    for (const tag of paper.tags) {
      const key = tag.trim()
      if (key.length === 0) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || compareText(a.tag, b.tag))
}

/** Slice a text around the first occurrence of `query`. */
function snippetAround(text: string, query: string, width: number): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text.slice(0, width).replace(/\s+/g, ' ').trim()
  const start = Math.max(0, index - Math.floor(width / 3))
  const slice = text.slice(start, start + width).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${start + width < text.length ? '…' : ''}`
}

/**
 * Content search over one paper: title, authors, tags, abstract, notes and
 * cached PDF text. Text is only read from `text.json` (never extracted here).
 */
export async function searchLibrary(root: string, rawQuery: string, limit = MAX_SEARCH_HITS): Promise<SearchHit[]> {
  const query = rawQuery.trim()
  if (query.length === 0) return []
  const lower = query.toLowerCase()
  const hits: SearchHit[] = []

  for (const paper of await listPapers(root)) {
    let best: SearchHit | undefined
    const offer = (field: SearchHit['field'], score: number, snippet: string): void => {
      if (best === undefined || score > best.score) best = { paper, field, snippet, score }
    }

    if (paper.title.toLowerCase().includes(lower)) offer('title', 6, snippetAround(paper.title, query, 140))
    if (paper.venue.toLowerCase().includes(lower)) offer('venue', 3, snippetAround(paper.venue, query, 140))
    if (paper.authors.some((author) => author.toLowerCase().includes(lower))) {
      offer('author', 5, snippetAround(paper.authors.join(', '), query, 140))
    }
    if (paper.tags.some((tag) => tag.toLowerCase().includes(lower))) {
      offer('tag', 4, paper.tags.join(', '))
    }

    // Abstract lives in meta.json; read it only when a cheaper field missed.
    if (best === undefined || best.score < 4) {
      const meta = await readMeta(root, paper.id)
      const abstract = meta?.abstract ?? ''
      if (abstract.toLowerCase().includes(lower)) offer('abstract', 3, snippetAround(abstract, query, 140))
    }

    if (best === undefined || best.score < 3) {
      const notes = await readNotes(root, paper.id)
      if (notes.markdown.toLowerCase().includes(lower)) {
        offer('notes', 2, snippetAround(notes.markdown, query, 160))
      }
    }

    if (best === undefined || best.score < 2) {
      const text = await readTextCache(root, paper.id)
      if (text !== null) {
        for (const page of text.pages) {
          if (page.text.toLowerCase().includes(lower)) {
            offer('text', 1, `p.${page.page} · ${snippetAround(page.text, query, 160)}`)
            break
          }
        }
      }
    }

    if (best !== undefined) hits.push(best)
  }

  hits.sort((a, b) => b.score - a.score || b.paper.updatedAt.localeCompare(a.paper.updatedAt))
  return hits.slice(0, Math.min(Math.max(limit, 1), 1000))
}
