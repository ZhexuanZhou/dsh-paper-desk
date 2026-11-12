/** arXiv's documented Atom query API. External content never supplies commands. */
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { PaperMeta } from './types.js'

import type { DiscoveredPaper } from './types.js'

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
      arxivId,
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

const cache = new Map<string, { at: number; xml: string }>()
let nextRequest = 0
export async function discoverPapers(
  query: string,
  papers: readonly PaperMeta[],
): Promise<DiscoveredPaper[]> {
  if (!query.trim() || query.length > 300)
    throw Object.assign(new Error('请输入 1–300 字符的检索词。'), { status: 400 })
  const key = query.trim()
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < 60_000) return parseArxivFeed(cached.xml, papers)
  // arXiv asks clients to space API calls by at least three seconds.
  const wait = Math.max(0, nextRequest - Date.now())
  if (wait > 12_000) throw Object.assign(new Error('请求过于频繁，请稍后重试。'), { status: 429 })
  nextRequest = Math.max(Date.now(), nextRequest) + 3100
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  const url = new URL('https://export.arxiv.org/api/query')
  // Plain words match all fields; advanced arXiv field syntax remains available.
  url.searchParams.set(
    'search_query',
    /\b(?:all|ti|au|abs|cat):/.test(key)
      ? key
      : key
          .split(/\s+/)
          .map((word) => `all:${word}`)
          .join(' AND '),
  )
  url.searchParams.set('max_results', '20')
  url.searchParams.set('sortBy', 'submittedDate')
  url.searchParams.set('sortOrder', 'descending')
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': 'PaperDesk/0.4 (research library)', accept: 'application/atom+xml' },
  })
  if (!response.ok) throw new Error(`arXiv 暂不可用 (${response.status})，请稍后重试。`)
  if (Number(response.headers.get('content-length') ?? 0) > 2_000_000) throw new Error('arXiv 响应过大。')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('arXiv 响应为空。')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2_000_000) throw new Error('arXiv 响应过大。')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const xml = Buffer.concat(chunks).toString('utf8')
  const result = parseArxivFeed(xml, papers)
  if (cache.size >= 50) cache.delete(cache.keys().next().value ?? '')
  cache.set(key, { at: Date.now(), xml })
  return result
}
