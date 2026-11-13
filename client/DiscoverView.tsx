import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResearchSnapshot } from '../src/types.js'
import type { DiscoveredPaper, DiscoveryProvider } from '../src/types.js'
import { api, ApiError } from './api.js'
import { useT, errorText } from './i18n.js'
import { Button, Spinner } from './ui.js'
import { FeatureLoadState } from './FeatureLoadState.js'

export function DiscoverView({
  onImported,
  onOpenPaper,
}: {
  onImported: () => void
  onOpenPaper: (id: string) => void
}) {
  const t = useT()
  const [snapshot, setSnapshot] = useState<ResearchSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<DiscoveryProvider>('arxiv')
  const [cacheHit, setCacheHit] = useState(false)
  const [limits, setLimits] = useState({ arxiv: 0, openalex: 0 })
  const [now, setNow] = useState(Date.now)
  const [items, setItems] = useState<DiscoveredPaper[] | null>(null)
  const [matched, setMatched] = useState('')
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [retrySearch, setRetrySearch] = useState<{ query: string; id: string | null; provider: DiscoveryProvider } | null>(null)
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (
      subscriptionId &&
      snapshot &&
      !snapshot.document.subscriptions.some((item) => item.id === subscriptionId)
    )
      setSubscriptionId(null)
  }, [snapshot, subscriptionId])
  const reload = useCallback(async () => {
    setLoadError(null)
    try { setSnapshot(await api.research()) }
    catch (err) { setLoadError(err) }
  }, [])
  useEffect(() => {
    void reload()
    return () => {
      request.current += 1
    }
  }, [reload])
  const search = async (value: string, id: string | null = null, source: DiscoveryProvider = provider): Promise<void> => {
    if (!value.trim()) return
    if (limits[source] > Date.now()) {
      setProvider(source); setQuery(value); setSubscriptionId(id); setItems(null)
      setError(t('discover.cooling'))
      setRetrySearch({ query: value, id, provider: source })
      return
    }
    const token = ++request.current
    setBusy(true)
    setError('')
    setRetrySearch(null)
    setNotice('')
    setQuery(value)
    setProvider(source)
    setSubscriptionId(id)
    setItems(null)
    try {
      const result = await api.discover(value, source)
      if (token !== request.current) return
      setItems(result.items)
      setMatched(value)
      setCheckedAt(result.checkedAt)
      setCacheHit(result.cacheHit)
    } catch (err) {
      if (token === request.current) {
        setError(errorText(err))
        setRetrySearch({ query: value, id, provider: source })
        if (err instanceof ApiError && err.payload && typeof err.payload === 'object') {
          const payload = err.payload as { code?: unknown; retryAt?: unknown; provider?: unknown }
          if (payload.code === 'DISCOVERY_RATE_LIMITED' && payload.provider === source && typeof payload.retryAt === 'number' && Number.isFinite(payload.retryAt)) {
            setLimits((previous) => ({ ...previous, [source]: payload.retryAt as number }))
            setNow(Date.now())
          }
        }
      }
    } finally {
      if (token === request.current) setBusy(false)
    }
  }
  const mutate = async (operation: () => Promise<ResearchSnapshot>): Promise<void> => {
    setBusy(true)
    setError('')
    setRetrySearch(null)
    try {
      setSnapshot(await operation())
      setNotice(t('discover.saved'))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const lastChecked = snapshot?.document.subscriptions.find((item) => item.id === subscriptionId)?.lastChecked
  if (!snapshot || loadError !== null) return <FeatureLoadState error={loadError} onRetry={() => void reload()} />
  const alreadySubscribed = snapshot.document.subscriptions.some((item) => item.query === query.trim() && (item.provider ?? 'arxiv') === provider)
  const secondsLeft = Math.max(0, Math.ceil((limits[provider] - now) / 1000))
  const providerName = provider === 'arxiv' ? 'arXiv' : 'OpenAlex'
  return (
    <section className="pd-discover-layout">
      <aside className="pd-research-list">
        <h2>{t('discover.subscriptions')}</h2>
        <p className="pd-field-hint">{t('discover.subscriptionHint')}</p>
        {snapshot.document.subscriptions.length === 0 ? <p className="pd-sidebar-empty">{t('discover.noSubscriptions')}</p> : null}
        {snapshot?.document.subscriptions.map((item) => (
          <div className="pd-subscription" key={item.id}>
            <button className="pd-topic-row" data-selected={subscriptionId === item.id} disabled={busy} onClick={() => void search(item.query, item.id, item.provider ?? 'arxiv')}>
              {item.query}
              <small>{item.provider === 'openalex' ? 'OpenAlex' : 'arXiv'}</small>
              <small>
                {item.lastChecked ? new Date(item.lastChecked).toLocaleString() : t('discover.unchecked')}
              </small>
            </button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void mutate(() => api.unsubscribe(item.id, snapshot.hash))}
            >
              {t('discover.unsubscribe')}
            </Button>
          </div>
        ))}
      </aside>
      <section className="pd-discover-main" aria-label={t('discover.title')}>
        <header className="pd-section-head">
          <div><h2>{t('discover.title')}</h2><p className="pd-field-hint">{t('discover.intro')}</p></div>
          <label className="pd-discovery-provider">{t('discover.provider')}<select className="pd-select" aria-label={t('discover.provider')} value={provider} disabled={busy} onChange={(event) => {
            setProvider(event.target.value as DiscoveryProvider); setItems(null); setError(''); setRetrySearch(null); setSubscriptionId(null)
          }}><option value="arxiv">arXiv</option><option value="openalex">OpenAlex</option></select></label>
        </header>
        <label className="pd-search-label" htmlFor="pd-discover-query">{t('discover.queryLabel')}</label>
        <form
          className="pd-discover-search"
          onSubmit={(event) => {
            event.preventDefault()
            void search(query)
          }}
        >
          <input
            id="pd-discover-query"
            className="pd-input"
            aria-label={t('discover.query')}
            placeholder={t('discover.query')}
            value={query}
            maxLength={300}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!query.trim() || secondsLeft > 0}>
            {secondsLeft > 0 ? t('discover.wait', { n: secondsLeft }) : t('discover.search')}
          </Button>
        </form>
        {query.trim() ? (
          <div className="pd-discover-save-search">
            <p>{t('discover.saveHint', { query: query.trim(), provider: providerName })}</p>
            <Button
              disabled={busy || alreadySubscribed}
              onClick={() => void mutate(() => api.subscribe(query.trim(), snapshot.hash, provider))}
            >
              {t(alreadySubscribed ? 'discover.subscribed' : 'discover.subscribe')}
            </Button>
          </div>
        ) : null}
        <p className="pd-field-hint">{t(provider === 'arxiv' ? 'discover.arxivOrder' : 'discover.openalexOrder')}</p>
        {provider === 'arxiv' ? <details className="pd-discover-syntax"><summary>{t('discover.advanced')}</summary><p className="pd-field-hint">{t('discover.hint')}</p></details> : null}
        {error ? (
          <p role="alert" className="pd-field-error">
            {error}
            {retrySearch ? <Button disabled={busy || secondsLeft > 0} onClick={() => void search(retrySearch.query, retrySearch.id, retrySearch.provider)}>
              {t('discover.retry')}
            </Button> : null}
            {provider === 'arxiv' ? <Button disabled={busy} onClick={() => void search(query, null, 'openalex')}>{t('discover.useOpenalex')}</Button> : null}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {busy && items === null ? <p role="status" className="pd-feature-status"><Spinner />{t('discover.searching', { provider: providerName })}</p> : null}
        {!busy && items === null && !error ? <section className="pd-feature-empty"><h3>{t('discover.startTitle')}</h3><p>{t('discover.startHint')}</p><div className="pd-example-queries">{['retrieval augmented generation', 'diffusion language model'].map((example) => <Button key={example} onClick={() => setQuery(example)}>{example}</Button>)}</div></section> : null}
        {items ? <p className="pd-field-hint">{t('discover.matches', { n: items.length, query: matched, provider: providerName })}{cacheHit ? ` · ${t('discover.cached')}` : ''} · {t('discover.fetchedAt', { time: new Date(checkedAt).toLocaleString() })}</p> : null}
        {items?.length === 0 ? <p>{t('discover.empty')}</p> : null}
        {items?.map((item) => (
          <article key={item.id} className="pd-discovered-paper">
            <div>
              <h3>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              </h3>
              <p className="pd-field-hint">
                {item.authors.join(', ')} · {item.published.slice(0, 10)} · {item.provider === 'arxiv' ? 'arXiv' : 'OpenAlex'}{item.arxivId ? ` · arXiv:${item.arxivId}` : item.doi ? ` · DOI:${item.doi}` : ''}{' '}
                {lastChecked && item.published > lastChecked ? t('discover.new') : ''}
              </p>
              <p>{item.abstract}</p>
              {item.possibleDuplicateId ? <p className="pd-field-hint">{t('discover.possibleDuplicate')} <Button size="sm" variant="ghost" onClick={() => onOpenPaper(item.possibleDuplicateId!)}>{t('research.read')}</Button></p> : null}
            </div>
            <Button
              disabled={busy || (!item.existingPaperId && !item.pdfUrl)}
              onClick={() => {
                if (item.existingPaperId) {
                  onOpenPaper(item.existingPaperId)
                  return
                }
                setBusy(true)
                setError('')
                setRetrySearch(null)
                void api
                  .importUrl(item.pdfUrl!)
                  .then((result) => {
                    setItems(
                      (previous) =>
                        previous?.map((paper) =>
                          paper.id === item.id ? { ...paper, existingPaperId: result.id } : paper,
                        ) ?? null,
                    )
                    setNotice([result.duplicated ? t('discover.duplicate') : t('discover.imported'), result.enrichmentWarning].filter(Boolean).join(' · '))
                    onImported()
                  })
                  .catch((err: unknown) => setError(errorText(err)))
                  .finally(() => setBusy(false))
              }}
            >
              {item.existingPaperId ? t('discover.inLibrary') : !item.pdfUrl ? t('discover.noPdf') : t('discover.import')}
            </Button>
          </article>
        ))}
        {items && subscriptionId && snapshot ? (
          <Button
            disabled={busy}
            onClick={() => void mutate(() => api.checkSubscription(subscriptionId, checkedAt, snapshot.hash))}
          >
            {t('discover.markRead')}
          </Button>
        ) : null}
      </section>
    </section>
  )
}
