/**
 * PaperDesk panel shell (native `main` slot).
 *
 * Owns: CSS injection, i18n provider, first-run setup, navigation, search,
 * filters, selection + unsaved-notes guard, detail/text loading, imports
 * (file picker + drag & drop), all API calls (through `client/api.ts`) and the
 * toast stream. Views stay presentational and receive data + callbacks.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AnnotationDocument,
  AnnotationItem,
  AnnotationPatch,
  AnnotationRect,
  AssistPayload,
  AssistTask,
  CardsDocument,
  ExtractedText,
  NewAnnotation,
  NewNoteCard,
  NoteCard,
  NotesDocument,
  NotesWriteResult,
  PaperDetail,
  PaperMeta,
  PaperStatus,
  PaperSummary,
  RelationsDocument,
  StatusPayload,
  SyncStatus,
} from '../src/types.js'
import type { SettingsPatch, SettingsPayload } from './api.js'
import { api } from './api.js'
import { createAiThread } from './aiSession.js'
import { defaultLibraryPath, openHostPath, openSessionInShell, pickLibraryDirectory } from './agent.js'
import { errorText, I18nProvider, useT } from './i18n.js'
import type { Lang } from './i18n.js'
import { IconBook, IconClose, IconGear, IconImport, IconLang, IconSearch, IconSync } from './icons.js'
import { cardToNotesMarkdown } from './CardsPanel.js'
import { CompareView } from './CompareView.js'
import { LibraryView } from './LibraryView.js'
import type { SortKey } from './LibraryView.js'
import { ReaderView } from './ReaderView.js'
import { RelationsGraph } from './RelationsGraph.js'
import type { ReaderBusy } from './ReaderView.js'
import { SettingsView } from './SettingsView.js'
import { CSS, STYLE_ATTR } from './styles.js'
import { SyncView } from './SyncView.js'
import { Button, Modal, Spinner, Toast } from './ui.js'
import type { ToastItem, ToastKind } from './ui.js'

type Nav = 'library' | 'sync' | 'settings'

type OverlayState =
  | { kind: 'none' }
  | { kind: 'compare' }
  | { kind: 'relations'; focusPaperId?: string }

/** Max per-paper annotation undo entries kept in memory. */
const UNDO_LIMIT = 50

/** Inverse of one successful annotation mutation, scoped to its paper. */
type AnnotationUndoEntry =
  | { kind: 'create'; paperId: string; id: string }
  | { kind: 'update'; paperId: string; id: string; previous: AnnotationPatch }
  | { kind: 'delete'; paperId: string; item: AnnotationItem }

function isNotFound(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 404
}

const TOAST_MS = 5200
const TOAST_LIMIT = 4

/* ── CSS injection (once, removed on unmount) ──────────────────────────── */

function usePluginCss(): void {
  useEffect(() => {
    const selector = `style[data-plugin-css="${STYLE_ATTR}"]`
    if (document.head.querySelector(selector) !== null) return
    const style = document.createElement('style')
    style.setAttribute('data-plugin-css', STYLE_ATTR)
    style.textContent = CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, [])
}

/* ── render error boundary ─────────────────────────────────────────────── */

interface BoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

interface BoundaryState {
  failed: boolean
}

class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function RenderFailure() {
  const t = useT()
  return (
    <div className="pd-root">
      <div className="pd-setup-wrap">
        <div className="pd-setup" role="alert">
          <div className="pd-setup-head">
            <span className="pd-setup-mark">
              <IconBook size={22} />
            </span>
            <h1 className="pd-setup-title">{t('app.title')}</h1>
          </div>
          <p className="pd-setup-desc">{t('app.renderError')}</p>
          <div className="pd-setup-actions">
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('app.reload')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── App ───────────────────────────────────────────────────────────────── */

export function App({ ctx }: { ctx: ClientContext }) {
  const [lang, setLang] = useState<Lang>('zh')
  usePluginCss()
  return (
    <I18nProvider lang={lang}>
      <AppErrorBoundary fallback={<RenderFailure />}>
        <AppBody ctx={ctx} lang={lang} onLangChange={setLang} />
      </AppErrorBoundary>
    </I18nProvider>
  )
}

interface AppBodyProps {
  ctx: ClientContext
  lang: Lang
  onLangChange: (lang: Lang) => void
}

function AppBody({ ctx, lang, onLangChange }: AppBodyProps) {
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t

  /* In-panel AI thread controller (one retained session per paper). */
  const ai = useMemo(() => createAiThread(ctx), [ctx])
  useEffect(() => {
    return () => {
      ai.dispose()
    }
  }, [ai])

  /* bootstrap */
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)

  /* navigation / search / filters */
  const [nav, setNav] = useState<Nav>('library')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<PaperStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('added')

  /* library list */
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const [count, setCount] = useState(0)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  /* detail */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailNonce, setDetailNonce] = useState(0)
  const [busy, setBusy] = useState<ReaderBusy | null>(null)

  /* extracted text (lazy) */
  const [extractedText, setExtractedText] = useState<ExtractedText | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  const [textError, setTextError] = useState<string | null>(null)

  /* in-app viewer annotations */
  const selectedIdRef = useRef<string | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationDocument | null>(null)
  const [annotationsLoading, setAnnotationsLoading] = useState(false)
  const annotationsRef = useRef<AnnotationDocument | null>(null)
  /** Undo stack for the currently selected paper (cleared on paper switch). */
  const undoStackRef = useRef<AnnotationUndoEntry[]>([])

  /* note cards for the selected paper */
  const [cards, setCards] = useState<CardsDocument | null>(null)
  const [cardsLoading, setCardsLoading] = useState(false)
  const cardsRef = useRef<CardsDocument | null>(null)

  /* paper knowledge graph + full-panel overlays */
  const [relations, setRelations] = useState<RelationsDocument | null>(null)
  const [overlay, setOverlay] = useState<OverlayState>({ kind: 'none' })

  /* notes dirty guard */
  const [notesDirty, setNotesDirty] = useState(false)
  const [guardSaving, setGuardSaving] = useState(false)
  const [unsavedPrompt, setUnsavedPrompt] = useState<{ run: () => void } | null>(null)
  const saveNotesRef = useRef<(() => Promise<boolean>) | null>(null)

  /* imports */
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /* agent assist */
  const [assistBusy, setAssistBusy] = useState<AssistTask | null>(null)

  /* sync */
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState<string | null>(null)

  /* settings */
  const [settings, setSettings] = useState<SettingsPayload | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsBusy, setSettingsBusy] = useState<string | null>(null)

  /* first-run setup */
  const [setupPath, setSetupPath] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [defaultPath, setDefaultPath] = useState('~/Documents/PaperDesk')

  /* toasts */
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)
  const timersRef = useRef(new Map<number, number>())

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = toastIdRef.current + 1
    toastIdRef.current = id
    setToasts((previous) => [...previous.slice(-(TOAST_LIMIT - 1)), { id, kind, message }])
    const timer = window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id))
      timersRef.current.delete(id)
    }, TOAST_MS)
    timersRef.current.set(id, timer)
  }, [])

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const reportError = useCallback(
    (error: unknown, fallbackKey = 'error.generic') => {
      const message = errorText(error)
      pushToast('error', message !== '' ? message : t(fallbackKey))
    },
    [pushToast, t],
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  selectedIdRef.current = selectedId

  const setAnnotationsDoc = useCallback((document: AnnotationDocument | null) => {
    annotationsRef.current = document
    setAnnotations(document)
  }, [])

  const setCardsDoc = useCallback((document: CardsDocument | null) => {
    cardsRef.current = document
    setCards(document)
  }, [])

  /* Undo history belongs to one paper: reset it as soon as selection changes. */
  useEffect(() => {
    undoStackRef.current = []
  }, [selectedId])

  const pushUndo = useCallback((entry: AnnotationUndoEntry) => {
    const stack = undoStackRef.current
    stack.push(entry)
    if (stack.length > UNDO_LIMIT) stack.splice(0, stack.length - UNDO_LIMIT)
  }, [])

  const configured = status !== null && status.configured && status.libraryExists
  /* Re-fetch when the configured folder changes (settings / first run). */
  const activeLibraryPath = status?.settings.libraryPath ?? ''

  /* ── relation graph count (chip in the reader header) ────────────────── */
  const refreshRelations = useCallback(async (): Promise<void> => {
    if (!configured) {
      setRelations(null)
      return
    }
    try {
      setRelations(await api.relations())
    } catch {
      /* The graph overlay reports its own errors; the chip just shows a count. */
      setRelations(null)
    }
  }, [configured, activeLibraryPath])

  useEffect(() => {
    void refreshRelations()
  }, [refreshRelations, papers.length])

  const relationCount = useMemo(() => {
    const paperId = selectedId
    if (paperId === null || relations === null) return 0
    return relations.items.filter((relation) => relation.from === paperId || relation.to === paperId).length
  }, [relations, selectedId])

  /* After importing papers with citationSync enabled, parse their reference
     lists once per paper and refresh the graph the reader chip uses. */
  const citationSyncTriedRef = useRef<Set<string>>(new Set())
  const maybeSyncCitations = useCallback(
    (paperIds: readonly string[]): void => {
      if (status?.settings.citationSync !== true) return
      const fresh = paperIds.filter((id) => id !== '' && !citationSyncTriedRef.current.has(id))
      if (fresh.length === 0) return
      for (const id of fresh) citationSyncTriedRef.current.add(id)
      void (async () => {
        try {
          const result = await api.citationsSync(fresh)
          if (result.added.length > 0) {
            setRelations(await api.relations())
            pushToast('success', tRef.current('settings.citationSyncDone', { added: result.added.length, skipped: result.skipped }))
          }
        } catch {
          pushToast('warn', tRef.current('settings.citationSyncFailed'))
        }
      })()
    },
    [status?.settings.citationSync, pushToast],
  )

  /* Attach the AI thread to the selected paper (re-runs only on paper/path/title change). */
  const aiOpenRef = useRef<{ paperId: string; title: string } | null>(null)
  /* `detail` still holds the previous paper for one render after a switch. */
  const detailForSelection = detail !== null && detail.meta.id === selectedId ? detail : null
  const aiPaperTitle = detailForSelection?.meta.title ?? ''
  /* Wait for the paper detail (title) before the first attach so we do not
   * attach twice per paper switch; a failed detail load still settles. */
  const aiDetailSettled = detailForSelection !== null || (!detailLoading && detailError !== null)
  useEffect(() => {
    if (selectedId === null || activeLibraryPath === '' || !aiDetailSettled) return
    const previous = aiOpenRef.current
    if (previous !== null && previous.paperId === selectedId && previous.title === aiPaperTitle) return
    aiOpenRef.current = { paperId: selectedId, title: aiPaperTitle }
    const paperTitle = aiPaperTitle !== '' ? aiPaperTitle : selectedId
    void ai
      .openPaper(selectedId, { workspacePath: activeLibraryPath, paperTitle })
      .catch((error: unknown) => {
        /* The controller also publishes an error state; surface it in the panel. */
        reportError(error, 'ai.attachFailed')
      })
  }, [ai, selectedId, activeLibraryPath, aiPaperTitle, aiDetailSettled, reportError])

  /* ── status / settings bootstrap ─────────────────────────────────────── */

  const loadStatus = useCallback(
    async (silent = false): Promise<StatusPayload | null> => {
      if (!silent) setBooting(true)
      try {
        const next = await api.status()
        setStatus(next)
        setBootError(null)
        onLangChange(next.settings.language)
        return next
      } catch (error) {
        setBootError(errorText(error) || tRef.current('error.loadStatus'))
        return null
      } finally {
        setBooting(false)
      }
    },
    [onLangChange],
  )

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    void defaultLibraryPath(ctx).then((path) => setDefaultPath(path))
  }, [ctx])

  const setupSeededRef = useRef(false)
  useEffect(() => {
    if (status === null || setupSeededRef.current) return
    setupSeededRef.current = true
    if (setupPath === '') setSetupPath(status.settings.libraryPath)
  }, [status, setupPath])

  /* ── papers ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadPapers = useCallback(async (): Promise<void> => {
    if (!configured) return
    setListLoading(true)
    setListError(null)
    try {
      const result = await api.papers({
        q: query !== '' ? query : undefined,
        tag: tagFilter !== '' ? tagFilter : undefined,
        status: statusFilter,
        sort,
      })
      setPapers(result.papers)
      setCount(result.count)
    } catch (error) {
      setListError(errorText(error) || tRef.current('error.loadList'))
    } finally {
      setListLoading(false)
    }
  }, [configured, activeLibraryPath, query, tagFilter, statusFilter, sort])

  useEffect(() => {
    void loadPapers()
  }, [loadPapers])

  const tags = useMemo(() => {
    const seen = new Set<string>()
    for (const paper of papers) for (const tag of paper.tags) seen.add(tag)
    if (tagFilter !== '') seen.add(tagFilter)
    return [...seen].sort((left, right) => left.localeCompare(right))
  }, [papers, tagFilter])

  /* ── detail ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null)
      setDetailError(null)
      setDetailLoading(false)
      setExtractedText(null)
      setTextError(null)
      setAnnotationsDoc(null)
      setAnnotationsLoading(false)
      setCardsDoc(null)
      setCardsLoading(false)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    setExtractedText(null)
    setTextError(null)
    setAnnotationsDoc(null)
    setAnnotationsLoading(true)
    setCardsDoc(null)
    setCardsLoading(true)
    Promise.allSettled([api.paper(selectedId), api.annotations(selectedId), api.cards(selectedId)])
      .then(([paperResult, annotationsResult, cardsResult]) => {
        if (cancelled) return
        if (paperResult.status === 'fulfilled') {
          setDetail(paperResult.value)
          setExtractedText(paperResult.value.text)
        } else {
          setDetailError(errorText(paperResult.reason) || tRef.current('error.loadDetail'))
        }
        if (annotationsResult.status === 'fulfilled') {
          setAnnotationsDoc(annotationsResult.value)
        } else {
          setAnnotationsDoc(null)
          pushToast('warn', errorText(annotationsResult.reason) || tRef.current('annotations.loadFailed'))
        }
        if (cardsResult.status === 'fulfilled') {
          setCardsDoc(cardsResult.value)
        } else {
          setCardsDoc(null)
          pushToast('warn', errorText(cardsResult.reason) || tRef.current('cards.loadFailed'))
        }
      })
      .finally(() => {
        if (cancelled) return
        setDetailLoading(false)
        setAnnotationsLoading(false)
        setCardsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, detailNonce, pushToast, setAnnotationsDoc, setCardsDoc])

  /* Auto-select the first row when nothing is selected yet. */
  useEffect(() => {
    if (!configured || nav !== 'library' || selectedId !== null) return
    const first = papers[0]
    if (first !== undefined) setSelectedId(first.id)
  }, [configured, nav, papers, selectedId])

  const applyMeta = useCallback((meta: PaperMeta) => {
    setDetail((previous) => (previous !== null && previous.meta.id === meta.id ? { ...previous, meta } : previous))
    setPapers((previous) =>
      previous.map((paper) =>
        paper.id === meta.id
          ? {
              ...paper,
              title: meta.title,
              authors: meta.authors,
              year: meta.year,
              venue: meta.venue,
              doi: meta.doi,
              tags: meta.tags,
              status: meta.status,
              rating: meta.rating,
              updatedAt: meta.updatedAt,
            }
          : paper,
      ),
    )
  }, [])

  /* ── unsaved-notes guard ─────────────────────────────────────────────── */

  const requestAction = useCallback(
    (run: () => void) => {
      if (notesDirty) {
        setUnsavedPrompt({ run })
        return
      }
      run()
    },
    [notesDirty],
  )

  const selectPaper = useCallback(
    (id: string) => {
      if (id === selectedId) return
      requestAction(() => setSelectedId(id))
    },
    [selectedId, requestAction],
  )

  const changeNav = useCallback(
    (next: Nav) => {
      if (next === nav) return
      requestAction(() => setNav(next))
    },
    [nav, requestAction],
  )

  /* ── knowledge overlays (compare / relation graph) ───────────────────── */

  const openCompareOverlay = useCallback(() => {
    setOverlay({ kind: 'compare' })
  }, [])

  const openRelationsOverlay = useCallback(() => {
    setOverlay(selectedId !== null ? { kind: 'relations', focusPaperId: selectedId } : { kind: 'relations' })
  }, [selectedId])

  const closeOverlay = useCallback(() => {
    setOverlay({ kind: 'none' })
    void refreshRelations()
  }, [refreshRelations])

  const handleOverlayOpenPaper = useCallback(
    (paperId: string) => {
      setOverlay({ kind: 'none' })
      setNav('library')
      requestAction(() => setSelectedId(paperId))
      void refreshRelations()
    },
    [requestAction, refreshRelations],
  )

  const saveAndContinue = useCallback(async () => {
    const prompt = unsavedPrompt
    if (prompt === null) return
    setGuardSaving(true)
    try {
      const save = saveNotesRef.current
      const ok = save === null ? true : await save()
      if (ok) {
        setNotesDirty(false)
        setUnsavedPrompt(null)
        prompt.run()
      }
    } finally {
      setGuardSaving(false)
    }
  }, [unsavedPrompt])

  const discardAndContinue = useCallback(() => {
    const prompt = unsavedPrompt
    setUnsavedPrompt(null)
    setNotesDirty(false)
    if (prompt !== null) prompt.run()
  }, [unsavedPrompt])

  /* ── notes ───────────────────────────────────────────────────────────── */

  const handleSaveNotes = useCallback(
    async (markdown: string, baseHash?: string): Promise<NotesWriteResult> => {
      const paperId = selectedId
      if (paperId === null) throw new Error(tRef.current('reader.empty.title'))
      const result = await api.saveNotes(paperId, markdown, baseHash)
      setDetail((previous) =>
        previous !== null && previous.meta.id === paperId ? { ...previous, notes: result.notes } : previous,
      )
      return result
    },
    [selectedId],
  )

  const handleReloadNotes = useCallback(async (): Promise<NotesDocument> => {
    const paperId = selectedId
    if (paperId === null) throw new Error(tRef.current('reader.empty.title'))
    const notes = await api.notes(paperId)
    setDetail((previous) => (previous !== null && previous.meta.id === paperId ? { ...previous, notes } : previous))
    return notes
  }, [selectedId])

  const handleAppendQuote = useCallback(
    async (text: string, page?: number): Promise<NotesWriteResult> => {
      const paperId = selectedId
      if (paperId === null) throw new Error(tRef.current('reader.empty.title'))
      const result = await api.appendNote(paperId, { section: 'quotes', text, page, by: 'user' })
      if (result.ok) {
        setDetail((previous) =>
          previous !== null && previous.meta.id === paperId ? { ...previous, notes: result.notes } : previous,
        )
      }
      return result
    },
    [selectedId],
  )

  /* ── annotations (in-app viewer) ─────────────────────────────────────── */

  const handleCreateAnnotation = useCallback(
    async (input: NewAnnotation): Promise<string | null> => {
      const paperId = selectedId
      if (paperId === null) return null
      try {
        const previousIds = new Set((annotationsRef.current?.items ?? []).map((item) => item.id))
        const document = await api.addAnnotation(paperId, input)
        if (selectedIdRef.current !== paperId) return null
        setAnnotationsDoc(document)
        pushToast(
          'success',
          tRef.current(input.kind === 'question' ? 'annotations.questionCreated' : 'annotations.created'),
        )
        const created = document.items.find((item) => !previousIds.has(item.id))
        if (created !== undefined) pushUndo({ kind: 'create', paperId, id: created.id })
        return created?.id ?? null
      } catch (error) {
        reportError(error, 'annotations.saveFailed')
        return null
      }
    },
    [selectedId, setAnnotationsDoc, pushToast, reportError, pushUndo],
  )

  const handleUpdateAnnotation = useCallback(
    async (annotationId: string, patch: AnnotationPatch): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      const previousItem = annotationsRef.current?.items.find((item) => item.id === annotationId)
      try {
        const document = await api.updateAnnotation(paperId, annotationId, patch)
        if (selectedIdRef.current !== paperId) return
        setAnnotationsDoc(document)
        if (previousItem !== undefined) {
          pushUndo({
            kind: 'update',
            paperId,
            id: annotationId,
            previous: { comment: previousItem.comment, color: previousItem.color, kind: previousItem.kind },
          })
        }
        pushToast('success', tRef.current('annotations.updated'))
      } catch (error) {
        reportError(error, 'annotations.saveFailed')
      }
    },
    [selectedId, setAnnotationsDoc, pushToast, reportError, pushUndo],
  )

  const handleDeleteAnnotation = useCallback(
    async (annotationId: string, options?: { undoable?: boolean }): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      const previousItem = annotationsRef.current?.items.find((item) => item.id === annotationId)
      try {
        const document = await api.deleteAnnotation(paperId, annotationId)
        if (selectedIdRef.current !== paperId) return
        setAnnotationsDoc(document)
        if (previousItem !== undefined) pushUndo({ kind: 'delete', paperId, item: previousItem })
        pushToast(
          'success',
          tRef.current(options?.undoable === true ? 'annotations.deletedUndoable' : 'annotations.deleted'),
        )
      } catch (error) {
        reportError(error, 'annotations.deleteFailed')
      }
    },
    [selectedId, setAnnotationsDoc, pushToast, reportError, pushUndo],
  )

  /** Apply the inverse of the latest annotation mutation for the current paper. */
  const handleUndo = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    if (paperId === null) return
    const stack = undoStackRef.current
    /* Defensive: drop entries left over from another paper. */
    while (stack.length > 0 && stack[stack.length - 1]?.paperId !== paperId) stack.pop()
    const entry = stack.pop()
    if (entry === undefined) {
      pushToast('info', tRef.current('annotations.nothingToUndo'))
      return
    }
    try {
      let document: AnnotationDocument
      if (entry.kind === 'create') {
        document = await api.deleteAnnotation(paperId, entry.id)
      } else if (entry.kind === 'delete') {
        document = await api.addAnnotation(paperId, {
          page: entry.item.page,
          kind: entry.item.kind,
          rects: entry.item.rects,
          quote: entry.item.quote,
          comment: entry.item.comment,
          color: entry.item.color,
          source: entry.item.source,
        })
      } else {
        document = await api.updateAnnotation(paperId, entry.id, entry.previous)
      }
      if (selectedIdRef.current === paperId) setAnnotationsDoc(document)
      pushToast('success', tRef.current('annotations.undone'))
    } catch (error) {
      if (isNotFound(error)) {
        pushToast('info', tRef.current('annotations.nothingToUndo'))
      } else {
        reportError(error, 'annotations.undoFailed')
      }
    }
  }, [selectedId, setAnnotationsDoc, pushToast, reportError])

  /* ── note cards (from AI answers / manual) ───────────────────────────── */

  const handleCreateCard = useCallback(
    async (input: NewNoteCard): Promise<string | null> => {
      const paperId = selectedId
      if (paperId === null) return null
      try {
        const previousIds = new Set((cardsRef.current?.items ?? []).map((card) => card.id))
        const document = await api.addCard(paperId, input)
        if (selectedIdRef.current !== paperId) return null
        setCardsDoc(document)
        pushToast('success', tRef.current('cards.created'))
        return document.items.find((card) => !previousIds.has(card.id))?.id ?? null
      } catch (error) {
        reportError(error, 'cards.saveFailed')
        return null
      }
    },
    [selectedId, setCardsDoc, pushToast, reportError],
  )

  const handleUpdateCard = useCallback(
    async (
      cardId: string,
      patch: Partial<Pick<NoteCard, 'title' | 'body' | 'tags' | 'pages'>>,
    ): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      try {
        const document = await api.updateCard(paperId, cardId, patch)
        if (selectedIdRef.current !== paperId) return
        setCardsDoc(document)
        pushToast('success', tRef.current('cards.updated'))
      } catch (error) {
        reportError(error, 'cards.saveFailed')
      }
    },
    [selectedId, setCardsDoc, pushToast, reportError],
  )

  const handleDeleteCard = useCallback(
    async (cardId: string): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      try {
        const document = await api.deleteCard(paperId, cardId)
        if (selectedIdRef.current !== paperId) return
        setCardsDoc(document)
        pushToast('success', tRef.current('cards.deleted'))
      } catch (error) {
        reportError(error, 'cards.deleteFailed')
      }
    },
    [selectedId, setCardsDoc, pushToast, reportError],
  )

  const handleInsertCard = useCallback(
    async (card: NoteCard): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      try {
        const result = await api.appendNote(paperId, {
          section: 'conversation',
          text: cardToNotesMarkdown(card),
          by: 'user',
        })
        if (result.ok) {
          setDetail((previous) =>
            previous !== null && previous.meta.id === paperId ? { ...previous, notes: result.notes } : previous,
          )
          pushToast('success', tRef.current('cards.inserted'))
        } else {
          pushToast('warn', tRef.current('cards.insertFailed'))
        }
      } catch (error) {
        reportError(error, 'cards.insertFailed')
      }
    },
    [selectedId, pushToast, reportError],
  )

  const handleCopyCard = useCallback(
    async (card: NoteCard): Promise<void> => {
      try {
        await navigator.clipboard.writeText(cardToNotesMarkdown(card))
        pushToast('success', tRef.current('cards.copied'))
      } catch (error) {
        reportError(error, 'cards.copyFailed')
      }
    },
    [pushToast, reportError],
  )

  /* ── metadata / reader actions ───────────────────────────────────────── */

  const handlePatchMeta = useCallback(
    async (patch: Partial<PaperMeta>, options?: { silent?: boolean }): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      try {
        const result = await api.patchPaper(paperId, patch)
        applyMeta(result.meta)
        if (options?.silent !== true) pushToast('success', tRef.current('meta.saved'))
        void loadPapers()
      } catch (error) {
        reportError(error, 'error.patch')
      }
    },
    [selectedId, applyMeta, pushToast, reportError, loadPapers],
  )

  const handleEnrich = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    if (paperId === null) return
    setBusy('enrich')
    try {
      const result = await api.enrich(paperId)
      applyMeta(result.meta)
      if (result.enrich.ok && result.enrich.changed.length > 0) {
        pushToast('success', tRef.current('meta.enrichDone', { n: result.enrich.changed.length }))
      } else {
        pushToast('info', result.enrich.message ?? tRef.current('meta.enrichNone'))
      }
      void loadPapers()
    } catch (error) {
      reportError(error, 'error.enrich')
    } finally {
      setBusy(null)
    }
  }, [selectedId, applyMeta, pushToast, reportError, loadPapers])

  const handleExportBibtex = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    if (paperId === null) return
    setBusy('bibtex')
    try {
      const text = await api.bibtex([paperId])
      const blob = new Blob([text], { type: 'text/x-bibtex;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${paperId}.bib`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      pushToast('success', tRef.current('reader.bibtexDone'))
    } catch (error) {
      reportError(error, 'error.bibtex')
    } finally {
      setBusy(null)
    }
  }, [selectedId, pushToast, reportError])

  const handleReveal = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    if (paperId === null) return
    setBusy('reveal')
    try {
      const result = await api.reveal(paperId)
      if (result.ok) pushToast('success', tRef.current('reader.revealDone'))
      else pushToast('warn', result.message ?? tRef.current('error.reveal'))
    } catch (error) {
      reportError(error, 'error.reveal')
    } finally {
      setBusy(null)
    }
  }, [selectedId, pushToast, reportError])

  const handleDelete = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    if (paperId === null) return
    setBusy('delete')
    try {
      await api.deletePaper(paperId)
      pushToast('success', tRef.current('reader.delete.done'))
      setSelectedId(null)
      setDetail(null)
      setExtractedText(null)
      setTextError(null)
      setNotesDirty(false)
      await loadPapers()
      void loadStatus(true)
    } catch (error) {
      reportError(error, 'error.delete')
    } finally {
      setBusy(null)
    }
  }, [selectedId, pushToast, reportError, loadPapers, loadStatus])

  const handleDownloadPdf = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    const current = detail
    if (paperId === null || current === null) return
    const pdfName = current.meta.pdfFile !== null ? current.meta.pdfFile : 'paper.pdf'
    const relPath = `${current.dirRelPath}/${pdfName}`
    setBusy('download')
    try {
      const result = await api.downloadEvicted(relPath)
      if (result.ok) {
        pushToast('success', tRef.current('sync.evicted.downloaded'))
        setDetailNonce((value) => value + 1)
        void loadPapers()
      } else {
        pushToast('warn', result.message ?? tRef.current('sync.evicted.failed'))
      }
    } catch (error) {
      reportError(error, 'sync.evicted.failed')
    } finally {
      setBusy(null)
    }
  }, [selectedId, detail, pushToast, reportError, loadPapers])

  /* ── lazy text extraction ────────────────────────────────────────────── */

  const requestText = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    if (paperId === null) return
    setTextLoading(true)
    setTextError(null)
    try {
      const result = await api.text(paperId)
      setExtractedText(result.text)
      setDetail((previous) =>
        previous !== null && previous.meta.id === paperId ? { ...previous, text: result.text } : previous,
      )
    } catch (error) {
      setTextError(errorText(error) || tRef.current('error.loadText'))
    } finally {
      setTextLoading(false)
    }
  }, [selectedId])

  /* ── in-panel agent assist ───────────────────────────────────────────── */

  /** Make sure the AI thread controller is attached to this paper before running. */
  const ensureAiPaper = useCallback(
    async (paperId: string): Promise<boolean> => {
      const snapshot = ai.getSnapshot()
      if (snapshot.paperId === paperId && snapshot.status !== 'attaching') return true
      const workspacePath = status?.settings.libraryPath ?? ''
      if (workspacePath === '') {
        pushToast('error', tRef.current('ai.attachFailed'))
        return false
      }
      try {
        const title = detail !== null && detail.meta.id === paperId ? detail.meta.title : ''
        await ai.openPaper(paperId, { workspacePath, paperTitle: title !== '' ? title : paperId })
        return true
      } catch (error) {
        reportError(error, 'ai.attachFailed')
        return false
      }
    },
    [ai, status, detail, pushToast, reportError],
  )

  /**
   * Ask the host for the prepared assist prompt, then stream it through the
   * in-panel AI thread. No session navigation / no shell jump.
   */
  const launchAssist = useCallback(
    async (request: {
      task: AssistTask
      extra?: string
      context?: { quote?: string; page?: number; question?: string }
    }): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      setAssistBusy(request.task)
      try {
        const payload: AssistPayload = await api.assist(paperId, request.task, request.extra, request.context)
        if (selectedIdRef.current !== paperId) return
        if (!(await ensureAiPaper(paperId))) return
        const result = await ai.run(payload.prompt)
        if (!result.ok) {
          pushToast('error', result.error !== undefined && result.error !== '' ? result.error : tRef.current('ai.error'))
        }
      } catch (error) {
        reportError(error, 'assist.failed')
      } finally {
        setAssistBusy(null)
      }
    },
    [selectedId, ai, ensureAiPaper, pushToast, reportError],
  )

  const handleAssist = useCallback(
    async (task: AssistTask, extra?: string): Promise<void> => {
      await launchAssist({ task, extra })
    },
    [launchAssist],
  )

  /** Viewer/rail "ask about this passage" (annotation-aware assist). */
  const handleAskAboutSelection = useCallback(
    async (payload: { quote: string; page: number; question: string; rects?: AnnotationRect[] }): Promise<void> => {
      // Keep the question as an annotation (visible in the rail, readable by the
      // agent through paper_annotations), then hand the selection to a session.
      if (payload.rects !== undefined && payload.rects.length > 0) {
        await handleCreateAnnotation({
          page: payload.page,
          kind: 'question',
          rects: payload.rects,
          quote: payload.quote,
          comment: payload.question,
        })
      }
      await launchAssist({
        task: 'quote',
        context: { quote: payload.quote, page: payload.page, question: payload.question },
      })
    },
    [handleCreateAnnotation, launchAssist],
  )

  /** Follow-up / retry inside the AI panel: send raw text into the same session. */
  const handleAiAsk = useCallback(
    async (question: string): Promise<boolean> => {
      const paperId = selectedId
      if (paperId === null) return false
      const text = question.trim()
      if (text === '') return false
      if (!(await ensureAiPaper(paperId))) return false
      try {
        const emptyThread = ai.getSnapshot().rows.length === 0
        const title = detail?.meta.title ?? paperId
        const prompt = emptyThread ? `当前论文：《${title}》（id: ${paperId}）。\n\n${text}` : text
        const result = await ai.run(prompt)
        if (!result.ok) {
          pushToast('error', result.error !== undefined && result.error !== '' ? result.error : tRef.current('ai.error'))
        }
        return result.ok
      } catch (error) {
        reportError(error, 'ai.error')
        return false
      }
    },
    [selectedId, ai, ensureAiPaper, pushToast, reportError],
  )

  /** Start a clean AI thread for the selected paper (drops a stale/archived one). */
  const handleAiReset = useCallback(async (): Promise<void> => {
    const paperId = selectedId
    ai.resetThread(paperId ?? undefined)
    if (paperId === null) return
    if (await ensureAiPaper(paperId)) {
      pushToast('info', tRef.current('ai.newThreadDone'))
    }
  }, [ai, selectedId, ensureAiPaper, pushToast])

  const handleAiStop = useCallback(async (): Promise<void> => {
    try {
      await ai.stop()
    } catch (error) {
      reportError(error, 'ai.error')
    }
  }, [ai, reportError])

  const handleAiSaveToNotes = useCallback(
    async (text: string): Promise<void> => {
      const paperId = selectedId
      if (paperId === null) return
      const trimmed = text.trim()
      if (trimmed === '') {
        pushToast('info', tRef.current('ai.nothingToSave'))
        return
      }
      try {
        const result = await api.appendNote(paperId, { section: 'summary', text: trimmed, by: 'user' })
        if (result.ok) {
          setDetail((previous) =>
            previous !== null && previous.meta.id === paperId ? { ...previous, notes: result.notes } : previous,
          )
          pushToast('success', tRef.current('ai.saved'))
        } else {
          pushToast('warn', tRef.current('ai.saveFailed'))
        }
      } catch (error) {
        reportError(error, 'ai.saveFailed')
      }
    },
    [selectedId, pushToast, reportError],
  )

  const handleAiCopy = useCallback(
    async (text: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(text)
        pushToast('success', tRef.current('ai.copied'))
      } catch (error) {
        reportError(error, 'ai.copyFailed')
      }
    },
    [pushToast, reportError],
  )

  const handleAiOpenInSession = useCallback(async (): Promise<void> => {
    const sessionId = ai.getSnapshot().sessionId
    if (sessionId === null || !openSessionInShell(ctx, sessionId)) {
      pushToast('warn', tRef.current('ai.openInSessionFailed'))
    }
  }, [ai, ctx, pushToast])

  /* ── imports ─────────────────────────────────────────────────────────── */

  const openImportPicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const importFiles = useCallback(
    async (files: File[]): Promise<void> => {
      const pdfs = files.filter(
        (file) => file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf',
      )
      if (pdfs.length === 0) {
        pushToast('warn', tRef.current('import.notPdf'))
        return
      }
      const enrich = status?.settings.enrich ?? true
      setImporting(true)
      let imported = 0
      let failed = 0
      let lastId: string | null = null
      let lastTitle = ''
      let lastDuplicated = false
      const importedIds: string[] = []
      for (const file of pdfs) {
        try {
          const result = await api.importUpload(file, enrich)
          imported += 1
          lastId = result.id
          lastTitle = result.meta.title
          lastDuplicated = result.duplicated
          if (!result.duplicated) importedIds.push(result.id)
        } catch (error) {
          failed += 1
          reportError(error, 'import.failed')
        }
      }
      setImporting(false)
      if (lastId !== null) {
        const targetId: string = lastId
        await loadPapers()
        setNav('library')
        requestAction(() => setSelectedId(targetId))
        if (pdfs.length === 1) {
          pushToast('success', lastDuplicated ? tRef.current('import.duplicated') : tRef.current('import.done', { title: lastTitle }))
        } else if (failed === 0) {
          pushToast('success', tRef.current('import.multiple', { n: imported }))
        } else {
          pushToast('warn', tRef.current('import.partial', { n: imported, failed }))
        }
        void loadStatus(true)
        maybeSyncCitations(importedIds)
      }
    },
    [status, loadPapers, pushToast, reportError, loadStatus, requestAction, maybeSyncCitations],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragOver(false)
      if (!configured) return
      void importFiles(Array.from(event.dataTransfer.files))
    },
    [configured, importFiles],
  )

  /* ── sync ────────────────────────────────────────────────────────────── */

  const loadSync = useCallback(async (): Promise<void> => {
    if (!configured) {
      setSync(null)
      return
    }
    setSyncLoading(true)
    setSyncError(null)
    try {
      setSync(await api.sync())
    } catch (error) {
      setSyncError(errorText(error) || tRef.current('error.loadSync'))
    } finally {
      setSyncLoading(false)
    }
  }, [configured, activeLibraryPath])

  useEffect(() => {
    if (nav === 'sync' || nav === 'settings') void loadSync()
  }, [nav, loadSync])

  const handleScan = useCallback(async (): Promise<void> => {
    setSyncBusy('scan')
    try {
      const result = await api.scan()
      pushToast(
        'success',
        tRef.current('sync.scanDone', {
          added: result.delta.added.length,
          changed: result.delta.changed.length,
          removed: result.delta.removed.length,
        }),
      )
      await loadSync()
      await loadPapers()
      void loadStatus(true)
    } catch (error) {
      reportError(error, 'sync.scanFailed')
    } finally {
      setSyncBusy(null)
    }
  }, [pushToast, reportError, loadSync, loadPapers, loadStatus])

  const handleResolveConflict = useCallback(
    async (relPath: string, action: 'use-conflict' | 'discard-conflict'): Promise<void> => {
      setSyncBusy(`conflict:${relPath}`)
      try {
        const result = await api.resolveConflict(relPath, action)
        if (result.ok) {
          pushToast('success', tRef.current('sync.conflicts.done'))
          setSync(result.sync)
          await loadPapers()
          setDetailNonce((value) => value + 1)
        } else {
          pushToast('warn', result.message ?? tRef.current('sync.conflicts.failed'))
        }
      } catch (error) {
        reportError(error, 'sync.conflicts.failed')
      } finally {
        setSyncBusy(null)
      }
    },
    [pushToast, reportError, loadPapers],
  )

  const handleSyncDownload = useCallback(
    async (relPath: string): Promise<void> => {
      setSyncBusy(`download:${relPath}`)
      try {
        const result = await api.downloadEvicted(relPath)
        if (result.ok) {
          pushToast('success', tRef.current('sync.evicted.downloaded'))
          await loadSync()
          await loadPapers()
          setDetailNonce((value) => value + 1)
        } else {
          pushToast('warn', result.message ?? tRef.current('sync.evicted.failed'))
        }
      } catch (error) {
        reportError(error, 'sync.evicted.failed')
      } finally {
        setSyncBusy(null)
      }
    },
    [pushToast, reportError, loadSync, loadPapers],
  )

  const openFolderPath = useCallback(
    async (path: string, fallbackPaperId: string | null): Promise<void> => {
      if (path !== '') {
        const opened = await openHostPath(ctx, path)
        if (opened) return
      }
      if (fallbackPaperId !== null) {
        try {
          const result = await api.reveal(fallbackPaperId)
          if (result.ok) return
        } catch {
          // Fall through to the toast below.
        }
      }
      pushToast('warn', tRef.current('error.openFolder'))
    },
    [ctx, pushToast],
  )

  const handleSyncOpenFolder = useCallback(async (): Promise<void> => {
    setSyncBusy('reveal')
    try {
      const root = sync?.root ?? status?.settings.libraryPath ?? ''
      await openFolderPath(root, selectedId)
    } finally {
      setSyncBusy(null)
    }
  }, [sync, status, selectedId, openFolderPath])

  /* ── settings ────────────────────────────────────────────────────────── */

  const loadSettings = useCallback(async (): Promise<void> => {
    if (!configured) return
    setSettingsLoading(true)
    setSettingsError(null)
    try {
      setSettings(await api.settings())
    } catch (error) {
      setSettingsError(errorText(error) || tRef.current('error.loadSettings'))
    } finally {
      setSettingsLoading(false)
    }
  }, [configured, activeLibraryPath])

  useEffect(() => {
    if (nav === 'settings') void loadSettings()
  }, [nav, loadSettings])

  const handleSaveSettings = useCallback(
    async (patch: SettingsPatch): Promise<void> => {
      setSettingsBusy('save')
      const previousPath = status?.settings.libraryPath ?? ''
      try {
        const next = await api.saveSettings(patch)
        setSettings(next)
        onLangChange(next.effective.language)
        pushToast('success', tRef.current('settings.saved'))
        if (previousPath !== next.effective.libraryPath) {
          setPapers([])
          setSelectedId(null)
          setDetail(null)
          setExtractedText(null)
          setTextError(null)
        }
        await loadStatus(true)
      } catch (error) {
        reportError(error, 'error.saveSettings')
        throw error
      } finally {
        setSettingsBusy(null)
      }
    },
    [status, onLangChange, pushToast, reportError, loadStatus],
  )

  const handleScanInbox = useCallback(async (): Promise<void> => {
    setSettingsBusy('inbox')
    try {
      const result = await api.importInbox()
      if (result.imported.length === 0) {
        pushToast('info', tRef.current('settings.inboxEmpty'))
      } else {
        pushToast('success', tRef.current('settings.inboxDone', { n: result.imported.length }))
        await loadPapers()
        void loadStatus(true)
        maybeSyncCitations(result.imported)
        const first = result.imported[0]
        if (first !== undefined) requestAction(() => setSelectedId(first))
      }
    } catch (error) {
      reportError(error, 'settings.inboxFailed')
    } finally {
      setSettingsBusy(null)
    }
  }, [pushToast, reportError, loadPapers, loadStatus, requestAction, maybeSyncCitations])

  const handleSettingsOpenFolder = useCallback(async (): Promise<void> => {
    setSettingsBusy('reveal')
    try {
      const path = settings?.effective.libraryPath ?? status?.settings.libraryPath ?? ''
      await openFolderPath(path, selectedId)
    } finally {
      setSettingsBusy(null)
    }
  }, [settings, status, selectedId, openFolderPath])

  const registerNotesSave = useCallback((save: (() => Promise<boolean>) | null) => {
    saveNotesRef.current = save
  }, [])

  const setLanguage = useCallback(
    async (next: Lang): Promise<void> => {
      if (next === lang) return
      try {
        const result = await api.saveSettings({ language: next })
        setSettings(result)
        onLangChange(result.effective.language)
      } catch (error) {
        reportError(error, 'error.saveSettings')
      }
    },
    [lang, onLangChange, reportError],
  )

  const toggleLanguage = useCallback((): void => {
    void setLanguage(lang === 'zh' ? 'en' : 'zh')
  }, [lang, setLanguage])

  const handlePickDirectory = useCallback(async (): Promise<string | null> => {
    try {
      return await pickLibraryDirectory(ctx)
    } catch (error) {
      reportError(error, 'error.openFolder')
      return null
    }
  }, [ctx, reportError])

  /* ── first-run setup ─────────────────────────────────────────────────── */

  const handleSetupChoose = useCallback(async (): Promise<void> => {
    try {
      const picked = await pickLibraryDirectory(ctx)
      if (picked !== null) {
        setSetupPath(picked)
        setSetupError(null)
      }
    } catch (error) {
      const message = errorText(error) || tRef.current('error.openFolder')
      setSetupError(message)
      pushToast('error', message)
    }
  }, [ctx, pushToast])

  const handleSetupStart = useCallback(async (): Promise<void> => {
    const path = setupPath.trim()
    if (path === '') {
      setSetupError(tRef.current('settings.pathRequired'))
      return
    }
    setSetupBusy(true)
    setSetupError(null)
    try {
      const next = await api.saveSettings({ libraryPath: path })
      setSettings(next)
      onLangChange(next.effective.language)
      const refreshed = await loadStatus(true)
      if (refreshed === null) {
        setSetupError(tRef.current('error.loadStatus'))
      } else if (!refreshed.libraryExists) {
        setSetupPath(refreshed.settings.libraryPath !== '' ? refreshed.settings.libraryPath : path)
        pushToast('warn', tRef.current('setup.stillMissing'))
      }
    } catch (error) {
      const message = errorText(error) || tRef.current('setup.saveFailed')
      setSetupError(message)
      pushToast('error', message)
    } finally {
      setSetupBusy(false)
    }
  }, [setupPath, onLangChange, loadStatus, pushToast])

  /* ── render ──────────────────────────────────────────────────────────── */

  const hasFilters = query !== '' || statusFilter !== 'all' || tagFilter !== ''

  const dropProps = {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!configured) return
      event.preventDefault()
      setDragOver(true)
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget
      if (next instanceof Node && event.currentTarget.contains(next)) return
      setDragOver(false)
    },
    onDrop,
  }

  if (booting && status === null) {
    return (
      <div className="pd-root">
        <div className="pd-loading-block">
          <Spinner size={16} label={t('app.loading')} />
          <span>{t('app.loading')}</span>
        </div>
      </div>
    )
  }

  if (status === null) {
    return (
      <div className="pd-root">
        <div className="pd-setup-wrap">
          <div className="pd-setup" role="alert">
            <div className="pd-setup-head">
              <span className="pd-setup-mark">
                <IconBook size={22} />
              </span>
              <h1 className="pd-setup-title">{t('app.title')}</h1>
            </div>
            <p className="pd-setup-desc">{t('app.connectError')}</p>
            {bootError !== null ? <p className="pd-setup-err">{bootError}</p> : null}
            <div className="pd-setup-actions">
              <Button variant="primary" onClick={() => void loadStatus()}>
                {t('app.retry')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="pd-root">
        <div className="pd-setup-wrap">
          <div className="pd-setup">
            <div className="pd-setup-head">
              <span className="pd-setup-mark">
                <IconBook size={22} />
              </span>
              <div>
                <h1 className="pd-setup-title">{t('setup.title')}</h1>
              </div>
              <div className="pd-setup-langs">
                <Button size="sm" variant={lang === 'zh' ? 'default' : 'ghost'} onClick={() => void setLanguage('zh')}>
                  {t('app.lang.zh')}
                </Button>
                <Button size="sm" variant={lang === 'en' ? 'default' : 'ghost'} onClick={() => void setLanguage('en')}>
                  {t('app.lang.en')}
                </Button>
              </div>
            </div>
            <p className="pd-setup-desc">{t('setup.desc')}</p>
            {status.configured && !status.libraryExists ? (
              <p className="pd-setup-desc">{t('setup.missing', { path: status.settings.libraryPath })}</p>
            ) : null}
            {status.problem !== undefined && status.problem !== '' ? (
              <p className="pd-setup-err" role="alert">
                {status.problem}
              </p>
            ) : null}
            <div className="pd-field">
              <label className="pd-field-label" htmlFor="pd-setup-path">
                {t('setup.path')}
              </label>
              <div className="pd-path-row">
                <input
                  id="pd-setup-path"
                  className="pd-input"
                  value={setupPath}
                  placeholder={t('settings.pathPlaceholder')}
                  aria-label={t('setup.path')}
                  onChange={(event) => setSetupPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleSetupStart()
                    }
                  }}
                />
                <Button loading={setupBusy} onClick={() => void handleSetupChoose()}>
                  {t('setup.choose')}
                </Button>
              </div>
            </div>
            <p className="pd-field-hint">{t('setup.pathHint')}</p>
            <p className="pd-field-hint">{t('setup.defaultHint', { path: defaultPath })}</p>
            {setupError !== null ? (
              <p className="pd-setup-err" role="alert">
                {setupError}
              </p>
            ) : null}
            <div className="pd-setup-actions">
              <Button
                variant="primary"
                loading={setupBusy}
                disabled={setupPath.trim() === ''}
                onClick={() => void handleSetupStart()}
              >
                {setupBusy ? t('setup.saving') : status.libraryExists ? t('setup.start') : t('setup.create')}
              </Button>
              <Button onClick={() => setSetupPath(defaultPath)} disabled={setupBusy}>
                {t('setup.default')}
              </Button>
            </div>
            <div className="pd-setup-note">
              <IconSync size={15} />
              <span>{t('setup.syncNote')}</span>
            </div>
          </div>
        </div>
        <Toast toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  return (
    <div className="pd-root" {...dropProps}>
      <input
        ref={fileInputRef}
        type="file"
        className="pd-sr"
        accept="application/pdf,.pdf"
        multiple
        tabIndex={-1}
        aria-label={t('import.aria')}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void importFiles(files)
        }}
      />

      <header className="pd-topbar">
        <div className="pd-brand">
          <span className="pd-brand-mark">
            <IconBook size={18} />
          </span>
          <div className="pd-brand-text">
            <h1 className="pd-brand-title">{t('app.title')}</h1>
            <span className="pd-brand-sub">{t('app.subtitle')}</span>
          </div>
        </div>

        <div className="pd-search">
          <span className="pd-search-icon">
            <IconSearch />
          </span>
          <input
            className="pd-input"
            value={searchInput}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          {searchInput !== '' ? (
            <button
              type="button"
              className="pd-search-clear"
              aria-label={t('search.clear')}
              title={t('search.clear')}
              onClick={() => setSearchInput('')}
            >
              <IconClose size={12} />
            </button>
          ) : null}
        </div>

        <div className="pd-top-actions">
          <Button
            variant="primary"
            icon={<IconImport />}
            loading={importing}
            onClick={openImportPicker}
            title={t('import.hint')}
          >
            {importing ? t('import.importing') : t('import.button')}
          </Button>
          <Button
            variant={nav === 'library' ? 'default' : 'ghost'}
            icon={<IconBook />}
            onClick={() => changeNav('library')}
            title={t('app.nav.library')}
          >
            {t('app.nav.library')}
          </Button>
          <Button
            variant={nav === 'sync' ? 'default' : 'ghost'}
            icon={<IconSync />}
            onClick={() => changeNav('sync')}
            title={t('app.nav.sync')}
          >
            {t('app.nav.sync')}
          </Button>
          <Button
            variant={nav === 'settings' ? 'default' : 'ghost'}
            icon={<IconGear />}
            onClick={() => changeNav('settings')}
            title={t('app.nav.settings')}
          >
            {t('app.nav.settings')}
          </Button>
          <Button variant="ghost" icon={<IconLang />} onClick={toggleLanguage} title={t('aria.language')}>
            {lang === 'zh' ? t('app.lang.en') : t('app.lang.zh')}
          </Button>
        </div>
      </header>

      <div className="pd-body">
        {nav === 'library' ? (
          <>
            <LibraryView
              papers={papers}
              count={count}
              loading={listLoading}
              error={listError}
              selectedId={selectedId}
              statusFilter={statusFilter}
              tagFilter={tagFilter}
              tags={tags}
              sort={sort}
              hasFilters={hasFilters}
              importing={importing}
              onStatusFilter={setStatusFilter}
              onTagFilter={setTagFilter}
              onSort={setSort}
              onSelect={selectPaper}
              onImport={openImportPicker}
              onRetry={() => void loadPapers()}
              onCompare={openCompareOverlay}
              onRelations={openRelationsOverlay}
            />
            <ReaderView
              paperId={selectedId}
              detail={detail}
              loading={detailLoading}
              error={detailError}
              pdfUrl={selectedId !== null ? api.pdfUrl(selectedId) : ''}
              busy={busy}
              text={extractedText}
              textLoading={textLoading}
              textError={textError}
              notesDirty={notesDirty}
              assistBusy={assistBusy}
              annotations={annotations}
              annotationsLoading={annotationsLoading}
              onRequestText={() => void requestText()}
              onDirtyChange={setNotesDirty}
              registerNotesSave={registerNotesSave}
              onSaveNotes={handleSaveNotes}
              onReloadNotes={handleReloadNotes}
              onAppendQuote={handleAppendQuote}
              onPatchMeta={handlePatchMeta}
              onEnrich={handleEnrich}
              onExportBibtex={handleExportBibtex}
              onReveal={handleReveal}
              onDelete={handleDelete}
              onDownloadPdf={handleDownloadPdf}
              onAssist={handleAssist}
              onCreateAnnotation={handleCreateAnnotation}
              onUpdateAnnotation={handleUpdateAnnotation}
              onDeleteAnnotation={handleDeleteAnnotation}
              onUndo={handleUndo}
              onAskAboutSelection={handleAskAboutSelection}
              ai={ai}
              onAiAsk={handleAiAsk}
              onAiReset={handleAiReset}
              onAiStop={handleAiStop}
              onAiSaveToNotes={handleAiSaveToNotes}
              onAiCopy={handleAiCopy}
              onAiOpenInSession={handleAiOpenInSession}
              cards={cards}
              cardsLoading={cardsLoading}
              relationCount={relationCount}
              onOpenRelations={openRelationsOverlay}
              onCreateCard={handleCreateCard}
              onUpdateCard={handleUpdateCard}
              onDeleteCard={handleDeleteCard}
              onInsertCard={handleInsertCard}
              onCopyCard={handleCopyCard}
              onToast={pushToast}
              onRetry={() => setDetailNonce((value) => value + 1)}
              onImport={openImportPicker}
            />
          </>
        ) : nav === 'sync' ? (
          <SyncView
            status={sync}
            loading={syncLoading}
            error={syncError}
            busy={syncBusy}
            onRefresh={() => void loadSync()}
            onScan={handleScan}
            onOpenFolder={handleSyncOpenFolder}
            onResolve={handleResolveConflict}
            onDownload={handleSyncDownload}
            onToast={pushToast}
          />
        ) : (
          <SettingsView
            settings={settings}
            status={status}
            sync={sync}
            loading={settingsLoading}
            error={settingsError}
            busy={settingsBusy}
            onPickDirectory={handlePickDirectory}
            onSave={handleSaveSettings}
            onScanInbox={handleScanInbox}
            onOpenFolder={handleSettingsOpenFolder}
            onReload={() => void loadSettings()}
          />
        )}
      </div>

      {dragOver ? (
        <div className="pd-drop">
          <IconImport size={18} />
          <span>{t('drop.hint')}</span>
        </div>
      ) : null}

      <Modal
        open={unsavedPrompt !== null}
        title={t('notes.unsaved.title')}
        description={t('notes.unsaved.desc')}
        onClose={() => setUnsavedPrompt(null)}
        footer={
          <>
            <Button onClick={() => setUnsavedPrompt(null)}>{t('notes.unsaved.stay')}</Button>
            <Button onClick={discardAndContinue}>{t('notes.unsaved.discard')}</Button>
            <Button variant="primary" loading={guardSaving} onClick={() => void saveAndContinue()}>
              {t('notes.unsaved.save')}
            </Button>
          </>
        }
      />

      <CompareView
        open={overlay.kind === 'compare'}
        ctx={ctx}
        lang={lang}
        onClose={closeOverlay}
        onOpenPaper={handleOverlayOpenPaper}
      />
      <RelationsGraph
        open={overlay.kind === 'relations'}
        ctx={ctx}
        focusPaperId={overlay.kind === 'relations' ? overlay.focusPaperId ?? null : null}
        lang={lang}
        onClose={closeOverlay}
        onOpenPaper={handleOverlayOpenPaper}
      />

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
