import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PaperSummary, ResearchSnapshot, ResearchTopic } from '../src/types.js'
import { TOPIC_CONTEXT_CHAR_LIMIT } from '../src/researchLimits.js'
import { api, ApiError } from './api.js'
import { TopicHistory } from './TopicHistory.js'
import { createAiThread } from './aiSession.js'
import { TopicConversation } from './TopicConversation.js'
import { TopicCommentComposer, useReportSelection } from './TopicComments.js'
import { TopicDivider, useTopicPanels } from './TopicPanels.js'
import { browserDraftStore, clearSubmittedTopicDraft, emptyTopicDraft, readTopicDraft, topicDraftKey, writeTopicDraft } from './topicDraft.js'
import { topicQuestionPayload } from '../src/topicDiscussion.js'
import type { TopicDiscussionDraft } from '../src/topicDiscussion.js'
import { IconCopy, IconQuote } from './icons.js'
import { startTopicAnalysis, stopTopicAnalysis, subscribeTopicAnalysis, topicAnalysisState } from './topicAnalysis.js'
import { cardBodyForDisplay, Markdown, noteOutline } from './markdown.js'
import { useT, errorText } from './i18n.js'
import { Button, Menu, Modal, Spinner, Tabs } from './ui.js'
import { FeatureLoadState } from './FeatureLoadState.js'

export function ResearchView({ ctx, workspacePath, onOpenPaper, onDirtyChange, registerSave, onPapersChanged, supported }: {
  ctx: ClientContext; workspacePath: string; onOpenPaper: (id: string) => void
  onDirtyChange: (value: boolean) => void; registerSave: (save: (() => Promise<boolean>) | null) => void
  onPapersChanged: () => void; supported: boolean
}) {
  const t = useT()
  const [snapshot, setSnapshot] = useState<ResearchSnapshot | null>(null)
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const [more, setMore] = useState(false)
  const [topic, setTopic] = useState<ResearchTopic | null>(null)
  const visibleId = useRef<string | null>(null)
  const refreshToken = useRef(0)
  visibleId.current = topic?.id ?? null
  const [title, setTitle] = useState(''), [question, setQuestion] = useState(''), [notes, setNotes] = useState('')
  const [ids, setIds] = useState<string[]>([]), [focusIds, setFocusIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [discussion, setDiscussion] = useState<TopicDiscussionDraft>(emptyTopicDraft)
  const discussionRef = useRef(discussion); discussionRef.current = discussion
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const panels = useTopicPanels(Boolean(topic))
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [discussionError, setDiscussionError] = useState(''), [reportError, setReportError] = useState('')
  const [reportCopied, setReportCopied] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false), [cardsOpen, setCardsOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false), [notesMode, setNotesMode] = useState('preview')
  const [finishing, setFinishing] = useState(false), [markRead, setMarkRead] = useState(false), [deleting, setDeleting] = useState(false)
  const topicRef = useRef(topic)
  topicRef.current = topic
  const ai = useMemo(() => createAiThread(ctx), [ctx])
  const state = useSyncExternalStore(useCallback((listener) => ai.subscribe(listener), [ai]), ai.getSnapshot)
  useEffect(() => () => ai.dispose(), [ai])
  const analysisKey = `${workspacePath}:${topic?.id ?? 'new'}`
  const analysis = useSyncExternalStore(useCallback((listener) => subscribeTopicAnalysis(ctx, analysisKey, listener), [ctx, analysisKey]), useCallback(() => topicAnalysisState(ctx, analysisKey), [ctx, analysisKey]))
  const generating = analysis.phase === 'running'
  const reportMarkdown = generating ? analysis.markdown : topic?.analysis?.markdown ?? analysis.markdown
  const reportVersion = topic?.analysis?.updatedAt ?? ''
  useEffect(() => setReportCopied(false), [reportVersion])
  const reportSelection = useReportSelection(reportRef, `${topic?.id}:${reportVersion}:${generating}`)
  const outline = useMemo(() => noteOutline(reportMarkdown), [reportMarkdown])
  const dirty = title !== (topic?.title ?? '') || question !== (topic?.question ?? '') || notes !== (topic?.notes ?? '') || ids.join() !== (topic?.paperIds ?? []).join()
  const analysisStale = Boolean(topic?.analysis && (topic.analysis.question !== topic.question || [...(topic.analysis.definitionPaperIds ?? [])].sort().join() !== [...topic.paperIds].sort().join()))

  const select = (value: ResearchTopic | null) => {
    refreshToken.current++
    setTopic(value); setTitle(value?.title ?? ''); setQuestion(value?.question ?? ''); setNotes(value?.notes ?? '')
    setIds(value?.paperIds ?? []); setFocusIds(value?.analysis?.paperIds.filter((id) => value.paperIds.includes(id)) ?? value?.paperIds ?? [])
    setDiscussion(value ? readTopicDraft(browserDraftStore(), topicDraftKey(workspacePath, value.id)) : emptyTopicDraft()); setError(''); setDiscussionError(''); setReportError(''); setNotice(''); setEditing(false); setNotesOpen(false); setCardsOpen(false)
  }
  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const [next, list] = await Promise.all([api.research(), api.papers({ limit: 1000 })])
      setSnapshot(next); setPapers(list.papers); setMore(list.papers.length === 1000)
      return next
    } catch (err) { setLoadError(err); return null }
  }, [])
  useEffect(() => { if (supported) void reload() }, [reload, supported])
  useEffect(() => {
    if (topic && !writeTopicDraft(browserDraftStore(), topicDraftKey(workspacePath, topic.id), discussion)) setError(t('research.draftStorageError'))
  }, [discussion, topic?.id, workspacePath, t])
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!topic || !supported) return
    void ai.openThread(topic.id, { workspacePath, title: `${t('app.title')} · ${topic.title}` }).catch((err) => setError(errorText(err)))
  }, [ai, topic?.id, topic?.title, workspacePath, t])

  const syncDocuments = useCallback((next: ResearchSnapshot) => {
    setSnapshot(next)
    const previous = topicRef.current
    const value = next.document.topics.find((item) => item.id === previous?.id)
    if (!value || visibleId.current !== value.id) return
    setNotes((draft) => draft === previous?.notes ? value.notes : draft)
    setTopic(value)
    if (next.activityWarnings?.length) setError(next.activityWarnings.join('\n'))
    onPapersChanged()
  }, [onPapersChanged])
  const refreshDocuments = useCallback(async () => {
    const token = ++refreshToken.current, id = visibleId.current
    try {
      const next = await api.research()
      if (token === refreshToken.current && id === visibleId.current) syncDocuments(next)
    } catch (err) { if (token === refreshToken.current) setError(errorText(err)) }
  }, [syncDocuments])
  const previousStatus = useRef(state.status)
  const mutationKey = state.threadKey === topic?.id ? state.rows.filter((row) => row.mutation?.topicId === topic.id).map((row) => `${row.id}:${row.mutation?.hash}`).join('|') : ''
  const observedMutations = useRef('')
  useEffect(() => {
    const finished = previousStatus.current === 'running' && state.status !== 'running'
    const changed = Boolean(mutationKey) && observedMutations.current !== mutationKey
    previousStatus.current = state.status
    observedMutations.current = mutationKey
    if (finished || changed) void refreshDocuments()
  }, [state.status, mutationKey, refreshDocuments])
  const acceptSnapshot = (next: ResearchSnapshot) => {
    setSnapshot(next)
    if (next.activityWarnings?.length) setError(next.activityWarnings.join('\n'))
  }
  const generate = async (value: ResearchTopic, scope: string[]) => {
    if (!scope.length) { setError(t('research.chooseSources')); return }
    setError('')
    const next = await startTopicAnalysis(ctx, `${workspacePath}:${value.id}`, workspacePath, value.id, value.question, scope)
    if (next) {
      setSnapshot(next)
      setTopic((current) => current?.id === value.id ? next.document.topics.find((item) => item.id === value.id) ?? current : current)
    }
  }
  const save = useCallback(async (): Promise<boolean> => {
    if (!snapshot) return false
    if (!ids.length) { setError(t('research.chooseSources')); return false }
    setBusy(true); setError('')
    try {
      const next = await api.saveTopic({ ...(topic ? { id: topic.id } : {}), title, question, notes, paperIds: ids }, snapshot.hash)
      const saved = topic ? next.document.topics.find((item) => item.id === topic.id) : next.document.topics.at(-1)
      setSnapshot(next); setTopic(saved ?? null); setEditing(false)
      if (saved) { setTitle(saved.title); setQuestion(saved.question); setNotes(saved.notes); setIds(saved.paperIds); setFocusIds((current) => topic ? current.filter((id) => saved.paperIds.includes(id)) : saved.paperIds) }
      setNotice(t('research.saved'))
      if (next.activityWarnings?.length) setError(next.activityWarnings.join('\n'))
      onPapersChanged()
      if (!topic && saved) void generate(saved, saved.paperIds)
      return true
    } catch (err) { setError(errorText(err)); return false }
    finally { setBusy(false) }
  }, [snapshot, topic, title, question, notes, ids, t, onPapersChanged])
  useEffect(() => { registerSave(save); return () => registerSave(null) }, [save, registerSave])
  const viewDocument = (kind: 'analysis' | 'notes' | 'cards') => {
    if (kind === 'notes') { setNotesOpen(true); if (notes !== topic?.notes) { setNotesMode('edit'); setError(t('research.saveFirst')) } else setNotesMode('preview') }
    if (kind === 'cards') setCardsOpen(true)
    requestAnimationFrame(() => workspaceRef.current?.querySelector(`.pd-topic-${kind === 'notes' ? 'notebook' : kind}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const addComment = () => {
    if (!reportSelection || !topic?.analysis || generating) return
    if (reportSelection.quote.length > 4000 || reportSelection.formulas.some((formula) => formula.length > 4000)) { setReportError(t('research.selectionTooLong')); return }
    setReportError('')
    if (discussion.editor) { panels.reveal('chat'); return }
    setDiscussion((value) => ({ ...value, editor: { ...reportSelection, id: crypto.randomUUID(), comment: '', version: reportVersion } }))
    panels.reveal('chat')
    window.getSelection()?.removeAllRanges()
  }
  const discuss = async () => {
    if (!topic || dirty || !focusIds.length || (!discussion.message.trim() && !discussion.comments.length) || discussion.editor || generating || busy || state.status === 'running') return
    const topicId = topic.id, sent = discussionRef.current
    const question = sent.message.trim() || t('research.commentsQuestion')
    setBusy(true); setDiscussionError('')
    try {
      topicQuestionPayload(question, sent.comments)
      const payload = await api.topicPrompt(topicId, question, focusIds, true, 'discussion', sent.comments)
      await ai.openThread(topicId, { workspacePath, title: `${t('app.title')} · ${topic.title}` })
      const result = await ai.run(payload.prompt)
      if (!result.ok) throw new Error(result.error)
      if (visibleId.current === topicId) setDiscussion((value) => clearSubmittedTopicDraft(value, sent))
      else {
        const key = topicDraftKey(workspacePath, topicId), store = browserDraftStore()
        writeTopicDraft(store, key, clearSubmittedTopicDraft(readTopicDraft(store, key), sent))
      }
    } catch (err) { setDiscussionError(errorText(err)) }
    finally { setBusy(false) }
  }

  const choose = (value: ResearchTopic | null) => { if (dirty) setError(t('research.saveFirst')); else select(value) }
  const loadMore = async () => {
    setBusy(true)
    try { const next = await api.papers({ limit: 1000, offset: papers.length }); setPapers((old) => [...old, ...next.papers.filter((paper) => !old.some((item) => item.id === paper.id))]); setMore(next.papers.length === 1000) }
    catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const sourcePicker = <>
    <label>{t('research.filter')}<input className="pd-input" value={search} placeholder={t('research.filter')} onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="pd-topic-papers">{papers.filter((paper) => `${paper.title} ${paper.authors.join(' ')}`.toLowerCase().includes(search.toLowerCase())).map((paper) => <div key={paper.id}><label><input type="checkbox" disabled={busy || generating || state.status === 'running'} checked={ids.includes(paper.id)} onChange={(event) => setIds((current) => event.target.checked ? [...current, paper.id] : current.filter((id) => id !== paper.id))} /><span>{paper.title}<small>{paper.authors.slice(0, 2).join(', ')}{paper.year ? ` · ${paper.year}` : ''}</small></span></label><Button size="sm" variant="ghost" disabled={dirty} onClick={() => onOpenPaper(paper.id)}>{t('research.read')}</Button></div>)}</div>
    {more ? <Button disabled={busy} onClick={() => void loadMore()}>{t('research.loadMore')}</Button> : null}
    <p className="pd-field-hint">{t('research.collectionCount', { n: ids.length })}</p>
  </>
  const questionFields = <><label>{t('research.name')}<input className="pd-input" disabled={busy} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label><label>{t('research.question')}<textarea className="pd-input" disabled={busy} value={question} maxLength={4000} onChange={(event) => setQuestion(event.target.value)} /></label></>
  if (!supported) return <FeatureLoadState error={new ApiError(404, 'Research backend update required', null)} onRetry={onPapersChanged} />
  if (!snapshot || loadError !== null) return <FeatureLoadState error={loadError} onRetry={() => void reload()} />
  return <section ref={panels.rootRef} className="pd-research-layout pd-topic-layout" style={panels.style} data-compact={panels.compact} data-list-open={panels.listOpen} data-chat-open={panels.chatOpen} data-phase={topic ? 'saved' : 'new'}>
    <aside id="pd-topic-list" className="pd-research-list" hidden={!panels.listOpen}><h2>{t('research.title')}</h2><p className="pd-field-hint">{t('research.workflowIntro')}</p><Button onClick={() => choose(null)}>{t('research.new')}</Button>
      {snapshot.document.topics.map((item) => <button className="pd-topic-row" key={item.id} data-selected={topic?.id === item.id} onClick={() => choose(item)}>{item.title}<small>{t(item.status === 'completed' ? 'research.completed' : 'research.active')} · {item.paperIds.length} {t('research.papers')}</small></button>)}
      <Button variant="ghost" onClick={() => { if (dirty) setError(t('research.saveFirst')); else void reload().then((next) => { if (next) select(topic ? next.document.topics.find((item) => item.id === topic.id) ?? null : null) }) }}>{t('research.reload')}</Button>
    </aside>
    <TopicDivider side="list" panels={panels} />
    {panels.compact && panels.overlay ? <button type="button" className="pd-topic-panel-scrim" aria-label={t('research.closePanel')} onClick={() => panels.setOverlay(null)} /> : null}
    <main ref={workspaceRef} className="pd-research-editor pd-topic-workspace">
      <header className="pd-section-head"><div><h2>{topic?.title ?? t('research.new')}</h2><p className="pd-field-hint">{t(topic ? 'research.readingWorkspace' : 'research.createReadHint')}</p></div>
        {topic ? <div className="pd-topic-toolbar"><Button size="sm" disabled={generating || busy || state.status === 'running'} onClick={() => setEditing(true)}>{t('research.settings')}</Button><Button size="sm" disabled={generating || busy || dirty || state.status === 'running'} onClick={() => setHistoryOpen(true)}>{t('research.history')}</Button><Button size="sm" disabled={generating || busy || dirty || state.status === 'running'} onClick={() => { setMarkRead(false); setFinishing(true) }}>{t(topic.status === 'completed' ? 'research.reopen' : 'research.finish')}</Button></div> : null}
      </header>
      {error ? <p role="alert" className="pd-field-error">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
      {!topic ? <section className="pd-topic-setup">{questionFields}<fieldset><legend>{t('research.stepSources')}</legend>{sourcePicker}</fieldset><p className="pd-field-hint">{t('research.scopeBudget', { n: TOPIC_CONTEXT_CHAR_LIMIT })}</p><Button variant="primary" loading={busy} disabled={!title.trim() || !question.trim() || !ids.length} onClick={() => void save()}>{t('research.createAndRead')}</Button></section> : <>
        <section className="pd-topic-analysis"><header><div><h3>{t('research.interpretation')}</h3>{topic.analysis ? <small>{t('research.analysisSources', { n: topic.analysis.paperIds.length, total: topic.paperIds.length })} · {new Date(topic.analysis.updatedAt).toLocaleString()}</small> : null}</div><div className="pd-topic-report-actions">
          {outline.length ? <Menu label={t('research.outline')} triggerLabel={t('research.outline')} items={outline.map((heading, index) => ({ id: String(index), label: heading.label, onSelect: () => reportRef.current?.querySelectorAll('h2')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }))} /> : null}
          <Button size="sm" icon={<IconQuote />} disabled={Boolean(discussion.editor) || !reportSelection || !topic.analysis || generating} onMouseDown={(event) => event.preventDefault()} onClick={addComment}>{t('research.addComment')}</Button>
          <Button size="sm" variant="ghost" icon={<IconCopy />} disabled={!topic.analysis || generating} onClick={() => { setReportCopied(false); setReportError(''); void navigator.clipboard.writeText(topic.analysis!.markdown).then(() => setReportCopied(true)).catch((err) => setReportError(errorText(err))) }}>{t(reportCopied ? 'ai.copied' : 'ai.copyMarkdown')}</Button>
          {generating ? <Button size="sm" onClick={() => void stopTopicAnalysis(ctx, analysisKey)}>{t('research.stop')}</Button> : <Button size="sm" disabled={busy || dirty || !focusIds.length || state.status === 'running'} title={t('research.regenerateHint')} onClick={() => void generate(topic, focusIds)}>{t(topic.analysis ? 'research.regenerate' : 'research.startAnalysis')}</Button>}
        </div>{reportError ? <p className="pd-field-error pd-topic-report-error" role="alert">{reportError}</p> : null}</header>
          {generating ? <p className="pd-topic-progress" role="status"><Spinner size={14} />{t('research.generating')}</p> : null}
          {analysis.error ? <p role="alert" className="pd-field-error">{analysis.error}</p> : null}
          {!generating && topic.analysis && analysisStale ? <p className="pd-topic-stale">{t('research.analysisScopeHint')}</p> : null}
          {reportMarkdown ? <div ref={reportRef} className="pd-topic-report-body"><Markdown markdown={reportMarkdown} /></div> : <p className="pd-discussion-empty">{t('research.noAnalysis')}</p>}
          {topic.analysis && !generating ? <p className="pd-topic-report-hint">{t('research.reportCommentHint')}</p> : null}
        </section>
        <section className="pd-topic-notebook"><header><h3>{t('research.notebook')}</h3><Button size="sm" onClick={() => setNotesOpen((value) => !value)}>{t(notesOpen ? 'research.hideNotes' : 'research.showNotes')}</Button></header>
          {notesOpen ? <><Tabs value={notesMode} tabs={[{ id: 'preview', label: t('notes.preview') }, { id: 'edit', label: t('notes.edit') }]} onChange={setNotesMode} />{notesMode === 'edit' ? <textarea className="pd-textarea pd-topic-notes" aria-label={t('research.notes')} value={notes} maxLength={60000} onChange={(event) => setNotes(event.target.value)} /> : notes.trim() ? <div className="pd-topic-notes-preview"><Markdown markdown={notes} /></div> : <p className="pd-field-hint">{t('research.noNotes')}</p>}<div className="pd-research-actions"><Button disabled={!dirty || busy || generating || state.status === 'running'} loading={busy} onClick={() => void save()}>{t('research.saveNotes')}</Button>{notes !== topic.notes ? <Button variant="ghost" disabled={busy} onClick={() => { setNotes(topic.notes); setNotesMode('preview') }}>{t('research.discard')}</Button> : null}</div></> : <p className="pd-field-hint">{t('research.notesSummary')}</p>}
        </section>
        <section className="pd-topic-cards"><header><h3>{t('research.cards')} · {topic.cards?.length ?? 0}</h3><Button size="sm" onClick={() => setCardsOpen((value) => !value)}>{t(cardsOpen ? 'research.collapse' : 'research.expand')}</Button></header>
          {cardsOpen ? topic.cards?.length ? topic.cards.map((card) => <article key={card.id}><h4>{card.title}</h4><Markdown markdown={cardBodyForDisplay(card.title, card.body)} /><div className="pd-topic-card-sources">{card.sourcePaperIds.map((id) => <Button size="sm" variant="ghost" key={id} disabled={dirty} onClick={() => onOpenPaper(id)}>{papers.find((paper) => paper.id === id)?.title ?? id}</Button>)}</div></article>) : <p className="pd-field-hint">{t('research.noCards')}</p> : null}
        </section>
        <div className="pd-research-actions"><Button variant="ghost" disabled={generating} onClick={() => setDeleting(true)}>{t('research.delete')}</Button></div>
      </>}
    </main>
    {topic ? <><TopicDivider side="chat" panels={panels} /><aside id="pd-topic-chat" className="pd-topic-discussion" hidden={!panels.chatOpen}><header className="pd-topic-discussion-head"><h3>{t('research.continueDiscussion')}</h3><p className="pd-field-hint">{t('research.discussionPurpose')}</p></header><details className="pd-topic-focus"><summary>{t('research.discussScope', { n: focusIds.length, total: topic.paperIds.length })}</summary><div><Button size="sm" onClick={() => setFocusIds(topic.paperIds)}>{t('research.selectAll')}</Button><Button size="sm" onClick={() => setFocusIds([])}>{t('research.clearSelection')}</Button></div>{topic.paperIds.map((id) => <label key={id}><input type="checkbox" disabled={busy || generating || state.status === 'running'} checked={focusIds.includes(id)} onChange={(event) => setFocusIds((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} /><span>{papers.find((paper) => paper.id === id)?.title ?? id}</span></label>)}<p className="pd-field-hint">{t('research.scopeBudget', { n: TOPIC_CONTEXT_CHAR_LIMIT })}</p></details>
      <TopicConversation state={state} topicId={topic.id} onViewDocument={(kind) => { void refreshDocuments().then(() => viewDocument(kind)) }} onError={(error) => setDiscussionError(errorText(error))} />
      <div className="pd-topic-composer"><div className="pd-topic-composer-context"><TopicCommentComposer draft={discussion} version={reportVersion} busy={busy} onChange={(change) => { setDiscussionError(''); setDiscussion(change) }} /></div>
      <label className="pd-sr-only" htmlFor="pd-topic-question">{t('research.ask')}</label><textarea ref={inputRef} id="pd-topic-question" className="pd-textarea" maxLength={4000} placeholder={t('research.ask')} value={discussion.message} disabled={busy} onChange={(event) => { const message = event.target.value; setDiscussionError(''); setDiscussion((value) => ({ ...value, message })) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void discuss() } }} />
      {discussionError ? <p className="pd-field-error" role="alert">{discussionError}</p> : null}<footer><span>{t(discussion.editor ? 'research.finishCommentFirst' : 'research.sendHint')}</span>{state.status === 'running' ? <Button onClick={() => void ai.stop()}>{t('research.stop')}</Button> : <Button variant="primary" disabled={busy || generating || dirty || Boolean(discussion.editor) || (!discussion.message.trim() && !discussion.comments.length) || !focusIds.length} onClick={() => void discuss()}>{t('research.send')}</Button>}</footer></div>
    </aside></> : null}
    <Modal open={editing} title={t('research.settings')} onClose={() => { if (!busy) { setTitle(topic?.title ?? ''); setQuestion(topic?.question ?? ''); setIds(topic?.paperIds ?? []); setEditing(false) } }} wide footer={<Button variant="primary" loading={busy} disabled={!title.trim() || !question.trim()} onClick={() => void save()}>{t('research.save')}</Button>}><div className="pd-topic-setup">{questionFields}<fieldset><legend>{t('research.sources')}</legend>{sourcePicker}</fieldset><p className="pd-field-hint">{t('research.definitionHint')}</p></div></Modal>
    {historyOpen && topic ? <TopicHistory topicId={topic.id} onClose={() => setHistoryOpen(false)} onRestore={(next) => { syncDocuments(next); setNotice(t('research.restored')) }} /> : null}
    <Modal open={finishing} title={t(topic?.status === 'completed' ? 'research.reopen' : 'research.finish')} description={t('research.finishHint')} onClose={() => { if (!busy) setFinishing(false) }} footer={<Button variant="primary" loading={busy} onClick={() => { if (!topic || !snapshot) return; setBusy(true); void api.topicStatus(topic.id, topic.status === 'completed' ? 'active' : 'completed', markRead, snapshot.hash).then((next) => { acceptSnapshot(next); setTopic(next.document.topics.find((item) => item.id === topic.id) ?? null); setFinishing(false); onPapersChanged() }).catch((err) => setError(errorText(err))).finally(() => setBusy(false)) }}>{t('common.confirm')}</Button>}>
      {topic?.status !== 'completed' ? <label className="pd-topic-check"><input type="checkbox" checked={markRead} onChange={(event) => setMarkRead(event.target.checked)} />{t('research.markAllRead')}</label> : null}
    </Modal>
    <Modal open={deleting} title={t('research.delete')} description={t('research.deleteHint')} onClose={() => { if (!busy) setDeleting(false) }} footer={<Button variant="danger" loading={busy} onClick={() => { if (!topic || !snapshot) return; setBusy(true); void api.removeTopic(topic.id, snapshot.hash).then((next) => { setSnapshot(next); select(null); setDeleting(false) }).catch((err) => setError(errorText(err))).finally(() => setBusy(false)) }}>{t('research.delete')}</Button>} />
  </section>
}
