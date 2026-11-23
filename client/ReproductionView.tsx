import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReproductionSnapshot } from '../src/types.js'
import { reproductionQuestionPayload } from '../src/reproductionContract.js'
import { api, ApiError } from './api.js'
import { createAiThread } from './aiSession.js'
import { collectCitedPages } from './AiPanel.js'
import { Markdown, noteOutline } from './markdown.js'
import { TopicConversation } from './TopicConversation.js'
import { TopicCommentComposer, useReportSelection } from './TopicComments.js'
import { TopicDivider, useTopicPanels } from './TopicPanels.js'
import { browserDraftStore, clearSubmittedTopicDraft, emptyTopicDraft, readTopicDraft, topicDraftKey, writeTopicDraft } from './topicDraft.js'
import { readReproductionDraft, reproductionDraftKey, writeReproductionDraft } from './reproductionDraft.js'
import type { ReproductionDraft } from './reproductionDraft.js'
import { generateReproduction, reproductionJobKey, reproductionJobState, stopReproduction, subscribeReproductionJob } from './reproductionJob.js'
import { VersionHistory } from './VersionHistory.js'
import { Button, EmptyState, Menu, Modal, Spinner } from './ui.js'
import { IconCopy, IconQuote } from './icons.js'
import { errorText, useLang, useT } from './i18n.js'
import type { EditorNavigationControls } from './actionGuard.js'
import { reproductionDiscardAction } from './reproductionNavigation.js'
import { topDialog } from './dialogFocus.js'

export function ReproductionView({ ctx, paperId, libraryPath, supported, onDirtyChange, registerSave, registerNavigation, onActivity, onOpenSource, onReadPaper }: {
  ctx: ClientContext; paperId: string; libraryPath: string; supported: boolean
  onDirtyChange: (dirty: boolean) => void; registerSave: (save: (() => Promise<boolean>) | null) => void
  registerNavigation: (controls: EditorNavigationControls | null) => void
  onActivity: () => void; onOpenSource: (page: number) => void; onReadPaper: () => void
}) {
  const t = useT(), language = useLang()
  const [snapshot, setSnapshot] = useState<ReproductionSnapshot | null>(null)
  const [draft, setDraft] = useState<ReproductionDraft>({ markdown: '', instructions: '', baseHash: '' })
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [storageError, setStorageError] = useState(false)
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false), [asking, setAsking] = useState(false), [copying, setCopying] = useState(false)
  const [conflict, setConflict] = useState(false), [review, setReview] = useState<ReproductionSnapshot | null>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false), pauseBaseline = useRef<ReproductionSnapshot | null>(null), lastOwnWrite = useRef('')
  const docRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLElement>(null), inputRef = useRef<HTMLTextAreaElement>(null)
  const snapshotRef = useRef(snapshot), draftRef = useRef(draft), conflictRef = useRef(conflict)
  snapshotRef.current = snapshot; draftRef.current = draft; conflictRef.current = conflict
  const mounted = useRef(true), loaded = useRef(false), request = useRef(0), activeSave = useRef<Promise<boolean> | null>(null)
  const failedSave = useRef(''), activity = useRef(onActivity); activity.current = onActivity
  const draftKey = reproductionDraftKey(libraryPath, paperId)
  const discussionKey = topicDraftKey(libraryPath, `reproduction:${paperId}`)
  const [discussion, setDiscussion] = useState(() => readTopicDraft(browserDraftStore(), discussionKey))
  const discussionRef = useRef(discussion); discussionRef.current = discussion
  const jobKey = reproductionJobKey(libraryPath, paperId)
  const job = useSyncExternalStore(useCallback((listener) => subscribeReproductionJob(ctx, jobKey, listener), [ctx, jobKey]), useCallback(() => reproductionJobState(ctx, jobKey), [ctx, jobKey]))
  const generating = ['preparing', 'running', 'saving'].includes(job.phase)
  const ai = useMemo(() => createAiThread(ctx), [ctx])
  const state = useSyncExternalStore(useCallback((listener) => ai.subscribe(listener), [ai]), ai.getSnapshot)
  const threadKey = `${jobKey}:discussion`
  const chatting = asking || state.status === 'running' || state.status === 'attaching'
  const dirty = Boolean(snapshot?.document && (draft.markdown !== snapshot.document.markdown || draft.instructions !== snapshot.document.instructions))
  const panels = useTopicPanels(Boolean(snapshot?.document || generating), { withList: false, storageKey: 'paperdesk:reproduction-layout' })
  const version = snapshot?.hash ?? ''
  const selection = useReportSelection(docRef, `${paperId}:${version}:${generating}:${editing}`)
  const markdown = generating ? job.markdown || snapshot?.document?.markdown || '' : snapshot?.document?.markdown ?? ''
  const outline = useMemo(() => noteOutline(markdown), [markdown])
  const citedPages = useMemo(() => collectCitedPages([{ id: 'guide', kind: 'assistant', text: markdown }]).filter((page) => !snapshot?.document?.source.pageCount || page <= snapshot.document.source.pageCount), [markdown, snapshot?.document?.source.pageCount])

  const changeDraft = (change: Partial<ReproductionDraft>) => {
    const next = { ...draftRef.current, ...change }; draftRef.current = next; setDraft(next); setNotice('')
  }
  const accept = useCallback((next: ReproductionSnapshot, replace = false) => {
    const previous = snapshotRef.current
    const current = draftRef.current
    const hasChanges = Boolean(previous?.document && (current.markdown !== previous.document.markdown || current.instructions !== previous.document.instructions))
    if (!loaded.current) {
      const local = readReproductionDraft(browserDraftStore(), draftKey)
      if (local && (local.markdown || !next.document) && !(next.document && local.markdown === next.document.markdown && local.instructions === next.document.instructions)) {
        draftRef.current = local; setDraft(local)
        const mismatch = local.baseHash !== next.hash
        setConflict(mismatch); conflictRef.current = mismatch
        setNotice(t(mismatch ? 'reproduction.draftConflict' : 'reproduction.draftRestored'))
      } else {
        const initial = { markdown: next.document?.markdown ?? '', instructions: next.document?.instructions ?? '', baseHash: next.hash }
        draftRef.current = initial; setDraft(initial)
        writeReproductionDraft(browserDraftStore(), draftKey, null)
      }
      loaded.current = true
    } else if (replace || !hasChanges) {
      const initial = { markdown: next.document?.markdown ?? '', instructions: next.document?.instructions ?? '', baseHash: next.hash }
      draftRef.current = initial; setDraft(initial); setConflict(false); conflictRef.current = false
    } else if (previous?.hash !== next.hash) { setConflict(true); conflictRef.current = true; setError(t('reproduction.draftConflict')) }
    snapshotRef.current = next; setSnapshot(next)
  }, [draftKey, t])
  const reload = useCallback(async (replace = false) => {
    const token = ++request.current
    try {
      const next = await api.reproduction(paperId, libraryPath)
      if (mounted.current && request.current === token) { accept(next, replace); setLoadError(''); setLoading(false) }
    } catch (err) { if (mounted.current && request.current === token) { setLoadError(errorText(err)); setLoading(false) } }
  }, [paperId, libraryPath, accept])
  useEffect(() => {
    mounted.current = true
    if (supported) void reload(); else setLoading(false)
    return () => { mounted.current = false; request.current++ }
  }, [reload, supported])
  useEffect(() => () => ai.dispose(), [ai])
  useEffect(() => {
    if (!supported || !snapshot?.document) return
    void ai.openThread(threadKey, { workspacePath: libraryPath, title: `${t('reproduction.title')} · ${snapshot.document.source.title}` }).catch((err) => { if (mounted.current) setError(errorText(err)) })
  }, [ai, supported, Boolean(snapshot?.document), threadKey, libraryPath, t])
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!loaded.current) return
    const keep = dirty || (!snapshot?.document && Boolean(draft.instructions || draft.markdown))
    if (!writeReproductionDraft(browserDraftStore(), draftKey, keep ? draft : null)) setStorageError(true)
  }, [draft, dirty, draftKey, snapshot?.hash])
  useEffect(() => { if (!writeTopicDraft(browserDraftStore(), discussionKey, discussion)) setStorageError(true) }, [discussionKey, discussion])

  const save = useCallback(async (): Promise<boolean> => {
    if (activeSave.current) {
      const ok = await activeSave.current
      if (!ok) return false
    }
    const current = snapshotRef.current, pending = { ...draftRef.current }
    if (!current || !loaded.current) return false
    if (!pending.markdown.trim()) {
      if (current.document && mounted.current) setError(t('reproduction.emptyDocument'))
      return !current.document
    }
    if (conflictRef.current) return false
    if (current.document && pending.markdown === current.document.markdown && pending.instructions === current.document.instructions) return true
    const work = (async () => {
      if (mounted.current) { setSaving(true); setError('') }
      try {
        const next = await api.saveReproduction(paperId, libraryPath, { markdown: pending.markdown, instructions: pending.instructions, expectedHash: pending.baseHash })
        lastOwnWrite.current = next.hash
        const latestDraft = mounted.current ? draftRef.current : pending
        const updated = { ...latestDraft, baseHash: next.hash }
        const stillDirty = updated.markdown !== next.document?.markdown || updated.instructions !== next.document?.instructions
        writeReproductionDraft(browserDraftStore(), draftKey, stillDirty ? updated : null)
        if (mounted.current) {
          snapshotRef.current = next; setSnapshot(next)
          draftRef.current = updated; setDraft(updated)
          failedSave.current = ''; setNotice(t('meta.autosaved'))
          if (next.activity?.status) activity.current()
        }
        return true
      } catch (err) {
        failedSave.current = JSON.stringify(pending)
        if (mounted.current) {
          setError(errorText(err))
          if (err instanceof ApiError && err.status === 409) { conflictRef.current = true; setConflict(true) }
        }
        return false
      } finally { activeSave.current = null; if (mounted.current) setSaving(false) }
    })()
    activeSave.current = work
    return work
  }, [paperId, libraryPath, draftKey, t])
  useEffect(() => { registerSave(save); return () => registerSave(null) }, [save, registerSave])
  const navigation = useMemo<EditorNavigationControls>(() => ({
    pause() {
      const current = snapshotRef.current, pending = draftRef.current
      if (!current?.document || (pending.markdown === current.document.markdown && pending.instructions === current.document.instructions)) return false
      pauseBaseline.current = current; pausedRef.current = true; setPaused(true); return true
    },
    resume() { pauseBaseline.current = null; pausedRef.current = false; setPaused(false) },
    async discard() {
      const baseline = pauseBaseline.current
      if (!baseline?.document) return true
      try {
        if (activeSave.current) await activeSave.current
        let latest = await api.reproduction(paperId, libraryPath)
        const action = reproductionDiscardAction(baseline.hash, latest.hash, lastOwnWrite.current)
        if (action === 'conflict') throw new Error(t('reproduction.draftConflict'))
        if (action === 'restore') {
          latest = await api.saveReproduction(paperId, libraryPath, { markdown: baseline.document.markdown, instructions: baseline.document.instructions, expectedHash: latest.hash })
        }
        accept(latest, true); writeReproductionDraft(browserDraftStore(), draftKey, null)
        pausedRef.current = false; setPaused(false); pauseBaseline.current = null; return true
      } catch (err) { setError(errorText(err)); setConflict(true); conflictRef.current = true; return false }
    },
  }), [paperId, libraryPath, draftKey, accept, t])
  useEffect(() => { registerNavigation(navigation); return () => registerNavigation(null) }, [navigation, registerNavigation])
  useEffect(() => {
    if (!dirty || paused || conflict || saving || chatting || generating || failedSave.current === JSON.stringify(draft)) return
    const timer = setTimeout(() => { if (!pausedRef.current) void save() }, 800)
    return () => clearTimeout(timer)
  }, [dirty, draft, paused, conflict, saving, chatting, generating, save])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!scrollRef.current || scrollRef.current.offsetParent === null || topDialog()) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!pausedRef.current) void save() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [save])
  useEffect(() => { if (job.phase === 'complete' && job.saved) { void reload(); if (job.saved.activity?.status) activity.current() } }, [job.phase, job.saved?.hash, reload])
  const previousStatus = useRef(state.status)
  const mutationKey = state.rows.map((row) => row.reproductionMutation?.paperId === paperId ? `${row.id}:${row.reproductionMutation.hash}` : '').filter(Boolean).join('|')
  useEffect(() => {
    const finished = previousStatus.current === 'running' && state.status !== 'running'
    previousStatus.current = state.status
    if (finished || mutationKey) void reload()
    if (finished) activity.current()
  }, [state.status, mutationKey, reload])

  const generate = async () => {
    if (generating || chatting || saving || conflict || !(await save())) return
    setError(''); setNotice(''); setEditing(false)
    const next = await generateReproduction(ctx, libraryPath, paperId, draftRef.current.instructions, language)
    if (next && mounted.current) accept(next, true)
  }
  const copy = async () => {
    if (copying || generating || chatting || conflict || !(await save())) return
    setCopying(true); setError('')
    try {
      const value = snapshotRef.current
      if (!value?.document) return
      const task = await api.exportReproduction(paperId, libraryPath, value.hash, language)
      await navigator.clipboard.writeText(task.markdown)
      if (mounted.current) setNotice(t('reproduction.copied'))
    } catch (err) { if (mounted.current) setError(errorText(err)) }
    finally { if (mounted.current) setCopying(false) }
  }
  const addComment = () => {
    if (!selection || generating || editing || discussion.editor) return
    if (selection.quote.length > 4000 || selection.formulas.some((formula) => formula.length > 4000)) { setError(t('research.selectionTooLong')); return }
    setDiscussion((value) => ({ ...value, editor: { ...selection, id: crypto.randomUUID(), comment: '', version } }))
    panels.reveal('chat'); window.getSelection()?.removeAllRanges()
  }
  const discuss = async () => {
    if (!snapshot?.document || generating || chatting || discussionRef.current.editor || conflict || !(await save())) return
    const sent = discussionRef.current
    if (!sent.message.trim() && !sent.comments.length) return
    setAsking(true); setError('')
    try {
      const question = sent.message.trim() || t('reproduction.commentQuestion')
      reproductionQuestionPayload(question, sent.comments)
      const payload = await api.reproductionPrompt(paperId, libraryPath, { intent: 'discussion', question, comments: sent.comments, language })
      await ai.openThread(threadKey, { workspacePath: libraryPath, title: `${t('reproduction.title')} · ${snapshot.document.source.title}` })
      const result = await ai.run(payload.prompt)
      if (!result.ok) throw new Error(result.error || t('error.generic'))
      if (mounted.current) setDiscussion((value) => clearSubmittedTopicDraft(value, sent))
      else writeTopicDraft(browserDraftStore(), discussionKey, clearSubmittedTopicDraft(readTopicDraft(browserDraftStore(), discussionKey), sent))
    } catch (err) { if (mounted.current) setError(errorText(err)) }
    finally { if (mounted.current) setAsking(false) }
  }

  if (!supported) return <EmptyState title={t('reproduction.title')} description={t('reproduction.reloadBackend')} />
  if (loading) return <div className="pd-loading-block"><Spinner label={t('common.loading')} /></div>
  const doc = snapshot?.document
  const blocked = generating || chatting || saving
  const requirements = <label className="pd-reproduction-requirements">{t(doc ? 'reproduction.requirements' : 'reproduction.requirementsOptional')}<textarea className="pd-textarea" maxLength={4000} value={draft.instructions} disabled={blocked || conflict || paused} placeholder={t('reproduction.requirementsHint')} onChange={(event) => changeDraft({ instructions: event.target.value })} />{doc ? <small>{t('reproduction.requirementsEditHint')}</small> : null}</label>
  return <section ref={panels.rootRef} className="pd-reproduction pd-topic-layout" data-compact={panels.compact} data-chat-open={panels.chatOpen} style={panels.style} aria-label={t('reproduction.title')}>
    {panels.overlay ? <button className="pd-topic-panel-scrim" aria-label={t('common.close')} onClick={() => panels.setOverlay(null)} /> : null}
    <main ref={scrollRef} className="pd-reproduction-document">
      <header className="pd-reproduction-toolbar"><div><h3>{t('reproduction.title')}</h3><p>{doc ? <><span>{t('reproduction.ready')}</span><span className="pd-reproduction-verification" title={t('reproduction.unverifiedHint')}>{t('reproduction.unverified')}</span></> : t('reproduction.subtitle')}</p></div>
        <div className="pd-reproduction-actions">{doc ? <Button size="sm" variant="primary" icon={<IconCopy />} loading={copying} disabled={blocked || conflict} title={t('reproduction.copyHint')} onClick={() => void copy()}>{t('reproduction.copy')}</Button> : null}
          <VersionHistory paperId={paperId} kind="reproduction" libraryPath={libraryPath} disabled={blocked || dirty} onRestored={() => reload(true)} />
          {doc ? <Menu label={t('reproduction.actions')} disabled={blocked || conflict} items={[
            { id: 'edit', label: t(editing ? 'reproduction.preview' : 'reproduction.edit'), onSelect: () => setEditing((value) => !value) },
            { id: 'generate', label: t('reproduction.regenerate'), onSelect: () => { void generate() } },
            { id: 'source', label: t('reproduction.readPaper'), onSelect: onReadPaper },
          ]} /> : null}
        </div>
      </header>
      {loadError ? <div role="alert" className="pd-reproduction-feedback"><p>{loadError}</p><Button size="sm" onClick={() => void reload()}>{t('common.retry')}</Button></div> : null}
      {error || notice || storageError || job.storageError ? <div className="pd-reproduction-feedback" aria-live="polite">{error ? <p className="pd-field-error" role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}{storageError || job.storageError ? <p className="pd-field-error">{t('reproduction.storageError')}</p> : null}{error && dirty && !conflict ? <Button size="sm" onClick={() => void save()}>{t('reproduction.retrySave')}</Button> : null}</div> : null}
      {conflict ? <div className="pd-reproduction-feedback" role="alert"><p>{t('reproduction.draftConflict')}</p><Button size="sm" onClick={() => { void api.reproduction(paperId, libraryPath).then(setReview).catch((err) => setError(errorText(err))) }}>{t('reproduction.loadLatest')}</Button></div> : null}
      {snapshot?.stale ? <p className="pd-topic-stale">{t('reproduction.stale')}</p> : null}
      {generating ? <div className="pd-reproduction-progress" role="status"><Spinner /><span>{t(job.phase === 'preparing' ? 'reproduction.preparing' : job.phase === 'saving' ? 'reproduction.saving' : 'reproduction.generating')}</span><Button size="sm" disabled={job.phase === 'saving'} onClick={() => void stopReproduction(ctx, jobKey)}>{t('research.stop')}</Button></div> : null}
      {job.warning ? <p className="pd-field-hint">{job.warning}</p> : null}
      {doc ? <><details className="pd-reproduction-context"><summary>{t('reproduction.requirements')}</summary>{requirements}</details><details className="pd-reproduction-context"><summary>{t('reproduction.source')}</summary><div><strong>{doc.source.title}</strong><p>{doc.source.authors.join(', ')}{doc.source.year ? ` · ${doc.source.year}` : ''}</p>{doc.source.links.length ? doc.source.links.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>) : <p>{t('reproduction.noLink')}</p>}{(snapshot?.references ?? []).length ? <section className="pd-reproduction-resources"><strong>{t('reproduction.relatedLinks')}</strong><p>{t('reproduction.linksUnverified')}</p>{snapshot!.references.map((reference) => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer">p.{reference.page} · {reference.url}</a>)}</section> : null}<div className="pd-reproduction-citations">{citedPages.map((page) => <Button size="sm" variant="ghost" key={page} onClick={() => onOpenSource(page)}>p.{page}</Button>)}<Button size="sm" variant="ghost" onClick={onReadPaper}>{t('reproduction.readPaper')}</Button></div></div></details></> : !generating ? <div className="pd-reproduction-empty">{requirements}<Button variant="primary" loading={generating} disabled={!snapshot || blocked || conflict} onClick={() => void generate()}>{t('reproduction.generate')}</Button></div> : null}
      {doc || generating ? <>{outline.length > 0 && !editing ? <details className="pd-reproduction-context pd-reproduction-outline"><summary>{t('reproduction.outline')}</summary><nav aria-label={t('reproduction.outline')}>{outline.map((item, index) => <button type="button" key={`${item.offset}`} onClick={() => docRef.current?.querySelectorAll('h2').item(index)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{item.label}</button>)}</nav></details> : null}
        <div className="pd-reproduction-reading-controls">{doc ? <Button size="sm" variant="ghost" icon={<IconQuote />} disabled={!selection || blocked || editing || Boolean(discussion.editor)} onMouseDown={(event) => event.preventDefault()} onClick={addComment}>{t('research.addComment')}</Button> : null}<span role="status">{saving ? t('meta.autosaving') : dirty ? t('notes.dirty') : doc ? t('meta.autosaved') : ''}</span></div>
        {editing && doc ? <textarea className="pd-textarea pd-reproduction-editor" aria-label={t('reproduction.edit')} maxLength={120000} value={draft.markdown} disabled={blocked && !saving || conflict || paused} onChange={(event) => changeDraft({ markdown: event.target.value })} /> : <div ref={docRef} className="pd-reproduction-body"><Markdown markdown={markdown} /></div>}
      </> : null}
      {!generating && (job.phase === 'stopped' || job.phase === 'error') ? <section className="pd-reproduction-feedback"><p className="pd-field-error" role="alert">{job.error}</p><p>{t('reproduction.draftHint')}</p>{job.markdown ? <details><summary>{t('reproduction.draft')}</summary><Markdown markdown={job.markdown} /><Button size="sm" onClick={() => { void navigator.clipboard.writeText(job.markdown).then(() => setNotice(t('ai.copied'))).catch((err) => setError(errorText(err))) }}>{t('reproduction.copyDraft')}</Button></details> : null}{doc ? <Button size="sm" disabled={blocked || dirty || conflict} onClick={() => void generate()}>{t('reproduction.regenerate')}</Button> : null}</section> : null}
    </main>
    {doc || generating ? <><TopicDivider side="chat" panels={panels} /><aside id="pd-topic-chat" className="pd-topic-discussion" hidden={!panels.chatOpen}><header className="pd-topic-discussion-head"><h3>{t('reproduction.chatTitle')}</h3><p className="pd-field-hint">{t('reproduction.chatHint')}</p></header>
      <TopicConversation state={state} topicId={threadKey} reproduction={{ paperId, threadKey, onViewDocument: () => { void reload(); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); panels.setOverlay(null) } }} onViewDocument={() => { void reload() }} onError={(err) => setError(errorText(err))} />
      {state.status === 'error' ? <p className="pd-field-error" role="alert">{state.error}</p> : null}
      <div className="pd-topic-composer"><div className="pd-topic-composer-context"><TopicCommentComposer draft={discussion} version={version} busy={chatting || generating} onChange={setDiscussion} /></div>
        <textarea ref={inputRef} className="pd-textarea" aria-label={t('reproduction.ask')} placeholder={t('reproduction.ask')} maxLength={16000} value={discussion.message} disabled={generating || !doc || asking} onChange={(event) => { const message = event.target.value; setDiscussion((value) => ({ ...value, message })) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void discuss() } }} />
        <footer><span>{t('ai.sendHint')}</span>{state.status === 'running' ? <Button size="sm" onClick={() => void ai.stop()}>{t('research.stop')}</Button> : <Button size="sm" variant="primary" loading={asking} disabled={!doc || generating || saving || chatting || conflict || Boolean(discussion.editor) || (!discussion.message.trim() && !discussion.comments.length)} onClick={() => void discuss()}>{t('ai.send')}</Button>}</footer>
      </div></aside></> : null}
    <Modal open={Boolean(review)} title={t('reproduction.conflictTitle')} description={t('reproduction.conflictHint')} wide onClose={() => setReview(null)} footer={<><Button onClick={() => setReview(null)}>{t('reproduction.keepDraft')}</Button><Button variant="primary" onClick={() => { if (review) { accept(review, true); setReview(null); setError(''); failedSave.current = ''; writeReproductionDraft(browserDraftStore(), draftKey, null) } }}>{t('reproduction.useLatest')}</Button></>}>
      {review?.document ? <Markdown markdown={review.document.markdown} /> : <p>{t('reproduction.generateFirst')}</p>}
    </Modal>
  </section>
}
