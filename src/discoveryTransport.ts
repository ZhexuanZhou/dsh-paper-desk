import type { DiscoveryProvider } from './types.js'

export class DiscoveryServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'DISCOVERY_RATE_LIMITED' | 'DISCOVERY_UNAVAILABLE',
    readonly provider: DiscoveryProvider,
    readonly retryAt?: number,
  ) { super(message) }
}

export function discoveryUrl(provider: DiscoveryProvider, query: string): URL {
  if (provider === 'openalex') {
    if (/\b(?:all|ti|au|abs|cat):/.test(query)) throw Object.assign(new Error('OpenAlex 请使用普通关键词，不支持 arXiv 的字段语法。'), { status: 400 })
    const url = new URL('https://api.openalex.org/works')
    url.searchParams.set('search', query)
    url.searchParams.set('per-page', '20')
    url.searchParams.set('select', 'id,display_name,authorships,abstract_inverted_index,publication_date,doi,primary_location,best_oa_location,locations')
    return url
  }
  const url = new URL('https://export.arxiv.org/api/query')
  url.searchParams.set('search_query', /\b(?:all|ti|au|abs|cat):/.test(query) ? query : query.split(/\s+/).map((word) => `all:${word}`).join(' AND '))
  url.searchParams.set('max_results', '20')
  url.searchParams.set('sortBy', 'submittedDate')
  url.searchParams.set('sortOrder', 'descending')
  return url
}

export function retryAfterTime(value: string | null, now: number): number {
  if (value && /^\d+$/.test(value.trim())) {
    const result = now + Number(value) * 1000
    if (Number.isSafeInteger(result)) return result
  }
  const date = value ? Date.parse(value) : NaN
  return Number.isFinite(date) && date > now ? date : now + 60_000
}

/** Each provider has one connection, a completion-based gap and a shared cooldown. */
export function createDiscoveryTransport(options: {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  validate: (provider: DiscoveryProvider, body: string) => void
}) {
  const request = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  type Raw = { body: string; fetchedAt: number }
  const cache = new Map<string, Raw>()
  const pending = new Map<string, Promise<Raw>>()
  const states = {
    arxiv: { tail: Promise.resolve(), nextAt: 0, retryAt: 0 },
    openalex: { tail: Promise.resolve(), nextAt: 0, retryAt: 0 },
  }
  const limited = (provider: DiscoveryProvider, retryAt: number) => new DiscoveryServiceError(
    `${provider === 'arxiv' ? 'arXiv' : 'OpenAlex'} 暂时限制请求，请等待冷却结束后重试。`, 429, 'DISCOVERY_RATE_LIMITED', provider, retryAt,
  )
  return {
    async get(provider: DiscoveryProvider, rawQuery: string): Promise<Raw & { cacheHit: boolean }> {
      const query = rawQuery.trim()
      if (!query || query.length > 300) throw Object.assign(new Error('请输入 1–300 字符的检索词。'), { status: 400 })
      const url = discoveryUrl(provider, query)
      const key = `${provider}:${query}`
      const cached = cache.get(key)
      if (cached && now() - cached.fetchedAt < 15 * 60_000) return { ...cached, cacheHit: true }
      const state = states[provider]
      if (now() < state.retryAt) throw limited(provider, state.retryAt)
      const existing = pending.get(key)
      if (existing) return { ...await existing, cacheHit: false }
      if ([...pending.keys()].filter((item) => item.startsWith(`${provider}:`)).length >= 4) {
        throw new DiscoveryServiceError('检索请求正在排队，请稍后再试。', 503, 'DISCOVERY_UNAVAILABLE', provider)
      }
      const task = state.tail.then(async (): Promise<Raw> => {
        if (now() < state.retryAt) throw limited(provider, state.retryAt)
        const wait = Math.max(0, state.nextAt - now())
        if (wait) await sleep(wait)
        try {
          const response = await request(url, {
            signal: AbortSignal.timeout(20_000),
            headers: { 'User-Agent': 'PaperDesk/0.4.3 (https://github.com/ZhexuanZhou/dsh-paper-desk)', accept: provider === 'arxiv' ? 'application/atom+xml' : 'application/json' },
          })
          if (response.status === 429 || response.status === 503) {
            state.retryAt = retryAfterTime(response.headers.get('retry-after'), now())
            await response.body?.cancel().catch(() => {})
            throw limited(provider, state.retryAt)
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => {})
            throw new DiscoveryServiceError(`${provider === 'arxiv' ? 'arXiv' : 'OpenAlex'} 暂不可用 (${response.status})。`, 502, 'DISCOVERY_UNAVAILABLE', provider)
          }
          const reader = response.body?.getReader()
          if (!reader) throw new Error('检索服务返回了空响应。')
          const chunks: Uint8Array[] = []
          let size = 0
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              size += value.length
              if (size > 4_000_000) throw new Error('检索响应过大，请缩小检索范围。')
              chunks.push(value)
            }
          } finally { await reader.cancel().catch(() => {}) }
          const body = Buffer.concat(chunks).toString('utf8')
          options.validate(provider, body)
          const result = { body, fetchedAt: now() }
          if (cache.size >= 50) cache.delete(cache.keys().next().value ?? '')
          cache.set(key, result)
          return result
        } catch (error) {
          if (error instanceof DiscoveryServiceError) throw error
          throw Object.assign(new DiscoveryServiceError(`${provider === 'arxiv' ? 'arXiv' : 'OpenAlex'} 请求失败，请稍后重试或切换检索来源。`, 502, 'DISCOVERY_UNAVAILABLE', provider), { cause: error })
        } finally {
          state.nextAt = now() + (provider === 'arxiv' ? 3100 : 1000)
        }
      })
      state.tail = task.then(() => {}, () => {})
      pending.set(key, task)
      try { return { ...await task, cacheHit: false } }
      finally { if (pending.get(key) === task) pending.delete(key) }
    },
  }
}
