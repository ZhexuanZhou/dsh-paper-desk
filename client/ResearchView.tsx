import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ResearchSnapshot, ResearchTopic } from '../src/types.js'
import type { PaperSummary } from '../src/types.js'
import { api } from './api.js'
import { createAiThread } from './aiSession.js'
import { Markdown } from './markdown.js'
import { useT, errorText } from './i18n.js'
import { Button, Modal } from './ui.js'
import { FeatureLoadState } from './FeatureLoadState.js'

export function ResearchView({
  ctx,
  workspacePath,
  onOpenPaper,
  onDirtyChange,
  registerSave,
}: {
  ctx: ClientContext
  workspacePath: string
  onOpenPaper: (id: string) => void
  onDirtyChange: (value: boolean) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
}) {
  const t = useT()
  const [snapshot, setSnapshot] = useState<ResearchSnapshot | null>(null)
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const [topic, setTopic] = useState<ResearchTopic | null>(null)
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [notes, setNotes] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [ask, setAsk] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const ai = useMemo(() => createAiThread(ctx), [ctx])
  const subscribe = useCallback((listener: () => void) => ai.subscribe(listener), [ai])
  const state = useSyncExternalStore(subscribe, ai.getSnapshot)
  useEffect(() => () => ai.dispose(), [ai])
  useEffect(() => {
    if (!topic) return
    void ai.openThread(topic.id, { workspacePath, title: `PaperDesk · ${topic.title}` }).catch((err: unknown) => setError(errorText(err)))
  }, [ai, topic?.id, topic?.title, workspacePath])
  const dirty =
    title !== (topic?.title ?? '') ||
    question !== (topic?.question ?? '') ||
    notes !== (topic?.notes ?? '') ||
    ids.join() !== (topic?.paperIds ?? []).join()

  const select = (value: ResearchTopic | null): void => {
    setTopic(value)
    setTitle(value?.title ?? '')
    setQuestion(value?.question ?? '')
    setNotes(value?.notes ?? '')
    setIds(value?.paperIds ?? [])
    setAsk('')
    setError('')
    setNotice('')
  }
  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const [next, list] = await Promise.all([api.research(), api.papers({ limit: 1000 })])
      setSnapshot(next)
      setPapers(list.papers)
      setError('')
      return next
    } catch (err) {
      setLoadError(err)
      return null
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])
  const save = useCallback(async (): Promise<boolean> => {
    if (!snapshot) return false
    setBusy(true)
    setError('')
    try {
      const next = await api.saveTopic(
        { ...(topic ? { id: topic.id } : {}), title, question, notes, paperIds: ids },
        snapshot.hash,
      )
      const saved = topic
        ? next.document.topics.find((item) => item.id === topic.id)
        : next.document.topics.at(-1)
      setSnapshot(next)
      setTopic(saved ?? null)
      if (saved) {
        setTitle(saved.title)
        setQuestion(saved.question)
        setNotes(saved.notes)
        setIds(saved.paperIds)
      }
      setNotice(t('research.saved'))
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [snapshot, topic, title, question, notes, ids, t])
  useEffect(() => {
    registerSave(save)
    return () => registerSave(null)
  }, [save, registerSave])

  const discuss = async (): Promise<void> => {
    if (!topic || dirty || ids.length === 0 || !ask.trim()) return
    setBusy(true)
    setError('')
    try {
      const payload = await api.topicPrompt(topic.id, ask)
      await ai.openThread(topic.id, { workspacePath, title: `PaperDesk · ${title}` })
      const result = await ai.run(payload.prompt)
      if (!result.ok) throw new Error(result.error)
      setAsk('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const choose = (value: ResearchTopic | null): void => {
    if (dirty) {
      setError(t('research.saveFirst'))
      return
    }
    select(value)
  }
  if (!snapshot || loadError !== null) return <FeatureLoadState error={loadError} onRetry={() => void reload()} />
  return (
    <section className="pd-research-layout" data-phase={topic ? 'saved' : 'new'}>
      <aside className="pd-research-list">
        <h2>{t('research.title')}</h2>
        <p className="pd-field-hint">{t('research.intro')}</p>
        <Button onClick={() => choose(null)}>{t('research.new')}</Button>
        {snapshot.document.topics.length === 0 ? <p className="pd-sidebar-empty">{t('research.noTopics')}</p> : null}
        {snapshot?.document.topics.map((item) => (
          <button
            className="pd-topic-row"
            data-selected={topic?.id === item.id}
            key={item.id}
            onClick={() => choose(item)}
          >
            {item.title}
            <small>
              {item.paperIds.length} {t('research.papers')}
            </small>
          </button>
        ))}
        <Button
          variant="ghost"
          onClick={() => {
            if (dirty) setError(t('research.saveFirst'))
            else void reload().then((next) => {
              if (next) select(topic ? next.document.topics.find((item) => item.id === topic.id) ?? null : null)
            })
          }}
        >
          {t('research.reload')}
        </Button>
      </aside>
      <div className="pd-research-editor">
        <header className="pd-section-head">
          <div><h2>{topic ? topic.title : t('research.new')}</h2><p className="pd-field-hint">{t(topic ? 'research.editHint' : 'research.createHint')}</p></div>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !question.trim()} onClick={() => void save()}>{t('research.save')}</Button>
        </header>
        {error ? (
          <p role="alert" className="pd-field-error">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        <section className="pd-topic-definition">
        <h3>{t('research.stepQuestion')}</h3>
        <label>
          {t('research.name')}
          <input
            className="pd-input"
            value={title}
            maxLength={200}
            placeholder={t('research.namePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {t('research.question')}
          <textarea
            className="pd-input"
            value={question}
            maxLength={4000}
            placeholder={t('research.questionPlaceholder')}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        </section>
        <fieldset>
          <legend>
            {t('research.stepSources')} · {ids.length}/30
          </legend>
          <p className="pd-field-hint">{t('research.contextHint')}</p>
          <input
            className="pd-input"
            aria-label={t('research.filter')}
            placeholder={t('research.filter')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="pd-topic-papers">
            {papers
              .filter((paper) =>
                `${paper.title} ${paper.authors.join(' ')}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((paper) => (
                <div key={paper.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={ids.includes(paper.id)}
                      disabled={!ids.includes(paper.id) && ids.length >= 30}
                      onChange={(event) =>
                        setIds((previous) =>
                          event.target.checked
                            ? [...previous, paper.id]
                            : previous.filter((id) => id !== paper.id),
                        )
                      }
                    />
                    <span>{paper.title}<small>{paper.authors.slice(0, 2).join(', ')}{paper.year ? ` · ${paper.year}` : ''}</small></span>
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (dirty) setError(t('research.saveFirst'))
                      else onOpenPaper(paper.id)
                    }}
                  >
                    {t('research.read')}
                  </Button>
                </div>
              ))}
          </div>
          {papers.length === 0 ? <p className="pd-field-hint">{t('research.noPapers')}</p> : null}
        </fieldset>
        <details className="pd-topic-notes-section">
        <summary>{t('research.notesOptional')}{notes.trim() ? ` · ${t('research.hasNotes')}` : ''}</summary>
        <label>
          {t('research.notes')}
          <textarea
            className="pd-input pd-topic-notes"
            value={notes}
            maxLength={60000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        </details>
        <div className="pd-research-actions">
          {!topic ? <p className="pd-field-hint">{t('research.afterSave')}</p> : null}
          {topic ? (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              {t('research.delete')}
            </Button>
          ) : null}
          {dirty ? <Button onClick={() => select(topic)}>{t('research.discard')}</Button> : null}
        </div>
      </div>
      {topic ? <aside className="pd-topic-discussion">
        <h3>{t('research.discuss')}</h3>
        <p className="pd-field-hint">{dirty ? t('research.saveFirst') : !ids.length ? t('research.chooseSources') : t('research.discussHint')}</p>
        {state.threadKey === topic?.id && state.error ? <p role="alert" className="pd-field-error">{state.error}</p> : null}
        {state.threadKey === topic?.id && (state.status === 'attaching' || state.status === 'running') ? <p role="status">{t(state.status === 'attaching' ? 'ai.attaching' : 'ai.thinking')}</p> : null}
        <div className="pd-topic-chat">
          {state.threadKey !== topic.id || state.rows.length === 0 ? <p className="pd-discussion-empty">{t('research.discussionEmpty')}</p> : null}
          {state.threadKey === topic?.id
            ? state.rows
                .filter((row) => row.kind === 'assistant' || row.kind === 'error')
                .map((row) => (
                  <div key={row.id}>
                    <Markdown markdown={row.text} />
                  </div>
                ))
            : null}
        </div>
        <textarea
          className="pd-input"
          aria-label={t('research.ask')}
          placeholder={t('research.ask')}
          value={ask}
          disabled={dirty || !ids.length || state.status === 'running'}
          onChange={(event) => setAsk(event.target.value)}
        />
        <Button
          variant="primary"
          disabled={!topic || dirty || !ids.length || !ask.trim() || state.status === 'running'}
          loading={busy}
          onClick={() => void discuss()}
        >
          {t('research.send')}
        </Button>
        {state.status === 'running' ? (
          <Button onClick={() => void ai.stop()}>{t('research.stop')}</Button>
        ) : null}
        <Button
          disabled={state.threadKey !== topic?.id || !ai.lastAnswer() || state.status === 'running'}
          onClick={() => setNotes((previous) => `${previous}\n\n${ai.lastAnswer() ?? ''}`.trim())}
        >
          {t('research.keepAnswer')}
        </Button>
      </aside> : null}
      <Modal
        open={deleting}
        title={t('research.delete')}
        description={t('research.deleteHint')}
        onClose={() => setDeleting(false)}
        footer={
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              if (!topic || !snapshot) return
              setBusy(true)
              void api
                .removeTopic(topic.id, snapshot.hash)
                .then((next) => {
                  setSnapshot(next)
                  select(null)
                  setDeleting(false)
                })
                .catch((err: unknown) => setError(errorText(err)))
                .finally(() => setBusy(false))
            }}
          >
            {t('research.delete')}
          </Button>
        }
      />
    </section>
  )
}
