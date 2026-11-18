import { useMemo, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { api } from './api.js'
import { DirectDiscoveryView } from './DirectDiscoveryView.js'
import { discoverySearchStore } from './discoverySearch.js'
import { sourceImportUrl } from './discoveryAgent.js'
import { useLang, useT, errorText } from './i18n.js'
import { IconSearch, IconSpark } from './icons.js'
import { Button, Spinner } from './ui.js'
import { Markdown } from './markdown.js'

export function DiscoverView({ ctx, workspacePath, onImported, onOpenPaper }: {
  ctx: ClientContext; workspacePath: string
  onImported: () => void; onOpenPaper: (id: string) => void
}) {
  const t = useT()
  const lang = useLang()
  const [direct, setDirect] = useState(false)
  const store = useMemo(() => discoverySearchStore(ctx, workspacePath), [ctx, workspacePath])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const current = state.searches.find((entry) => entry.id === state.selected)
  const running = state.searches.some((entry) => entry.phase === 'running')
  const [importing, setImporting] = useState<string | null>(null)
  const [imported, setImported] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [importError, setImportError] = useState('')
  const start = (query: string) => { setNotice(''); setImportError(''); void store.start(query, lang) }
  const importSource = async (url: string) => {
    if (importing) return
    const target = sourceImportUrl(url)
    if (!target) return
    setImporting(url); setImportError(''); setNotice('')
    try {
      const result = await api.importUrl(target)
      setImported((previous) => ({ ...previous, [url]: result.id }))
      setNotice([t(result.duplicated ? 'discover.duplicate' : 'discover.imported'), result.enrichmentWarning].filter(Boolean).join(' · '))
      onImported()
    } catch (error) { setImportError(errorText(error)) }
    finally { setImporting(null) }
  }
  return <section className="pd-discovery-workspace">
    <div className="pd-discovery-modebar">
      <span><IconSpark size={15} />{t(direct ? 'discoverAgent.directMode' : 'discoverAgent.mode')}</span>
      <Button variant="ghost" size="sm" onClick={() => setDirect(!direct)}>
        {t(direct ? 'discoverAgent.back' : 'discoverAgent.advanced')}
      </Button>
    </div>
    {direct ? <DirectDiscoveryView onImported={onImported} onOpenPaper={onOpenPaper} /> : <div className="pd-agent-discovery-layout">
      <aside className="pd-discovery-history" aria-label={t('discoverAgent.history')}>
        <div className="pd-discovery-history-head"><h3>{t('discoverAgent.history')}</h3>
          {state.searches.length ? <Button size="sm" variant="ghost" disabled={running} onClick={() => store.clear()}>{t('discoverAgent.clear')}</Button> : null}</div>
        <p className="pd-field-hint">{t('discoverAgent.historyHint')}</p>
        {!state.searches.length ? <p className="pd-sidebar-empty">{t('discoverAgent.noHistory')}</p> : null}
        {state.searches.map((entry) => <div className="pd-discovery-history-row" key={entry.id}><button className="pd-topic-row" data-selected={entry.id === state.selected}
          aria-current={entry.id === state.selected ? 'true' : undefined} onClick={() => store.select(entry.id)}>
          <span>{entry.query}</span><small>{new Date(entry.createdAt).toLocaleDateString()} · {t(`discoverAgent.${entry.phase}`)}</small>
        </button><Button size="sm" variant="ghost" disabled={entry.phase === 'running'} aria-label={t('discoverAgent.deleteSearch', { query: entry.query })} onClick={() => store.remove(entry.id)}>{t('discoverAgent.delete')}</Button></div>)}
      </aside>
      <main className="pd-discovery-content">
        <header className="pd-discovery-heading"><h2>{t('discover.title')}</h2><p>{t('discoverAgent.intro')}</p></header>
        <form className="pd-discovery-composer" onSubmit={(event) => { event.preventDefault(); start(state.draft) }}>
          <label htmlFor="pd-agent-discovery-query">{t('discoverAgent.question')}</label>
          <textarea id="pd-agent-discovery-query" value={state.draft} maxLength={4000} rows={3}
            placeholder={t('discoverAgent.placeholder')} aria-describedby="pd-discovery-input-hint"
            onChange={(event) => store.draft(event.target.value)} onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault(); if (!running) start(state.draft)
              }
            }} />
          <div className="pd-discovery-composer-foot"><span id="pd-discovery-input-hint"><IconSearch size={14} />{t('discoverAgent.inputHint')}</span>
            <div className="pd-discovery-actions">
              {running ? <Button key="stop" onClick={() => void store.stop()}>{t('discoverAgent.stop')}</Button> : null}
              <Button key="search" type="submit" variant="primary" disabled={running || !state.draft.trim() || !workspacePath}><IconSpark size={14} />{t('discoverAgent.search')}</Button>
            </div>
          </div>
        </form>
        <p className="pd-discovery-privacy">{t('discoverAgent.privacy')}</p>
        {state.storageError ? <p role="alert" className="pd-field-error">{t('discoverAgent.storageError')}</p> : null}
        {!current ? <section className="pd-discovery-start"><h3>{t('discoverAgent.startTitle')}</h3><div className="pd-discovery-examples">
          {['example1', 'example2', 'example3'].map((key) => <button key={key} onClick={() => store.draft(t(`discoverAgent.${key}`))}>{t(`discoverAgent.${key}`)}<span aria-hidden="true">↗</span></button>)}
        </div><p className="pd-field-hint">{t('discoverAgent.startHint')}</p></section> : <section className="pd-discovery-result" aria-label={t('discoverAgent.result')} aria-busy={current.phase === 'running'}>
          <header><div><span className="pd-discovery-eyebrow">{t('discoverAgent.result')}</span><h3>{current.query}</h3></div>
            <span role="status">{current.phase === 'running' ? <Spinner size={13} /> : null}{t(`discoverAgent.${current.phase}`)}</span></header>
          {current.phase === 'running' ? <p className="pd-field-hint" role="status">{t(current.searched ? 'discoverAgent.organizing' : 'discoverAgent.searching')}</p> : null}
          {current.error ? <p role="alert" className="pd-field-error">{current.error}</p> : null}
          {current.phase !== 'running' && !current.sources.length ? <div className="pd-discovery-warning" role="status"><strong>{t(current.searched ? 'discoverAgent.noSources' : 'discoverAgent.noSearch')}</strong><p>{t('discoverAgent.checkSettings')}</p></div> : null}
          {current.steps.length ? <details className="pd-discovery-process"><summary>{t('discoverAgent.process', { n: current.steps.length })}</summary><ol>{current.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></details> : null}
          {current.markdown ? <article className="pd-discovery-answer"><h4>{t(current.sources.length ? 'discoverAgent.analysis' : 'discoverAgent.unverified')}</h4><Markdown markdown={current.markdown} /></article> : null}
          {current.sources.length ? <section className="pd-discovery-sources"><h4>{t('discoverAgent.sources', { n: current.sources.length })}</h4><p className="pd-field-hint">{t('discoverAgent.sourcesHint')}</p>
            {current.sources.map((source, index) => <article className="pd-discovery-source" key={source.url}>
              <span className="pd-discovery-source-number">{String(index + 1).padStart(2, '0')}</span>
              <div><a href={source.url} target="_blank" rel="noopener noreferrer"><h5>{source.title || new URL(source.url).hostname}</h5></a>
                <span className="pd-field-hint">{new URL(source.url).hostname}{source.publishedAt ? ` · ${source.publishedAt}` : ''}</span>
                {source.snippet ? <p>{source.snippet}</p> : null}
                <div className="pd-discovery-source-actions"><a href={source.url} target="_blank" rel="noopener noreferrer">{t('discoverAgent.openSource')} ↗</a>
                  {imported[source.url] ? <Button size="sm" onClick={() => onOpenPaper(imported[source.url]!)}>{t('discover.inLibrary')}</Button> : sourceImportUrl(source.url) ?
                    <Button size="sm" disabled={importing !== null} loading={importing === source.url} onClick={() => void importSource(source.url)}>{t('discover.import')}</Button> : <span className="pd-field-hint">{t('discoverAgent.landingPage')}</span>}
                </div>
              </div>
            </article>)}
          </section> : null}
          {current.phase !== 'running' ? <Button disabled={running} onClick={() => start(current.query)}>{t('discoverAgent.again')}</Button> : null}
        </section>}
        {notice ? <p role="status">{notice}</p> : null}{importError ? <p role="alert" className="pd-field-error">{importError}</p> : null}
      </main>
    </div>}
  </section>
}
