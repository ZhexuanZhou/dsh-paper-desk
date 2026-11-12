/** arXiv's documented Atom query API. External content never supplies commands. */
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { PaperMeta } from './types.js'

import type { DiscoveredPaper, DiscoveryProvider, DiscoveryResult } from './types.js'
import { createDiscoveryTransport } from './discoveryTransport.js'

export function arxivIdentity(value: string): string | null {
  let candidate = value.trim().replace(/^arxiv:/i, '')
  if (/^https?:\/\//i.test(candidate)) {
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      return null
    }
    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return null
    candidate = url.pathname.replace(/^\/(?:abs|pdf)\//, '')
  }
  const match = /^((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7}))(?:v\d+)?(?:\.pdf)?$/i.exec(candidate)
  return match?.[1]?.toLowerCase() ?? null
}

export function parseArxivFeed(xml: string, papers: readonly PaperMeta[]): DiscoveredPaper[] {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('arXiv 返回了无效的 Atom 数据。')
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) => name === 'entry' || name === 'author',
  }).parse(xml) as { feed?: { entry?: Array<Record<string, unknown>> } }
  if (!parsed.feed) throw new Error('arXiv 未返回 Atom 文献列表。')
  const result: DiscoveredPaper[] = []
  const seen = new Set<string>()
  for (const entry of parsed.feed.entry ?? []) {
    const rawId = typeof entry.id === 'string' ? entry.id : ''
    if (rawId.includes('/api/errors'))
      throw new Error(`arXiv 检索失败：${String(entry.summary ?? '请检查检索语法。')}`)
    const arxivId = arxivIdentity(rawId)
    if (!arxivId || seen.has(arxivId)) continue
    seen.add(arxivId)
    const clean = (value: unknown): string =>
      typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
    const title = clean(entry.title)
    if (!title) continue
    const existing = papers.find(
      (paper) =>
        arxivIdentity(paper.sourceUrl) === arxivId ||
        arxivIdentity(paper.url) === arxivId ||
        (paper.doi && clean(entry.doi).toLowerCase() === paper.doi.toLowerCase()),
    )
    const possible = papers.find((paper) => paper.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
    result.push({
      id: `arxiv:${arxivId}`,
      provider: 'arxiv',
      arxivId,
      doi: clean(entry.doi),
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      venue: 'arXiv',
      title,
      authors: Array.isArray(entry.author)
        ? entry.author.map((author: { name?: unknown }) => clean(author.name)).filter(Boolean)
        : [],
      abstract: clean(entry.summary),
      published: clean(entry.published),
      url: `https://arxiv.org/abs/${arxivId}`,
      existingPaperId: existing?.id ?? null,
      possibleDuplicateId: existing ? null : possible?.id ?? null,
    })
  }
  return result
}

type OpenAlexLocation = { landing_page_url?: unknown; pdf_url?: unknown; source?: { display_name?: unknown } | null }
type OpenAlexWork = {
  id?: unknown; display_name?: unknown; doi?: unknown; publication_date?: unknown
  authorships?: Array<{ author?: { display_name?: unknown } }>
  abstract_inverted_index?: Record<string, unknown> | null
  primary_location?: OpenAlexLocation | null; best_oa_location?: OpenAlexLocation | null
  locations?: OpenAlexLocation[]
}

function cleanText(value: unknown): string { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '' }
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    return url.toString()
  } catch { return null }
}
function bareDoi(value: unknown): string { return cleanText(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase() }

export function parseOpenAlexFeed(body: string, papers: readonly PaperMeta[]): DiscoveredPaper[] {
  const data = JSON.parse(body) as { results?: OpenAlexWork[] }
  if (!Array.isArray(data.results)) throw new Error('OpenAlex 未返回有效的论文列表。')
  const seen = new Set<string>()
  const items: DiscoveredPaper[] = []
  for (const work of data.results.slice(0, 20)) {
    const id = cleanText(work.id)
    const title = cleanText(work.display_name)
    if (!/^https:\/\/openalex\.org\/W\d+$/.test(id) || !title || seen.has(id)) continue
    seen.add(id)
    const locations = [work.best_oa_location, work.primary_location, ...(work.locations ?? [])].filter((item): item is OpenAlexLocation => !!item && typeof item === 'object')
    const doi = bareDoi(work.doi)
    const doiArxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1] ?? ''
    const arxivId = locations.map((location) => arxivIdentity(cleanText(location.landing_page_url)) ?? arxivIdentity(cleanText(location.pdf_url))).find(Boolean) ?? arxivIdentity(doiArxiv)
    const url = arxivId ? `https://arxiv.org/abs/${arxivId}` : safeUrl(work.primary_location?.landing_page_url) ?? safeUrl(work.best_oa_location?.landing_page_url) ?? id
    const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : locations.map((location) => safeUrl(location.pdf_url)).find((value) => value?.startsWith('https://')) ?? null
    const abstractWords = new Map<number, string>()
    for (const [word, positions] of Object.entries(work.abstract_inverted_index ?? {})) {
      if (!Array.isArray(positions)) continue
      for (const position of positions) if (Number.isInteger(position) && position >= 0 && position < 4000) abstractWords.set(position, word)
    }
    const existing = papers.find((paper) => (arxivId && [paper.sourceUrl, paper.url].some((value) => arxivIdentity(value) === arxivId)) || (doi && bareDoi(paper.doi) === doi))
    const normalizedTitle = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    const possible = papers.find((paper) => normalizedTitle(paper.title) === normalizedTitle(title))
    items.push({
      id, provider: 'openalex', arxivId, doi, url, pdfUrl, title,
      venue: cleanText(work.primary_location?.source?.display_name),
      authors: (work.authorships ?? []).map((item) => cleanText(item.author?.display_name)).filter(Boolean),
      abstract: [...abstractWords].sort(([a], [b]) => a - b).map(([, word]) => word).join(' '),
      published: cleanText(work.publication_date),
      existingPaperId: existing?.id ?? null,
      possibleDuplicateId: existing ? null : possible?.id ?? null,
    })
  }
  return items
}

const transport = createDiscoveryTransport({
  validate: (provider, body) => { if (provider === 'arxiv') parseArxivFeed(body, []); else parseOpenAlexFeed(body, []) },
})

export async function discoverResults(query: string, papers: readonly PaperMeta[], provider: DiscoveryProvider = 'arxiv'): Promise<DiscoveryResult> {
  const result = await transport.get(provider, query)
  return {
    items: provider === 'arxiv' ? parseArxivFeed(result.body, papers) : parseOpenAlexFeed(result.body, papers),
    provider, checkedAt: new Date(result.fetchedAt).toISOString(), cacheHit: result.cacheHit,
  }
}

/** Retain the original array-returning library helper for existing callers. */
export async function discoverPapers(query: string, papers: readonly PaperMeta[]): Promise<DiscoveredPaper[]> {
  return (await discoverResults(query, papers)).items
}
