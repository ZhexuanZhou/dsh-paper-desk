import { useEffect, useRef, useState } from 'react'
import type { ResearchSnapshot } from '../src/types.js'
import type { DiscoveredPaper } from '../src/types.js'
import { api } from './api.js'
import { useT, errorText } from './i18n.js'
import { Button } from './ui.js'

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
  const [items, setItems] = useState<DiscoveredPaper[] | null>(null)
  const [matched, setMatched] = useState('')
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  useEffect(() => {
    if (
      subscriptionId &&
      snapshot &&
      !snapshot.document.subscriptions.some((item) => item.id === subscriptionId)
    )
      setSubscriptionId(null)
  }, [snapshot, subscriptionId])
  useEffect(() => {
    void api
      .research()
      .then(setSnapshot)
      .catch((err: unknown) => setError(errorText(err)))
    return () => {
      request.current += 1
    }
  }, [])
  const search = async (value: string, id: string | null = null): Promise<void> => {
    const token = ++request.current
    setBusy(true)
    setError('')
    setNotice('')
    setQuery(value)
    setSubscriptionId(id)
    setItems(null)
    try {
      const result = await api.discover(value)
      if (token !== request.current) return
      setItems(result.items)
      setMatched(value)
      setCheckedAt(result.checkedAt)
    } catch (err) {
      if (token === request.current) setError(errorText(err))
    } finally {
      if (token === request.current) setBusy(false)
    }
  }
  const mutate = async (operation: () => Promise<ResearchSnapshot>): Promise<void> => {
    setBusy(true)
    setError('')
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
  return (
    <section className="pd-discover-layout">
      <aside className="pd-research-list">
        <h2>{t('discover.subscriptions')}</h2>
        <p className="pd-field-hint">{t('discover.subscriptionHint')}</p>
        {snapshot?.document.subscriptions.map((item) => (
          <div className="pd-subscription" key={item.id}>
            <button className="pd-topic-row" disabled={busy} onClick={() => void search(item.query, item.id)}>
              {item.query}
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
        <h2>{t('discover.title')}</h2>
        <p>{t('discover.hint')}</p>
        <form
          className="pd-discover-search"
          onSubmit={(event) => {
            event.preventDefault()
            void search(query)
          }}
        >
          <input
            className="pd-input"
            aria-label={t('discover.query')}
            placeholder={t('discover.query')}
            value={query}
            maxLength={300}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!query.trim()}>
            {t('discover.search')}
          </Button>
          <Button
            disabled={busy || !query.trim() || !snapshot}
            onClick={() => snapshot && void mutate(() => api.subscribe(query, snapshot.hash))}
          >
            {t('discover.subscribe')}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="pd-field-error">
            {error}
            <Button disabled={busy} onClick={() => void search(query, subscriptionId)}>
              {t('discover.retry')}
            </Button>
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {items ? (
          <p className="pd-field-hint">{t('discover.matches', { n: items.length, query: matched })}</p>
        ) : null}
        {items?.length === 0 ? <p>{t('discover.empty')}</p> : null}
        {items?.map((item) => (
          <article key={item.arxivId} className="pd-discovered-paper">
            <div>
              <h3>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              </h3>
              <p className="pd-field-hint">
                {item.authors.join(', ')} · {item.published.slice(0, 10)} · arXiv:{item.arxivId}{' '}
                {lastChecked && item.published > lastChecked ? t('discover.new') : ''}
              </p>
              <p>{item.abstract}</p>
              {item.possibleDuplicateId ? <p className="pd-field-hint">{t('discover.possibleDuplicate')} <Button size="sm" variant="ghost" onClick={() => onOpenPaper(item.possibleDuplicateId!)}>{t('research.read')}</Button></p> : null}
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                if (item.existingPaperId) {
                  onOpenPaper(item.existingPaperId)
                  return
                }
                setBusy(true)
                setError('')
                void api
                  .importUrl(item.url)
                  .then((result) => {
                    setItems(
                      (previous) =>
                        previous?.map((paper) =>
                          paper.arxivId === item.arxivId ? { ...paper, existingPaperId: result.id } : paper,
                        ) ?? null,
                    )
                    setNotice(result.duplicated ? t('discover.duplicate') : t('discover.imported'))
                    onImported()
                  })
                  .catch((err: unknown) => setError(errorText(err)))
                  .finally(() => setBusy(false))
              }}
            >
              {item.existingPaperId ? t('discover.inLibrary') : t('discover.import')}
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
