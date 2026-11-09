/**
 * Reader pane: header (title/authors/venue/year, status, rating, tags, actions),
 * tabs (阅读 / 文本 / 笔记 / 信息), the in-app pdf.js viewer with its annotation
 * rail, lazy extracted text, the notes editor, the metadata editor and the
 * agent-assist bar. Presentational only — all data and API calls come from App.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AnnotationDocument,
  ChatsDocument,
  AnnotationItem,
  AnnotationKind,
  AnnotationPatch,
  AnnotationRect,
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
} from '../src/types.js'
import {
  IconBook,
  IconClose,
  IconDownload,
  IconEdit,
  IconFolder,
  IconNote,
  IconRefresh,
  IconSpark,
  IconTrash,
} from './icons.js'
import { AiPanel, collectCitedPages } from './AiPanel.js'
import { ChatBar } from './ChatBar.js'
import type { ChatBarLabels } from './ChatBar.js'
import type { AiPanelLabels } from './AiPanel.js'
import type { AiRow, AiThreadController } from './aiSession.js'
import { annotationKindLabel, formatNumber, statusLabel, useLang, useT } from './i18n.js'
import { CardEditor, CardsPanel, suggestCardTitle } from './CardsPanel.js'
import type { CardDraft } from './CardsPanel.js'
import { MetaEditor } from './MetaEditor.js'
import { NotesEditor } from './NotesEditor.js'
import { PdfViewer } from './PdfViewer.js'
import type { PdfSelectionPayload, PdfViewerLabels } from './PdfViewer.js'
import { Button, EmptyState, IconButton, Menu, Modal, Rating, Spinner, Tabs, Textarea } from './ui.js'

type ToastKind = 'info' | 'success' | 'error' | 'warn'
type ToastPush = (kind: ToastKind, message: string) => void

export type ReaderBusy = 'enrich' | 'bibtex' | 'reveal' | 'delete' | 'download'

type ReaderTab = 'read' | 'text' | 'notes' | 'info'

type DrawerTab = 'annotations' | 'ai'

interface DrawerState {
  open: boolean
  tab: DrawerTab
}

function drawerButtonPressed(drawer: DrawerState, tab: DrawerTab): boolean {
  return drawer.open && drawer.tab === tab
}

const DRAWER_WIDTH_KEY = 'paperdesk:drawer-width'
const DEFAULT_DRAWER_WIDTH = 360

function readDrawerWidth(): number {
  try {
    const raw = localStorage.getItem(DRAWER_WIDTH_KEY)
    const value = raw === null ? Number.NaN : Number.parseInt(raw, 10)
    return Number.isFinite(value) ? Math.min(680, Math.max(280, value)) : DEFAULT_DRAWER_WIDTH
  } catch {
    return DEFAULT_DRAWER_WIDTH
  }
}

const READER_PAGE_PREFIX = 'paperdesk:reader-page:'

function readReaderPage(paperId: string): number | null {
  try {
    const raw = localStorage.getItem(READER_PAGE_PREFIX + paperId)
    const page = raw === null ? Number.NaN : Number.parseInt(raw, 10)
    return Number.isFinite(page) && page > 0 ? page : null
  } catch {
    return null
  }
}

function writeReaderPage(paperId: string, page: number | null): void {
  try {
    if (page === null || page <= 0) localStorage.removeItem(READER_PAGE_PREFIX + paperId)
    else localStorage.setItem(READER_PAGE_PREFIX + paperId, String(page))
  } catch {
    // Reading-position restore is a convenience only.
  }
}

interface CardEditorState {
  mode: 'create' | 'edit'
  cardId: string | null
  source: 'ai' | 'user'
  initial: CardDraft
}

const READER_TABS: readonly ReaderTab[] = ['read', 'text', 'notes', 'info']
const ASSIST_TASKS: readonly AssistTask[] = ['summary', 'method', 'critique', 'related']

function tabLabel(t: (key: string) => string, tab: ReaderTab): string {
  switch (tab) {
    case 'read':
      return t('reader.tab.read')
    case 'text':
      return t('reader.tab.text')
    case 'notes':
      return t('reader.tab.notes')
    default:
      return t('reader.tab.info')
  }
}

export interface ReaderViewProps {
  paperId: string | null
  detail: PaperDetail | null
  loading: boolean
  error: string | null
  pdfUrl: string
  busy: ReaderBusy | null
  text: ExtractedText | null
  textLoading: boolean
  textError: string | null
  notesDirty: boolean
  assistBusy: AssistTask | null
  annotations: AnnotationDocument | null
  annotationsLoading: boolean
  onRequestText: () => void
  onDirtyChange: (dirty: boolean) => void
  registerNotesSave: (save: (() => Promise<boolean>) | null) => void
  onSaveNotes: (markdown: string, baseHash?: string) => Promise<NotesWriteResult>
  onReloadNotes: () => Promise<NotesDocument>
  onAppendQuote: (text: string, page?: number) => Promise<NotesWriteResult>
  onPatchMeta: (patch: Partial<PaperMeta>, opts?: { silent?: boolean }) => Promise<void>
  onEnrich: () => Promise<void>
  onExportBibtex: () => Promise<void>
  onReveal: () => Promise<void>
  onDelete: () => Promise<void>
  onDownloadPdf: () => Promise<void>
  onAssist: (task: AssistTask, extra?: string) => Promise<void>
  onCreateAnnotation: (input: NewAnnotation) => Promise<string | null>
  onUpdateAnnotation: (annotationId: string, patch: AnnotationPatch) => Promise<void>
  onDeleteAnnotation: (annotationId: string, options?: { undoable?: boolean }) => Promise<void>
  onUndo: () => Promise<void>
  onAskAboutSelection: (payload: { quote: string; page: number; question: string; rects: AnnotationRect[] }) => Promise<void>
  ai: AiThreadController
  onAiAsk: (question: string) => Promise<boolean>
  onAiReset: () => Promise<void>
  chats: ChatsDocument | null
  activeChatId: string | null
  /** Thread key the AI panel may render; anything else is treated as empty. */
  aiThreadKey: string | null
  onSelectChat: (chatId: string) => void
  onCreateChat: () => void
  onRenameChat: (chatId: string, title: string) => void
  onRemoveChat: (chatId: string) => void
  onAiStop: () => Promise<void>
  onAiSaveToNotes: (text: string) => Promise<void>
  onAiCopy: (text: string) => Promise<void>
  onAiOpenInSession: () => Promise<void>
  cards: CardsDocument | null
  cardsLoading: boolean
  relationCount: number
  onOpenRelations: () => void
  onCreateCard: (input: NewNoteCard) => Promise<string | null>
  onUpdateCard: (cardId: string, patch: Partial<Pick<NoteCard, 'title' | 'body' | 'tags' | 'pages'>>) => Promise<void>
  onDeleteCard: (cardId: string) => Promise<void>
  onInsertCard: (card: NoteCard) => Promise<void>
  onCopyCard: (card: NoteCard) => Promise<void>
  onToast: ToastPush
  onRetry: () => void
  onImport: () => void
}

/* ── annotation rail ───────────────────────────────────────────────────── */

interface AnnotationRailProps {
  items: readonly AnnotationItem[]
  loading: boolean
  activeId: string | null
  editRequestId: string | null
  currentPage: number | null
  onLocate: (item: AnnotationItem) => void
  onUpdate: (annotationId: string, patch: AnnotationPatch) => Promise<void>
  onRequestDelete: (item: AnnotationItem) => void
  onAsk: (item: AnnotationItem) => void
}

function AnnotationRail(props: AnnotationRailProps) {
  const t = useT()
  const { items, loading, activeId, editRequestId, currentPage, onLocate, onUpdate, onRequestDelete, onAsk } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const handledEditRef = useRef<string | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  /* A freshly created `note` annotation asks the rail to open its editor. */
  useEffect(() => {
    if (editRequestId === null || handledEditRef.current === editRequestId) return
    const item = items.find((candidate) => candidate.id === editRequestId)
    if (item === undefined) return
    handledEditRef.current = editRequestId
    setEditingId(item.id)
    setDraft(item.comment)
  }, [editRequestId, items])

  /* Keep the row of the annotation focused in the viewer visible. */
  useEffect(() => {
    if (activeId === null) return
    const list = listRef.current
    if (list === null) return
    const row = list.querySelector<HTMLElement>(`[data-annotation-id="${activeId}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const sorted = useMemo(
    () => [...items].sort((left, right) => left.page - right.page || left.createdAt.localeCompare(right.createdAt)),
    [items],
  )

  const counts = useMemo(() => {
    const result = { highlight: 0, underline: 0, note: 0, question: 0 }
    for (const item of items) result[item.kind] += 1
    return result
  }, [items])

  const startEdit = (item: AnnotationItem): void => {
    setEditingId(item.id)
    setDraft(item.comment)
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setDraft('')
  }

  const saveEdit = async (annotationId: string): Promise<void> => {
    setSavingId(annotationId)
    try {
      await onUpdate(annotationId, { comment: draft })
      setEditingId(null)
      setDraft('')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="pd-annot-pane">
      {items.length > 0 ? (
        <div className="pd-annot-summary">
          <span>
            {t('annotations.summary', {
              highlights: counts.highlight,
              underlines: counts.underline,
              notes: counts.note,
              questions: counts.question,
            })}
          </span>
          {currentPage !== null ? (
            <span className="pd-annot-page">{t('annotations.pageShort', { n: currentPage })}</span>
          ) : null}
        </div>
      ) : null}

      <div className="pd-annot-scroll">
        {loading ? (
          <div className="pd-loading-block">
            <Spinner size={12} label={t('annotations.loading')} />
            <span>{t('annotations.loading')}</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="pd-annot-empty">
            <span className="pd-empty-title">{t('annotations.empty')}</span>
            <span className="pd-empty-desc">{t('annotations.emptyHint')}</span>
          </div>
        ) : (
          <ul className="pd-annot-list" ref={listRef}>
            {sorted.map((item) => (
              <li
                key={item.id}
                className="pd-annot-item"
                data-active={item.id === activeId ? 'true' : 'false'}
                data-annotation-id={item.id}
              >
                <button type="button" className="pd-annot-locate" onClick={() => onLocate(item)}>
                  <span className="pd-annot-line">
                    <span className="pd-annot-swatch" data-color={item.color} aria-hidden="true" />
                    <span className="pd-annot-kind">{annotationKindLabel(t, item.kind)}</span>
                    <span className="pd-annot-page">{t('annotations.pageShort', { n: item.page })}</span>
                  </span>
                  <span className="pd-annot-quote">
                    {item.quote.trim() !== '' ? item.quote : t('annotations.noQuote')}
                  </span>
                  {editingId !== item.id && item.comment.trim() !== '' ? (
                    <span className="pd-annot-comment">{item.comment}</span>
                  ) : null}
                </button>

                {editingId === item.id ? (
                  <div className="pd-annot-editor">
                    <Textarea
                      value={draft}
                      onChange={setDraft}
                      rows={3}
                      placeholder={t('annotations.commentPlaceholder')}
                      ariaLabel={t('annotations.edit')}
                    />
                    <div className="pd-annot-editor-actions">
                      <Button size="sm" onClick={cancelEdit}>
                        {t('annotations.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={savingId === item.id}
                        onClick={() => void saveEdit(item.id)}
                      >
                        {t('annotations.save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="pd-annot-actions">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(item)}>
                      {t('annotations.edit')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<IconSpark size={12} />} onClick={() => onAsk(item)}>
                      {t('annotations.ask')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onRequestDelete(item)}>
                      {t('annotations.delete')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ── reader ────────────────────────────────────────────────────────────── */

export function ReaderView(props: ReaderViewProps) {
  const t = useT()
  const lang = useLang()
  const {
    paperId,
    detail,
    error,
    pdfUrl,
    busy,
    text,
    textLoading,
    textError,
    notesDirty,
    assistBusy,
    annotations,
    annotationsLoading,
    onRequestText,
    onDirtyChange,
    registerNotesSave,
    onSaveNotes,
    onReloadNotes,
    onAppendQuote,
    onPatchMeta,
    onEnrich,
    onExportBibtex,
    onReveal,
    onDelete,
    onDownloadPdf,
    onAssist,
    onCreateAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onUndo,
    onAskAboutSelection,
    ai,
    onAiAsk,
    onAiReset,
    chats,
    activeChatId,
    aiThreadKey,
    onSelectChat,
    onCreateChat,
    onRenameChat,
    onRemoveChat,
    onAiStop,
    onAiSaveToNotes,
    onAiCopy,
    onAiOpenInSession,
    cards,
    cardsLoading,
    relationCount,
    onOpenRelations,
    onCreateCard,
    onUpdateCard,
    onDeleteCard,
    onInsertCard,
    onCopyCard,
    onToast,
    onRetry,
    onImport,
  } = props

  const [tab, setTab] = useState<ReaderTab>('read')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [drawer, setDrawer] = useState<DrawerState>({ open: false, tab: 'annotations' })
  const [drawerWidth, setDrawerWidth] = useState<number>(() => readDrawerWidth())
  const [currentPage, setCurrentPage] = useState<number | null>(null)
  const pageRef = useRef<{ paperId: string; page: number | null } | null>(null)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<{ page?: number; annotationId?: string | null } | null>(null)
  const [editRequestId, setEditRequestId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AnnotationItem | null>(null)
  const [deletingAnnotation, setDeletingAnnotation] = useState(false)
  const [askAnnotation, setAskAnnotation] = useState<AnnotationItem | null>(null)
  const [askQuestion, setAskQuestion] = useState('')
  const [askingQuestion, setAskingQuestion] = useState(false)
  const [cardEditor, setCardEditor] = useState<CardEditorState | null>(null)
  const [cardSaving, setCardSaving] = useState(false)
  const [pendingCardDelete, setPendingCardDelete] = useState<NoteCard | null>(null)
  const [deletingCard, setDeletingCard] = useState(false)

  useEffect(() => {
    setTab('read')
    setDeleteOpen(false)
    setAskOpen(false)
    setQuestion('')
    setDrawer({ open: false, tab: 'annotations' })
    if (paperId === null) {
      setCurrentPage(null)
      setFocusTarget(null)
      pageRef.current = null
      setActiveAnnotationId(null)
      setEditRequestId(null)
      setPendingDelete(null)
      setAskAnnotation(null)
      setAskQuestion('')
      setCardEditor(null)
      setPendingCardDelete(null)
      setDeletingCard(false)
      return
    }
    const savedPage = readReaderPage(paperId)
    setCurrentPage(savedPage)
    setFocusTarget(savedPage !== null ? { page: savedPage } : null)
    pageRef.current = { paperId, page: savedPage }
    setActiveAnnotationId(null)
    setEditRequestId(null)
    setPendingDelete(null)
    setAskAnnotation(null)
    setAskQuestion('')
    setCardEditor(null)
    setPendingCardDelete(null)
    setDeletingCard(false)
  }, [paperId])

  /* Remember the reading page when leaving a paper; restore it on return. */
  useEffect(() => {
    if (paperId === null) return
    return () => {
      const current = pageRef.current
      if (current !== null && current.paperId === paperId) {
        writeReaderPage(current.paperId, current.page)
      }
    }
  }, [paperId])

  /* Lazy text extraction: only when the 文本 tab is visible. */
  useEffect(() => {
    if (tab !== 'text') return
    if (text !== null || textLoading || textError !== null) return
    onRequestText()
  }, [tab, text, textLoading, textError, onRequestText])

  /* Reader keyboard model: Cmd/Ctrl+Z undo, Delete/Backspace remove the active
   * annotation, Escape closes the annotation drawer. Editable targets,
   * composing input and already-handled events are left alone. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }
      /* A modal (Confirm delete / Ask / unsaved notes) owns the keyboard while open. */
      if (document.querySelector('.pd-overlay') !== null) return
      const meta = event.metaKey || event.ctrlKey
      if (meta && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        void onUndo()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && activeAnnotationId !== null) {
        event.preventDefault()
        const targetId = activeAnnotationId
        setActiveAnnotationId(null)
        setFocusTarget(null)
        void onDeleteAnnotation(targetId, { undoable: true })
        return
      }
      if (event.key === 'Escape' && drawer.open) {
        setDrawer((current) => ({ ...current, open: false }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeAnnotationId, drawer.open, onUndo, onDeleteAnnotation])

  const annotationItems = useMemo<readonly AnnotationItem[]>(
    () => (annotations === null ? [] : annotations.items),
    [annotations],
  )

  const viewerLabels = useMemo<PdfViewerLabels>(
    () => ({
      loading: t('viewer.loading'),
      loadError: t('viewer.loadError'),
      retry: t('viewer.retry'),
      page: t('viewer.page'),
      of: t('viewer.of'),
      zoomIn: t('viewer.zoomIn'),
      zoomOut: t('viewer.zoomOut'),
      fitWidth: t('viewer.fitWidth'),
      actualSize: t('viewer.actualSize'),
      prev: t('viewer.prev'),
      next: t('viewer.next'),
      highlight: t('viewer.highlight'),
      underline: t('viewer.underline'),
      note: t('viewer.note'),
      ask: t('viewer.ask'),
      copy: t('viewer.copy'),
      copied: t('viewer.copied'),
      cancel: t('viewer.cancel'),
      askTitle: t('viewer.askTitle'),
      askPlaceholder: t('viewer.askPlaceholder'),
      askSubmit: t('viewer.askSubmit'),
      textLayerUnavailable: t('viewer.textLayerUnavailable'),
    }),
    [t],
  )

  const aiLabels = useMemo<AiPanelLabels>(
    () => ({
      title: t('ai.title'),
      emptyHint: t('ai.emptyHint'),
      thinking: t('ai.thinking'),
      attaching: t('ai.attaching'),
      stop: t('ai.stop'),
      send: t('ai.send'),
      placeholder: t('ai.placeholder'),
      saveToNotes: t('ai.saveToNotes'),
      copy: t('ai.copy'),
      openInSession: t('ai.openInSession'),
      retry: t('ai.retry'),
      error: t('ai.error'),
      jumpHint: t('ai.jumpHint'),
      scrolledUpHint: t('ai.scrolledUpHint'),
      newAnswer: t('ai.newAnswer'),
      reasoning: t('ai.reasoning'),
      createCard: t('cards.createFromAnswer'),
      composingHint: t('ai.composingHint'),
      newThread: t('ai.newThread'),
      newThreadHint: t('ai.newThreadHint'),
      noResponse: t('ai.noResponse'),
      historyTitle: t('ai.historyTitle'),
      taskLabels: {
        summary: t('assist.summary'),
        method: t('assist.method'),
        critique: t('assist.critique'),
        related: t('assist.related'),
        questions: t('assist.questions'),
      },
    }),
    [t],
  )

  const chatBarLabels = useMemo<ChatBarLabels>(
    () => ({
      title: t('chat.title'),
      create: t('chat.create'),
      rename: t('chat.rename'),
      renamePlaceholder: t('chat.renamePlaceholder'),
      remove: t('chat.remove'),
      removeConfirm: t('chat.removeConfirm'),
      removeCancel: t('chat.removeCancel'),
      empty: t('chat.empty'),
    }),
    [t],
  )

  const activeChat = chats?.items.find((chat) => chat.id === activeChatId) ?? null

  if (paperId === null) {
    return (
      <section className="pd-pane pd-pane-detail" aria-label={t('reader.empty.title')}>
        <div className="pd-reader-placeholder">
          <EmptyState
            icon={<IconBook size={20} />}
            title={t('reader.empty.title')}
            description={t('reader.empty.desc')}
            action={
              <Button variant="primary" onClick={onImport}>
                {t('reader.empty.action')}
              </Button>
            }
          />
        </div>
      </section>
    )
  }

  if (detail === null && error === null) {
    return (
      <section className="pd-pane pd-pane-detail" aria-label={t('reader.loading')}>
        <div className="pd-loading-block">
          <Spinner size={16} label={t('reader.loading')} />
          <span>{t('reader.loading')}</span>
        </div>
      </section>
    )
  }

  if (detail === null) {
    return (
      <section className="pd-pane pd-pane-detail" aria-label={t('reader.error')}>
        <div className="pd-detail-error" role="alert">
          <span>{t('reader.error')}</span>
          {error !== null ? <span>{error}</span> : null}
          <Button size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      </section>
    )
  }

  const meta = detail.meta

  const openDrawer = (drawerTab: DrawerTab): void => {
    setDrawer({ open: true, tab: drawerTab })
  }

  const beginDrawerResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = drawerWidth
    const onMove = (moveEvent: PointerEvent): void => {
      const next = Math.min(680, Math.max(280, startWidth - (moveEvent.clientX - startX)))
      setDrawerWidth(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDrawerWidth((current) => {
        try {
          localStorage.setItem(DRAWER_WIDTH_KEY, String(current))
        } catch {
          // Width persistence is a convenience only.
        }
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const toggleDrawer = (drawerTab: DrawerTab): void => {
    setDrawer((current) =>
      current.open && current.tab === drawerTab ? { ...current, open: false } : { open: true, tab: drawerTab },
    )
  }

  const closeDrawer = (): void => {
    setDrawer((current) => ({ ...current, open: false }))
  }

  const jumpToPage = (page: number): void => {
    setActiveAnnotationId(null)
    setFocusTarget({ page, annotationId: null })
  }

  /* Task buttons / chips never navigate away: they open the AI drawer and run. */
  const runTask = (task: AssistTask): void => {
    setTab('read')
    openDrawer('ai')
    void onAssist(task)
  }

  const cachedPages = text === null ? [] : text.pages.filter((page) => page.text.trim() !== '')
  const textChars =
    text === null ? 0 : text.pages.reduce((total, page) => total + page.text.replace(/\s+/g, '').length, 0)

  const createFromSelection = async (
    payload: PdfSelectionPayload & { kind: AnnotationKind; comment?: string },
  ): Promise<void> => {
    const createdId = await onCreateAnnotation({
      page: payload.page,
      kind: payload.kind,
      rects: payload.rects,
      quote: payload.quote,
      comment: payload.comment ?? '',
      source: 'user',
    })
    if (createdId === null) return
    setActiveAnnotationId(createdId)
    setFocusTarget({ page: payload.page, annotationId: createdId })
    if (payload.kind === 'note' || payload.kind === 'question') {
      openDrawer('annotations')
      if (payload.kind === 'note') setEditRequestId(createdId)
    }
  }

  const confirmDeleteAnnotation = async (): Promise<void> => {
    const target = pendingDelete
    if (target === null) return
    setDeletingAnnotation(true)
    try {
      await onDeleteAnnotation(target.id, { undoable: true })
    } finally {
      setDeletingAnnotation(false)
      setPendingDelete(null)
      if (activeAnnotationId === target.id) setActiveAnnotationId(null)
    }
  }

  const submitAnnotationQuestion = async (): Promise<void> => {
    const target = askAnnotation
    const text = askQuestion.trim()
    if (target === null || text === '') return
    setAskingQuestion(true)
    try {
      await onAskAboutSelection({ quote: target.quote, page: target.page, question: text, rects: target.rects })
      setAskAnnotation(null)
      setAskQuestion('')
    } finally {
      setAskingQuestion(false)
    }
  }

  /* ── note cards (AI answer / manual) ─────────────────────────────────── */

  const openNewCard = (): void => {
    setCardEditor({
      mode: 'create',
      cardId: null,
      source: 'user',
      initial: { title: '', body: '', tags: [], pages: [] },
    })
  }

  const openCardFromAnswer = (row: AiRow): void => {
    setCardEditor({
      mode: 'create',
      cardId: null,
      source: 'ai',
      initial: {
        title: suggestCardTitle(row.text, t('cards.untitled')),
        body: row.text,
        tags: [],
        pages: collectCitedPages([row]),
      },
    })
  }

  const openCardEdit = (card: NoteCard): void => {
    setCardEditor({
      mode: 'edit',
      cardId: card.id,
      source: card.source === 'ai' ? 'ai' : 'user',
      initial: { title: card.title, body: card.body, tags: [...card.tags], pages: [...card.pages] },
    })
  }

  const saveCard = async (draft: CardDraft): Promise<void> => {
    const editor = cardEditor
    if (editor === null) return
    setCardSaving(true)
    try {
      if (editor.mode === 'create') {
        await onCreateCard({
          title: draft.title,
          body: draft.body,
          tags: draft.tags,
          pages: draft.pages,
          source: editor.source,
        })
      } else if (editor.cardId !== null) {
        await onUpdateCard(editor.cardId, {
          title: draft.title,
          body: draft.body,
          tags: draft.tags,
          pages: draft.pages,
        })
      }
      setCardEditor(null)
    } finally {
      setCardSaving(false)
    }
  }

  const deleteCardFromEditor = async (): Promise<void> => {
    const editor = cardEditor
    if (editor === null || editor.cardId === null) return
    setCardSaving(true)
    try {
      await onDeleteCard(editor.cardId)
      setCardEditor(null)
    } finally {
      setCardSaving(false)
    }
  }

  const confirmDeleteCard = async (): Promise<void> => {
    const target = pendingCardDelete
    if (target === null) return
    setDeletingCard(true)
    try {
      await onDeleteCard(target.id)
      setPendingCardDelete(null)
    } finally {
      setDeletingCard(false)
    }
  }

  const jumpToCardPage = (card: NoteCard): void => {
    const first = card.pages[0]
    if (first !== undefined) jumpToPage(first)
  }

  return (
    <section className="pd-pane pd-pane-detail" aria-label={meta.title}>
      <div className="pd-reader">
        <header className="pd-reader-head">
          <div className="pd-reader-row pd-reader-row-title">
            <h2 className="pd-reader-title" title={meta.title !== '' ? meta.title : meta.id}>
              {meta.title !== '' ? meta.title : meta.id}
            </h2>
            <span className="pd-rating-inline" title={t('reader.rating')}>
              <Rating
                value={meta.rating}
                label={t('aria.rating')}
                onChange={(value) => {
                  if (value !== meta.rating) void onPatchMeta({ rating: value }, { silent: true })
                }}
              />
            </span>
            <span className="pd-reader-row-spacer" />
            {busy !== null ? <Spinner size={11} label={t('common.loading')} /> : null}
            <Button
              size="sm"
              variant="ghost"
              icon={<IconNote size={13} />}
              aria-pressed={drawerButtonPressed(drawer, 'annotations')}
              disabled={!detail.pdfExists || detail.pdfEvicted}
              onClick={() => {
                if (tab !== 'read') {
                  setTab('read')
                  openDrawer('annotations')
                  return
                }
                toggleDrawer('annotations')
              }}
              title={t('annotations.toggle', { n: annotationItems.length })}
            >
              {t('annotations.toggle', { n: annotationItems.length })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onOpenRelations}
              title={t('reader.relations', { n: relationCount })}
            >
              {t('reader.relations', { n: relationCount })}
            </Button>
            <Menu
              label={t('reader.menu.label')}
              items={[
                {
                  id: 'enrich',
                  label: t('reader.enrich'),
                  icon: <IconRefresh size={13} />,
                  disabled: busy !== null,
                  onSelect: () => void onEnrich(),
                },
                {
                  id: 'bibtex',
                  label: t('reader.bibtex'),
                  icon: <IconDownload size={13} />,
                  disabled: busy !== null,
                  onSelect: () => void onExportBibtex(),
                },
                {
                  id: 'reveal',
                  label: t('reader.reveal'),
                  icon: <IconFolder size={13} />,
                  disabled: busy !== null,
                  onSelect: () => void onReveal(),
                },
                {
                  id: 'info',
                  label: t('reader.editInfo'),
                  icon: <IconEdit size={13} />,
                  onSelect: () => setTab('info'),
                },
                {
                  id: 'delete',
                  label: t('reader.menu.delete'),
                  icon: <IconTrash size={13} />,
                  danger: true,
                  disabled: busy !== null,
                  onSelect: () => setDeleteOpen(true),
                },
              ]}
            />
          </div>

          <div className="pd-reader-row pd-reader-row-meta">
            {meta.authors.length > 0 ? (
              <span className="pd-reader-authors" title={meta.authors.join(', ')}>
                {meta.authors.join(', ')}
              </span>
            ) : null}
            {meta.venue !== '' ? (
              <>
                {meta.authors.length > 0 ? (
                  <span className="pd-reader-info-sep" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <span className="pd-reader-meta-item" title={meta.venue}>
                  {meta.venue}
                </span>
              </>
            ) : null}
            {meta.year !== null ? (
              <>
                {meta.authors.length > 0 || meta.venue !== '' ? (
                  <span className="pd-reader-info-sep" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <span className="pd-reader-meta-item">{meta.year}</span>
              </>
            ) : null}
            {meta.pageCount !== null && meta.pageCount > 0 ? (
              <>
                {meta.authors.length > 0 || meta.venue !== '' || meta.year !== null ? (
                  <span className="pd-reader-info-sep" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <span className="pd-reader-meta-item">{t('meta.value.pages', { n: meta.pageCount })}</span>
              </>
            ) : null}
            <span className="pd-status-chip" data-status={meta.status}>
              <span className="pd-dot" data-status={meta.status} aria-hidden="true" />
              {statusLabel(t, meta.status)}
            </span>
            {meta.tags.slice(0, 3).map((tag) => (
              <span key={`${meta.id}-tag-${tag}`} className="pd-tag" title={tag}>
                {tag}
              </span>
            ))}
            {meta.tags.length > 3 ? (
              <span className="pd-tag" title={meta.tags.slice(3).join(', ')}>
                +{meta.tags.length - 3}
              </span>
            ) : null}
            {detail.pdfEvicted ? (
              <span className="pd-badge" data-kind="warn">
                {t('meta.value.evicted')}
              </span>
            ) : null}
          </div>

          <div className="pd-reader-row pd-reader-row-tabs">
            <Tabs
              className="pd-tabs-inline"
              value={tab}
              onChange={(id) => setTab(id as ReaderTab)}
              ariaLabel={t('aria.readerTabs')}
              tabs={READER_TABS.map((id) => ({ id, label: tabLabel(t, id) }))}
            />
            <div className="pd-assist-inline" role="group" aria-label={t('aria.assistBar')} title={t('assist.hint')}>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconSpark size={12} />}
                aria-pressed={drawerButtonPressed(drawer, 'ai')}
                onClick={() => {
                  setTab('read')
                  openDrawer('ai')
                }}
                title={t('assist.hint')}
              >
                {t('assist.title')}
              </Button>
              {ASSIST_TASKS.map((task) => (
                <Button
                  key={task}
                  size="sm"
                  variant="ghost"
                  disabled={assistBusy !== null}
                  loading={assistBusy === task}
                  onClick={() => runTask(task)}
                >
                  {t(`assist.${task}`)}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={assistBusy !== null}
                onClick={() => {
                  setQuestion('')
                  setAskOpen(true)
                }}
              >
                {t('assist.questions')}
              </Button>
            </div>
          </div>
        </header>

        <div className="pd-tab-panel" hidden={tab !== 'read'}>
          <div className="pd-read-shell">
            <div className="pd-viewer-host">
              {detail.pdfEvicted ? (
                <EmptyState
                  icon={<IconDownload size={20} />}
                  title={t('reader.pdfEvicted.title')}
                  description={t('reader.pdfEvicted.desc')}
                  action={
                    <Button
                      variant="primary"
                      icon={<IconDownload />}
                      loading={busy === 'download'}
                      onClick={() => void onDownloadPdf()}
                    >
                      {busy === 'download' ? t('reader.pdfEvicted.downloading') : t('reader.pdfEvicted.download')}
                    </Button>
                  }
                />
              ) : detail.pdfExists ? (
                <PdfViewer
                  key={meta.id}
                  src={pdfUrl}
                  annotations={annotationItems}
                  labels={viewerLabels}
                  onCreate={(payload) => {
                    void createFromSelection(payload)
                  }}
                  onAsk={(payload) => {
                    setTab('read')
                    openDrawer('ai')
                    void onAskAboutSelection({
                      quote: payload.quote,
                      page: payload.page,
                      question: payload.question,
                      rects: payload.rects,
                    })
                  }}
                  onFocusAnnotation={(id) => {
                    setActiveAnnotationId(id)
                    setFocusTarget({ annotationId: id })
                    openDrawer('annotations')
                  }}
                  onPageChange={(page) => {
                    setCurrentPage(page)
                    if (pageRef.current !== null && pageRef.current.paperId === paperId) {
                      pageRef.current = { paperId, page }
                    }
                  }}
                  focusPage={focusTarget?.page}
                  focusAnnotationId={focusTarget?.annotationId ?? null}
                  lowTextHint={detail.text?.lowText === true ? t('viewer.lowText') : undefined}
                />
              ) : (
                <EmptyState title={t('reader.pdfMissing.title')} description={t('reader.pdfMissing.desc')} />
              )}
            </div>

            {/* Docked push drawer beside the viewer (>900px); becomes an
                absolute full-height overlay on narrow containers. The pdf.js
                viewer re-fits via its own ResizeObserver, so opening/closing
                must not animate width. */}
            <aside
              className="pd-annot-rail"
              data-open={drawer.open ? 'true' : 'false'}
              data-tab={drawer.tab}
              style={{ width: drawerWidth }}
              aria-label={drawer.tab === 'ai' ? t('ai.title') : t('annotations.title')}
            >
              <div
                className="pd-drawer-resizer"
                role="separator"
                aria-orientation="vertical"
                onPointerDown={beginDrawerResize}
              />
              <div className="pd-drawer-tabs" role="tablist" aria-label={t('ai.title')}>
                <button
                  type="button"
                  role="tab"
                  id="pd-drawer-tab-annotations"
                  aria-controls="pd-drawer-panel"
                  className="pd-drawer-tab"
                  data-on={drawer.tab === 'annotations' ? 'true' : 'false'}
                  aria-selected={drawer.tab === 'annotations'}
                  onClick={() => openDrawer('annotations')}
                >
                  <IconNote size={12} />
                  {t('annotations.toggle', { n: annotationItems.length })}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="pd-drawer-tab-ai"
                  aria-controls="pd-drawer-panel"
                  className="pd-drawer-tab"
                  data-on={drawer.tab === 'ai' ? 'true' : 'false'}
                  aria-selected={drawer.tab === 'ai'}
                  onClick={() => openDrawer('ai')}
                >
                  <IconSpark size={12} />
                  {t('ai.title')}
                </button>
                <span className="pd-drawer-tabs-spacer" />
                <IconButton label={t('common.close')} onClick={closeDrawer}>
                  <IconClose size={13} />
                </IconButton>
              </div>
              <div
                className="pd-drawer-body"
                id="pd-drawer-panel"
                role="tabpanel"
                aria-labelledby={drawer.tab === 'ai' ? 'pd-drawer-tab-ai' : 'pd-drawer-tab-annotations'}
              >
                {drawer.tab === 'annotations' ? (
                  <AnnotationRail
                    items={annotationItems}
                    loading={annotationsLoading}
                    activeId={activeAnnotationId}
                    editRequestId={editRequestId}
                    currentPage={currentPage}
                    onLocate={(item) => {
                      setActiveAnnotationId(item.id)
                      setFocusTarget({ page: item.page, annotationId: item.id })
                    }}
                    onUpdate={onUpdateAnnotation}
                    onRequestDelete={(item) => setPendingDelete(item)}
                    onAsk={(item) => {
                      setAskAnnotation(item)
                      setAskQuestion('')
                    }}
                  />
                ) : (
                  <>
                  <ChatBar
                    chats={chats?.items ?? []}
                    activeId={activeChatId}
                    labels={chatBarLabels}
                    onSelect={onSelectChat}
                    onCreate={onCreateChat}
                    onRename={onRenameChat}
                    onRemove={onRemoveChat}
                  />
                  <AiPanel
                    ai={ai}
                    expectedThreadKey={aiThreadKey}
                    history={activeChat?.messages ?? []}
                    busyTask={assistBusy}
                    labels={aiLabels}
                    onRunTask={(task) => runTask(task)}
                    onAsk={(text) => onAiAsk(text)}
                    onReset={() => void onAiReset()}
                    onStop={() => void onAiStop()}
                    onSaveToNotes={(text) => void onAiSaveToNotes(text)}
                    onCopy={(text) => void onAiCopy(text)}
                    onOpenInSession={() => void onAiOpenInSession()}
                    onJumpPage={jumpToPage}
                    onCreateCard={openCardFromAnswer}
                  />
                  </>
                )}
              </div>
            </aside>
          </div>
        </div>

        <div className="pd-tab-panel" hidden={tab !== 'text'}>
          {textLoading ? (
            <div className="pd-loading-block">
              <Spinner size={14} label={t('reader.text.loading')} />
              <span>{t('reader.text.loading')}</span>
            </div>
          ) : textError !== null ? (
            <div className="pd-detail-error" role="alert">
              <span>{t('reader.text.failed')}</span>
              <span>{textError}</span>
              <Button size="sm" onClick={onRequestText}>
                {t('common.retry')}
              </Button>
            </div>
          ) : text === null ? (
            <EmptyState
              icon={<IconBook size={20} />}
              title={t('reader.text.empty')}
              description={t('reader.text.emptyDesc')}
              action={
                <Button variant="primary" onClick={onRequestText}>
                  {t('reader.text.extract')}
                </Button>
              }
            />
          ) : (
            <>
              <div className="pd-panel-note">
                <span>{t('reader.text.cached')}</span>
                <span className="pd-reader-info-sep" aria-hidden="true">
                  ·
                </span>
                <span>{t('reader.text.pages', { n: text.pageCount })}</span>
                <span className="pd-reader-info-sep" aria-hidden="true">
                  ·
                </span>
                <span>{t('reader.text.chars', { n: formatNumber(lang, textChars) })}</span>
                <span className="pd-reader-actions-spacer" />
                <Button size="sm" variant="ghost" onClick={onRequestText} loading={textLoading}>
                  {t('reader.text.retry')}
                </Button>
              </div>
              {text.lowText ? (
                <div className="pd-panel-note" data-kind="warn">
                  {t('reader.text.low')}
                </div>
              ) : null}
              {cachedPages.length === 0 ? (
                <EmptyState title={t('reader.text.empty')} description={t('reader.text.emptyPage')} />
              ) : (
                <div className="pd-text-scroll">
                  {cachedPages.map((page) => (
                    <article key={`page-${page.page}`} className="pd-page-card">
                      <div className="pd-page-no">{t('reader.text.page', { n: page.page })}</div>
                      <p className="pd-page-text">{page.text}</p>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="pd-tab-panel" hidden={tab !== 'notes'}>
          <div className="pd-notes-with-cards">
            <NotesEditor
              key={meta.id}
              notes={detail.notes}
              onSave={onSaveNotes}
              onReload={onReloadNotes}
              onAppendQuote={onAppendQuote}
              onDirtyChange={onDirtyChange}
              registerSave={registerNotesSave}
              onToast={onToast}
            />
            <CardsPanel
              cards={cards === null ? [] : cards.items}
              loading={cardsLoading}
              onNew={openNewCard}
              onEdit={openCardEdit}
              onInsert={(card) => void onInsertCard(card)}
              onCopy={(card) => void onCopyCard(card)}
              onDelete={(card) => setPendingCardDelete(card)}
              onJumpPages={jumpToCardPage}
            />
          </div>
        </div>

        <div className="pd-tab-panel" hidden={tab !== 'info'}>
          <MetaEditor
            key={meta.id}
            meta={meta}
            pdfBytes={detail.pdfBytes}
            pdfEvicted={detail.pdfEvicted}
            busy={busy !== null}
            onSave={(patch) => onPatchMeta(patch)}
            onEnrich={onEnrich}
            onToast={onToast}
          />
        </div>
      </div>

      <Modal
        open={deleteOpen}
        title={t('reader.delete.title')}
        description={t('reader.delete.desc')}
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy === 'delete'}
              onClick={() => {
                setDeleteOpen(false)
                void onDelete()
              }}
            >
              {t('reader.delete.confirm')}
            </Button>
          </>
        }
      />

      <Modal
        open={askOpen}
        title={t('assist.question.title')}
        description={t('assist.question.desc')}
        onClose={() => setAskOpen(false)}
        footer={
          <>
            <Button onClick={() => setAskOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={assistBusy === 'questions'}
              onClick={() => {
                const extra = question.trim()
                setAskOpen(false)
                setTab('read')
                openDrawer('ai')
                void onAssist('questions', extra === '' ? undefined : extra)
              }}
            >
              {t('assist.question.ask')}
            </Button>
          </>
        }
      >
        <Textarea
          value={question}
          onChange={setQuestion}
          rows={4}
          placeholder={t('assist.question.placeholder')}
          ariaLabel={t('assist.question.title')}
        />
      </Modal>

      {/* Delete one annotation */}
      <Modal
        open={pendingDelete !== null}
        title={t('annotations.deleteTitle')}
        description={t('annotations.deleteDesc')}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={deletingAnnotation} onClick={() => void confirmDeleteAnnotation()}>
              {t('annotations.deleteConfirm')}
            </Button>
          </>
        }
      >
        {pendingDelete !== null ? (
          <div className="pd-modal-quote">
            <span className="pd-annot-line">
              <span className="pd-annot-swatch" data-color={pendingDelete.color} aria-hidden="true" />
              <span className="pd-annot-kind">{annotationKindLabel(t, pendingDelete.kind)}</span>
              <span className="pd-annot-page">{t('annotations.pageShort', { n: pendingDelete.page })}</span>
            </span>
            <span>{pendingDelete.quote.trim() !== '' ? pendingDelete.quote : t('annotations.noQuote')}</span>
          </div>
        ) : null}
      </Modal>

      {/* Ask the agent about one annotation */}
      <Modal
        open={askAnnotation !== null}
        title={t('annotations.askTitle')}
        description={t('annotations.askDesc')}
        onClose={() => setAskAnnotation(null)}
        footer={
          <>
            <Button onClick={() => setAskAnnotation(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={askingQuestion}
              disabled={askQuestion.trim() === ''}
              onClick={() => void submitAnnotationQuestion()}
            >
              {t('annotations.askSubmit')}
            </Button>
          </>
        }
      >
        {askAnnotation !== null ? (
          <div className="pd-modal-quote">
            <span className="pd-annot-line">
              <span className="pd-annot-swatch" data-color={askAnnotation.color} aria-hidden="true" />
              <span className="pd-annot-kind">{annotationKindLabel(t, askAnnotation.kind)}</span>
              <span className="pd-annot-page">{t('annotations.pageShort', { n: askAnnotation.page })}</span>
            </span>
            <span>{askAnnotation.quote.trim() !== '' ? askAnnotation.quote : t('annotations.noQuote')}</span>
          </div>
        ) : null}
        <Textarea
          value={askQuestion}
          onChange={setAskQuestion}
          rows={4}
          placeholder={t('annotations.askPlaceholder')}
          ariaLabel={t('annotations.askTitle')}
        />
      </Modal>

      <CardEditor
        open={cardEditor !== null}
        mode={cardEditor?.mode ?? 'create'}
        initial={cardEditor?.initial ?? null}
        busy={cardSaving}
        onClose={() => setCardEditor(null)}
        onSave={(draft) => void saveCard(draft)}
        onDelete={cardEditor?.mode === 'edit' ? () => void deleteCardFromEditor() : undefined}
      />

      <Modal
        open={pendingCardDelete !== null}
        title={t('cards.deleteTitle')}
        description={t('cards.deleteDesc')}
        onClose={() => setPendingCardDelete(null)}
        footer={
          <>
            <Button onClick={() => setPendingCardDelete(null)}>{t('cards.cancel')}</Button>
            <Button variant="danger" loading={deletingCard} onClick={() => void confirmDeleteCard()}>
              {t('cards.deleteConfirm')}
            </Button>
          </>
        }
      >
        {pendingCardDelete !== null ? <div className="pd-modal-quote">{pendingCardDelete.title}</div> : null}
      </Modal>

      {notesDirty ? <span className="pd-sr">{t('notes.dirty')}</span> : null}
    </section>
  )
}
