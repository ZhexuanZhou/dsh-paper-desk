/**
 * In-panel AI drawer: renders one paper's agent thread inside the reader.
 * Pure presentational component — it reads an `AiThreadController` snapshot via
 * `useSyncExternalStore` and forwards every action to the coordinator in App.
 * DESIGN-AI.md §2.3.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { AssistTask } from '../src/types.js'
import type { AiRow, AiThreadController } from './aiSession.js'
import { groupProcessingRows } from './aiDisplay.js'
import { cleanUserPrompt } from './chatText.js'
import { Markdown } from './markdown.js'
import { Button, IconButton, Spinner } from './ui.js'
import type { MenuItemDef } from './ui.js'
import { IconClose, IconCopy, IconNote, IconPlus, IconSpark } from './icons.js'
import { clearAcceptedDraft, parseImagePages, readComposerOptions, writeComposerOptions } from './aiComposer.js'
import type { ComposerOptions } from './aiComposer.js'

/** Every string the panel renders (owned by i18n, zh + en). */
export interface AiPanelLabels {
  title: string
  emptyHint: string
  emptyTitle: string
  you: string
  smallerText: string
  largerText: string
  citedPages: string
  sendHint: string
  notesSummary: string
  imageAttach: string
  imagePages: string
  imageHint: string
  imageInvalid: string
  imageChip: string
  imageRemove: string
  imageEdit: string
  apply: string
  thinking: string
  attaching: string
  stop: string
  send: string
  placeholder: string
  saveToNotes: string
  saveAnswer: string
  copy: string
  openInSession: string
  retry: string
  error: string
  jumpHint: string
  scrolledUpHint: string
  newAnswer: string
  reasoning: string
  createCard: string
  composingHint: string
  newThread: string
  newThreadHint: string
  noResponse: string
  historyTitle: string
  toolsToggle: string
  toolsHide: string
  noteHighlight: string
  noteCommentPlaceholder: string
  noteAskPlaceholder: string
  noteAsk: string
  noteSave: string
  noteCancel: string
  noteCount: string
  noteAskAll: string
  noteDelete: string
  noteQuoteHint: string
  selectionTitle: string
  selectionExplain: string
  processTitle: string
  processTools: string
  processThoughts: string
  expandQuestion: string
  collapseQuestion: string
}

export interface AiPanelProps {
  ai: AiThreadController
  /** Thread key belonging to the visible paper/chat; mismatched state renders empty. */
  expectedThreadKey: string | null
  /** Stable key for the unsent draft (per paper + active chat, or 'new'). */
  draftKey: string | null
  /** External composer prefill (e.g. a PDF selection); `token` forces re-apply. */
  prefill?: { text: string; token: number }
  onConsumePrefill?: () => void
  /** Persisted transcript shown while the DSH session is empty (e.g. deleted). */
  history: readonly { role: 'user' | 'assistant'; text: string }[]
  busyTask: AssistTask | null
  labels: AiPanelLabels
  documentNavigation?: ReactNode
  renderConversationBar?: (actions: readonly MenuItemDef[]) => ReactNode
  currentPage?: number
  pageCount?: number | null
  imagesAvailable?: boolean
  /** Resolves true when the prompt was accepted by the session. */
  onAsk: (question: string, pages?: readonly number[]) => boolean | Promise<boolean>
  onStop: () => void | Promise<void>
  onReset: () => void | Promise<void>
  onCopy: (text: string) => void | Promise<void>
  onOpenInSession: () => void | Promise<void>
  onJumpPage: (page: number) => void
  onSourcePage?: (page: number) => void
}

/** Distinct cited pages from the assistant text, capped at 8. */
export function collectCitedPages(rows: readonly AiRow[]): number[] {
  const text = rows
    .filter((row) => row.kind === 'assistant')
    .map((row) => row.text)
    .join('\n')
  const pages: number[] = []
  const seen = new Set<number>()
  const push = (value: string | undefined): void => {
    if (value === undefined) return
    const page = Number.parseInt(value, 10)
    if (!Number.isFinite(page) || page <= 0 || seen.has(page) || pages.length >= 8) return
    seen.add(page)
    pages.push(page)
  }
  for (const match of text.matchAll(/\bpp?\.\s?(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/g)) {
    push(match[1])
    push(match[2])
  }
  for (const match of text.matchAll(/第\s?(\d{1,3})\s?页/g)) {
    push(match[1])
  }
  return pages
}

function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')
  const value = line === undefined ? '' : line.trim()
  return value.length > 90 ? `${value.slice(0, 90)}…` : value
}

interface AnswerNote {
  id: string
  quote: string
  comment: string
  rowId: string
  createdAt: string
}

interface NoteDraft {
  quote: string
  rowId: string
  comment: string
  noteId: string | null
}

function makeNoteId(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Locate the first occurrence of `quote` in the rendered answer text. */
function findQuoteRange(root: HTMLElement, quote: string): Range | null {
  const needle = quote.trim()
  if (needle === '') return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Text; start: number }> = []
  let full = ''
  let current: Node | null = walker.nextNode()
  while (current !== null) {
    if (current instanceof Text) {
      nodes.push({ node: current, start: full.length })
      full += current.data
    }
    current = walker.nextNode()
  }
  let index = full.indexOf(needle)
  if (index < 0) {
    // Markdown/KaTeX can normalise whitespace; fall back to a whitespace-
    // tolerant search so a highlight survives a re-render.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    const match = new RegExp(escaped).exec(full)
    if (match === null) return null
    index = match.index
  }
  const end = index + needle.length
  const locate = (offset: number): { node: Text; offset: number } | null => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const entry = nodes[i]
      if (entry !== undefined && offset >= entry.start && offset <= entry.start + entry.node.data.length) {
        return { node: entry.node, offset: offset - entry.start }
      }
    }
    return null
  }
  const startPoint = locate(index)
  const endPoint = locate(end)
  if (startPoint === null || endPoint === null) return null
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

function UserQuestion({ text, label, expand, collapse }: { text: string; label: string; expand: string; collapse: string }): ReactElement {
  const body = cleanUserPrompt(text)
  return <div className="pd-ai-user">
    <span className="pd-ai-user-label">{label}</span>
    {body.length > 100 || body.split('\n').length > 3
      ? <details className="pd-ai-question"><summary><span>{body}</span><small><span className="pd-ai-question-expand">{expand}</span><span className="pd-ai-question-collapse">{collapse}</span></small></summary><p>{body}</p></details>
      : <p className="pd-ai-question-text">{body}</p>}
  </div>
}

export function AiPanel(props: AiPanelProps) {
  const { ai, history, labels, onAsk, onReset, onStop, onCopy, onOpenInSession, onJumpPage, onSourcePage } = props

  const subscribe = useCallback((listener: () => void) => ai.subscribe(listener), [ai])
  const getSnapshot = useCallback(() => ai.getSnapshot(), [ai])
  const rawSnapshot = useSyncExternalStore(subscribe, getSnapshot)
  const threadMatches =
    props.expectedThreadKey === null
      ? rawSnapshot.threadKey === null
      : rawSnapshot.threadKey === props.expectedThreadKey
  const snapshot = threadMatches
    ? rawSnapshot
    : { status: 'idle' as const, threadKey: null, paperId: null, sessionId: null, rows: [], error: null }

  const [draft, setDraft] = useState('')
  const draftKey = props.draftKey
  const [sending, setSending] = useState(false)
  const draftStoreKey = draftKey === null ? null : `paperdesk:ai-draft:${draftKey}`
  const scopeRef = useRef(draftStoreKey)
  scopeRef.current = draftStoreKey
  const [options, setOptions] = useState<ComposerOptions>({ pages: [] })
  const [editingPages, setEditingPages] = useState(false)
  const [pageInput, setPageInput] = useState('')
  const [pageError, setPageError] = useState(false)
  const composingRef = useRef(false)
  const [noResponse, setNoResponse] = useState(false)
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('paperdesk:ai-zoom')
      const value = raw === null ? Number.NaN : Number.parseFloat(raw)
      return Number.isFinite(value) ? Math.min(1.4, Math.max(0.85, value)) : 1
    } catch {
      return 1
    }
  })
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [follow, setFollow] = useState(true)
  const [hasNew, setHasNew] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const noteScope = props.draftKey ?? props.expectedThreadKey ?? 'default'
  const noteStoreKey = `paperdesk:ai-notes:${noteScope}`
  const [notes, setNotes] = useState<AnswerNote[]>([])
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const selectionRangeRef = useRef<Range | null>(null)

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(168, Math.max(64, input.scrollHeight))}px`
  }, [draft, draftStoreKey])

  const rows = snapshot.rows
  const running = snapshot.status === 'running'
  const attaching = snapshot.status === 'attaching'
  const disabled = running || attaching || sending

  const lastPrompt = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row !== undefined && row.kind === 'user') return row.text
    }
    return null
  }, [rows])

  const changeZoom = (delta: number): void => {
    setZoom((current) => {
      const next = Math.min(1.4, Math.max(0.85, Math.round((current + delta) * 100) / 100))
      try { localStorage.setItem('paperdesk:ai-zoom', String(next)) } catch {}
      return next
    })
  }

  const displayItems = useMemo(() => groupProcessingRows(rows), [rows])


  useEffect(() => {
    return () => {
      if (watchdogRef.current !== null) clearTimeout(watchdogRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    setEditingPages(false)
    setPageError(false)
    setNoResponse(false)
    if (watchdogRef.current !== null) clearTimeout(watchdogRef.current)
    try {
      setDraft(draftStoreKey === null ? '' : localStorage.getItem(draftStoreKey) ?? '')
      setOptions(readComposerOptions(localStorage, draftStoreKey, props.pageCount ?? null))
    } catch {
      setDraft('')
      setOptions({ pages: [] })
    }
  }, [draftStoreKey, props.pageCount])

  const updateOptions = (change: (previous: ComposerOptions) => ComposerOptions): void => {
    if (scopeRef.current !== draftStoreKey) return
    setOptions((previous) => {
      const next = change(previous)
      try { writeComposerOptions(localStorage, draftStoreKey, next) } catch {}
      return next
    })
  }

  const editPages = (): void => {
    setPageInput(options.pages.length ? options.pages.join(', ') : String(props.currentPage ?? 1))
    setPageError(false)
    setEditingPages(true)
  }

  const applyPages = (): void => {
    const pages = parseImagePages(pageInput, props.currentPage ?? 1, props.pageCount ?? null)
    if (pages === null) { setPageError(true); return }
    updateOptions((previous) => ({ ...previous, pages }))
    setPageError(false)
    setEditingPages(false)
    inputRef.current?.focus()
  }

  /* Prefill the composer from an external selection (token changes each time,
     so selecting the same passage twice still re-applies). */
  useEffect(() => {
    const prefill = props.prefill
    if (prefill === undefined || prefill.text.length === 0) return
    setDraft((current) => (current.trim().length > 0 ? `${current}\n\n${prefill.text}` : prefill.text))
    if (draftStoreKey !== null) {
      try {
        const existing = localStorage.getItem(draftStoreKey) ?? ''
        const next = existing.trim().length > 0 ? `${existing}\n\n${prefill.text}` : prefill.text
        localStorage.setItem(draftStoreKey, next)
      } catch {
        // Draft persistence is a convenience only.
      }
    }
    props.onConsumePrefill?.()
    window.requestAnimationFrame(() => {
      const element = inputRef.current
      if (element === null) return
      element.focus()
      const end = element.value.length
      try { element.setSelectionRange(end, end) } catch { /* non-text */ }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prefill?.token])

  useEffect(() => {
    setNoteDraft(null)
    try {
      const raw = localStorage.getItem(noteStoreKey)
      if (raw === null) {
        setNotes([])
        return
      }
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        setNotes([])
        return
      }
      const next: AnswerNote[] = []
      for (const value of parsed) {
        if (value === null || typeof value !== 'object') continue
        const record = value as Record<string, unknown>
        if (typeof record['quote'] !== 'string' || record['quote'].trim() === '') continue
        next.push({
          id: typeof record['id'] === 'string' ? record['id'] : makeNoteId(),
          quote: record['quote'],
          comment: typeof record['comment'] === 'string' ? record['comment'] : '',
          rowId: typeof record['rowId'] === 'string' ? record['rowId'] : '',
          createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : new Date().toISOString(),
        })
      }
      setNotes(next.slice(-60))
    } catch {
      setNotes([])
    }
  }, [noteStoreKey])

  const persistNotes = useCallback((next: AnswerNote[]): void => {
    setNotes(next)
    try {
      localStorage.setItem(noteStoreKey, JSON.stringify(next.slice(-60)))
    } catch {
      // Annotation persistence is a convenience; keep the in-memory copy.
    }
  }, [noteStoreKey])

  /* Use the CSS Custom Highlight API so highlights survive React re-renders
     without mutating the rendered Markdown DOM. */
  useEffect(() => {
    const registry = (CSS as unknown as { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }).highlights
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (registry === undefined || HighlightCtor === undefined) return
    const ranges: Range[] = []
    for (const note of notes) {
      const rows = panelRef.current?.querySelectorAll<HTMLElement>('[data-ai-row-id]')
      if (rows === undefined) break
      let host: HTMLElement | null = null
      for (const row of rows) {
        if (note.rowId !== '' && row.dataset['aiRowId'] === note.rowId) {
          host = row.querySelector<HTMLElement>('.pd-ai-assistant')
          if (host !== null) break
        }
      }
      if (host === null) {
        for (const row of rows) {
          const candidate = row.querySelector<HTMLElement>('.pd-ai-assistant')
          if (candidate !== null && (candidate.textContent ?? '').includes(note.quote.trim().slice(0, 40))) {
            host = candidate
            break
          }
        }
      }
      if (host === null) continue
      const range = findQuoteRange(host, note.quote)
      if (range === null) continue
      ranges.push(range)
    }
    if (ranges.length > 0) {
      try {
        registry.set('paperdesk-answer-note', new HighlightCtor(...ranges))
      } catch {
        // Browser without the Highlight constructor: comments still work.
      }
    }
    return () => {
      try { registry.delete('paperdesk-answer-note') } catch {}
    }
  }, [notes, rows, history])

  const updateAnswerNote = (id: string, patch: Partial<Pick<AnswerNote, 'comment'>>): void => {
    persistNotes(notes.map((note) => (note.id === id ? { ...note, ...patch } : note)))
  }

  const deleteAnswerNote = (id: string): void => {
    persistNotes(notes.filter((note) => note.id !== id))
  }

  const openNoteEditor = (note: AnswerNote): void => {
    selectionRangeRef.current = null
    setNoteDraft({ quote: note.quote, rowId: note.rowId, comment: note.comment, noteId: note.id })
  }

  useEffect(() => {
    const registry = (CSS as unknown as { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }).highlights
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!registry || !HighlightCtor || !noteDraft) return
    let range = selectionRangeRef.current
    if (!range || !range.startContainer.isConnected) {
      const rows = panelRef.current?.querySelectorAll<HTMLElement>('[data-ai-row-id]') ?? []
      for (const row of rows) {
        if (noteDraft.rowId && row.dataset['aiRowId'] !== noteDraft.rowId) continue
        const host = row.querySelector<HTMLElement>('.pd-ai-assistant')
        if (host) { range = findQuoteRange(host, noteDraft.quote); if (range) break }
      }
    }
    if (range) registry.set('paperdesk-answer-selection', new HighlightCtor(range))
    return () => registry.delete('paperdesk-answer-selection')
  }, [noteDraft, rows, history])

  const closeNoteDraft = (): void => {
    setNoteDraft(null)
    selectionRangeRef.current = null
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    if (noteDraft === null) return
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      const target = event.target
      if (target !== document.body && (!(target instanceof Node) || !panelRef.current?.contains(target))) return
      event.preventDefault()
      event.stopPropagation()
      closeNoteDraft()
    }
    // Consume Escape before the reader's window handler closes the whole drawer.
    document.addEventListener('keydown', onEscape, true)
    return () => document.removeEventListener('keydown', onEscape, true)
  }, [noteDraft !== null])

  const askAboutDraft = async (): Promise<void> => {
    if (!noteDraft || disabled) return
    const draft = noteDraft
    const question = draft.comment.trim() || labels.selectionExplain
    const accepted = await onAsk(`${labels.selectionTitle}：\n> ${draft.quote.replace(/\n/g, '\n> ')}\n\n${question}`)
    if (accepted) closeNoteDraft()
  }

  const saveNoteDraft = (): void => {
    const draft = noteDraft
    if (draft === null) return
    const comment = draft.comment.trim()
    if (draft.noteId !== null) {
      updateAnswerNote(draft.noteId, { comment })
    } else if (comment !== '') {
      const note: AnswerNote = {
        id: makeNoteId(),
        quote: draft.quote,
        comment,
        rowId: draft.rowId,
        createdAt: new Date().toISOString(),
      }
      persistNotes([...notes, note])
    }
    setNoteDraft(null)
    window.getSelection()?.removeAllRanges()
  }

  const deleteNoteDraft = (): void => {
    if (noteDraft?.noteId !== null && noteDraft?.noteId !== undefined) deleteAnswerNote(noteDraft.noteId)
    setNoteDraft(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleAnswerSelection = (event: React.SyntheticEvent<HTMLDivElement>): void => {
    if (noteDraft?.comment.trim()) return // Keep a comment in progress when the reader selects elsewhere.
    const target = event.target
    if (target instanceof Element && target.closest('textarea, input, button, .pd-ai-selection-editor, .pd-ai-notes-tray') !== null) return
    window.setTimeout(() => {
      const dom = window.getSelection()
      if (dom === null || dom.rangeCount === 0 || dom.isCollapsed) return
      const range = dom.getRangeAt(0)
      const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement
      const host = startElement?.closest<HTMLElement>('.pd-ai-assistant') ?? null
      const panel = panelRef.current
      if (host === null || panel === null || !panel.contains(host)) return
      const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
        ? range.endContainer as Element : range.endContainer.parentElement
      if (endElement?.closest('.pd-ai-assistant') !== host) return
      const quote = dom.toString().trim()
      if (quote.length < 2) return
      const row = host.closest<HTMLElement>('[data-ai-row-id]')
      selectionRangeRef.current = range.cloneRange()
      setFollow(false)
      setNoteDraft({ quote, rowId: row?.dataset['aiRowId'] ?? '', comment: '', noteId: null })
    }, 0)
  }

  const askWithAllNotes = (): void => {
    if (disabled) return
    const withComments = notes.filter((note) => note.comment.trim() !== '')
    if (withComments.length === 0) return
    const lines = [
      `请统一解答我在你上一条回答中做的 ${withComments.length} 条批注。`,
      '',
      ...withComments.map((note, index) => [
        `${index + 1}. 原文：${note.quote.replace(/\n+/g, ' ')}`,
        `   我的评论/问题：${note.comment.trim()}`,
      ].join('\n')),
      '',
      '请逐条回应，并说明它们之间是否有联系。',
    ]
    void onAsk(lines.join('\n'))
  }

  /* Auto-follow the stream unless the user scrolled away from the bottom. */
  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    if (follow) {
      element.scrollTop = element.scrollHeight
    } else if (rows.length > 0) {
      setHasNew(true)
    }
  }, [rows, follow])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (element === null) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    if (distance < 32) {
      setFollow(true)
      setHasNew(false)
    } else {
      setFollow(false)
    }
  }

  const jumpToLatest = (): void => {
    const element = scrollRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
    setFollow(true)
    setHasNew(false)
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || disabled || editingPages || pageError) return
    const sentScope = draftStoreKey
    const sentDraft = draft
    const sentOptions = options
    if (options.pages.length && (props.imagesAvailable === false || parseImagePages(options.pages.join(','), 1, props.pageCount ?? null) === null)) { setPageError(true); return }
    setFollow(true)
    setSending(true)
    setNoResponse(false)
    if (watchdogRef.current !== null) clearTimeout(watchdogRef.current)
    try {
      const accepted = await onAsk(text, options.pages)
      // Keep the question in the box when the session refused it, so the
      // failure is visible and the user can retry instead of losing the text.
      if (accepted) {
        try { clearAcceptedDraft(localStorage, sentScope, sentDraft, sentOptions) } catch {}
        if (scopeRef.current === sentScope) {
          setDraft('')
          setOptions({ pages: [] })
          setPageError(false)
        }
        const baseline = ai.getSnapshot().rows.length
        watchdogRef.current = setTimeout(() => {
          const snapshot = ai.getSnapshot()
          if (scopeRef.current === sentScope && snapshot.rows.length <= baseline && snapshot.status !== 'running') setNoResponse(true)
        }, 12000)
      }
    } finally {
      setSending(false)
    }
  }

  const retryLast = (prompt: string): void => {
    if (disabled) return
    setFollow(true)
    void onAsk(prompt)
  }

  // Copy the stored Markdown, never the rendered DOM/MathML text.
  const answerActions = (row: AiRow): ReactElement => (
    <div className="pd-ai-row-actions">
      <Button size="sm" variant="ghost" icon={<IconCopy size={14} />} onClick={() => void onCopy(row.text)}>{labels.copy}</Button>

    </div>
  )

  const renderCitations = (row: AiRow): ReactElement | null => {
    const pages = collectCitedPages([row])
    if (!pages.length) return null
    return (
      <div className="pd-ai-cites" role="group" aria-label={labels.jumpHint}>
        <span>{labels.citedPages}</span>
        {pages.map((page) => (
          <button key={page} type="button" className="pd-ai-cite"
            onClick={() => (onSourcePage ?? onJumpPage)(page)} title={labels.jumpHint}>
            {`p.${page}`}
          </button>
        ))}
      </div>
    )
  }

  const renderRow = (row: AiRow): ReactElement => {
    switch (row.kind) {
      case 'user':
        return <UserQuestion text={row.text} label={labels.you} expand={labels.expandQuestion} collapse={labels.collapseQuestion} />
      case 'assistant':
        return (
          <div key={row.id} className="pd-ai-assistant">
            <Markdown markdown={row.text} />
            {row.streaming === true ? <span className="pd-ai-caret" aria-hidden="true" /> : null}
          </div>
        )
      case 'reasoning':
        return (
          <details key={row.id} className="pd-ai-reasoning">
            <summary>{labels.reasoning}</summary>
            <Markdown markdown={row.text} />
          </details>
        )
      case 'tool':
        return (
          <div key={row.id} className="pd-ai-tool">
            {row.running === true ? <Spinner size={10} label={labels.thinking} /> : <span aria-hidden="true">·</span>}
            <span className="pd-ai-tool-name">
              {row.tool ?? (row.text.trim() !== '' ? firstLine(row.text) : labels.thinking)}
            </span>
            {row.tool !== undefined && row.text.trim() !== '' && row.text !== row.tool ? (
              <span className="pd-ai-tool-detail" title={row.text}>
                {firstLine(row.text)}
              </span>
            ) : null}
          </div>
        )
      case 'error':
        return (
          <div key={row.id} className="pd-ai-error" role="alert">
            <span>{row.text}</span>
            {lastPrompt !== null ? (
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => retryLast(lastPrompt)}>
                {labels.retry}
              </Button>
            ) : null}
          </div>
        )
      default:
        return (
          <div key={row.id} className="pd-ai-status">
            {row.text}
          </div>
        )
    }
  }

  return (
    <div
      ref={panelRef}
      className="pd-ai"
      role="region"
      aria-label={labels.title}
      style={{ '--pd-ai-font-scale': zoom } as CSSProperties}
      onMouseUp={handleAnswerSelection}
      onKeyUp={(event) => { if (event.key === 'Shift' || event.key.startsWith('Arrow')) handleAnswerSelection(event) }}
    >
      {props.renderConversationBar?.([
        { id: 'smaller', label: labels.smallerText, disabled: zoom <= 0.85, onSelect: () => changeZoom(-0.05) },
        { id: 'larger', label: labels.largerText, disabled: zoom >= 1.4, onSelect: () => changeZoom(0.05) },
        { id: 'session', label: labels.openInSession, disabled: snapshot.sessionId === null, onSelect: () => void onOpenInSession() },
      ])}
      {props.documentNavigation}
      <div className="pd-ai-body">
        <div className="pd-ai-scroll" ref={scrollRef} onScroll={onScroll}>
          {attaching ? (
            <div className="pd-ai-thinking">
              <Spinner size={12} label={labels.attaching} />
              <span>{labels.attaching}</span>
            </div>
          ) : null}

          {snapshot.status === 'error' && snapshot.error !== null ? (
            <div className="pd-ai-error" role="alert">
              <span>{snapshot.error !== '' ? snapshot.error : labels.error}</span>
            </div>
          ) : null}



          {rows.length === 0 && history.length > 0 ? (
            <div className="pd-ai-history">
              <div className="pd-ai-history-title">{labels.historyTitle}</div>
              {history.map((message, index) =>
                message.role === 'user' ? (
                  <UserQuestion key={`history-${index}`} text={message.text} label={labels.you} expand={labels.expandQuestion} collapse={labels.collapseQuestion} />
                ) : (
                  <div key={`history-${index}`} className="pd-ai-row" data-ai-row-id={`history-${index}`}>
                    <div className="pd-ai-assistant">
                      <Markdown markdown={message.text} />
                    </div>
                    {renderCitations({ id: `history-${index}`, kind: 'assistant', text: message.text })}
                    {answerActions({ id: `history-${index}`, kind: 'assistant', text: message.text })}
                  </div>
                ),
              )}
            </div>
          ) : null}

          {rows.length === 0 && history.length === 0 && !attaching && snapshot.status !== 'error' ? (
            <div className="pd-ai-empty">
              <IconSpark size={24} />
              <h3>{labels.emptyTitle}</h3>
              <p>{labels.emptyHint}</p>

            </div>
          ) : null}

          {displayItems.map((item) => item.kind === 'process' ? (
            <details key={`process-${item.id}`} className="pd-ai-process">
              <summary>
                <span>{labels.processTitle}</span>
                <small>{[
                  item.rows.some((row) => row.kind === 'reasoning') ? labels.processThoughts.replace('{n}', String(item.rows.filter((row) => row.kind === 'reasoning').length)) : '',
                  item.rows.some((row) => row.kind === 'tool') ? labels.processTools.replace('{n}', String(item.rows.filter((row) => row.kind === 'tool').length)) : '',
                ].filter(Boolean).join(' · ')}</small>
              </summary>
              <div className="pd-ai-process-content">
                {item.rows.map((row) => <div key={row.id} className="pd-ai-process-step">
                  {row.kind === 'reasoning' ? <Markdown markdown={row.text} /> : renderRow(row)}
                </div>)}
              </div>
            </details>
          ) : (
            <div key={item.row.id} className="pd-ai-row" data-ai-row-id={item.row.id}>
              {renderRow(item.row)}
              {item.row.kind === 'assistant' ? renderCitations(item.row) : null}
              {item.row.kind === 'assistant' && item.row.streaming !== true ? answerActions(item.row) : null}
            </div>
          ))}

          {noResponse ? (
            <div className="pd-ai-error" role="alert">
              <span>{labels.noResponse}</span>
              <Button size="sm" variant="ghost" onClick={() => void onReset()}>
                {labels.newThread}
              </Button>
            </div>
          ) : null}

          {running || sending ? (
            <div className="pd-ai-thinking">
              <Spinner size={11} label={labels.thinking} />
              <span>{labels.thinking}</span>
            </div>
          ) : null}
          {notes.length > 0 ? (
            <details className="pd-ai-notes-tray">
              <summary><IconNote size={15} />{labels.notesSummary.replace('{n}', String(notes.length))}</summary>
              <div className="pd-ai-notes-content">
              <div className="pd-ai-notes-chips">
                {notes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className="pd-ai-note-chip"
                    title={note.quote}
                    onClick={() => openNoteEditor(note)}
                  >
                    {note.comment.trim() !== '' ? note.comment : note.quote}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || notes.every((note) => note.comment.trim() === '')}
                onClick={askWithAllNotes}
              >
                {labels.noteAskAll}
              </Button>
              </div>
            </details>
          ) : null}

        </div>

        {!follow ? (
          <button
            type="button"
            className="pd-ai-jump"
            onClick={jumpToLatest}
            title={hasNew ? labels.newAnswer : labels.scrolledUpHint}
          >
            {hasNew ? labels.newAnswer : labels.scrolledUpHint}
          </button>
        ) : null}
      </div>

      {noteDraft !== null ? (
        <section className="pd-ai-selection-editor" aria-label={labels.selectionTitle}>
          <div className="pd-ai-selection-head">
            <strong>{labels.selectionTitle}</strong>
            <IconButton label={labels.noteCancel} onClick={closeNoteDraft}><IconClose size={16} /></IconButton>
          </div>
          <blockquote className="pd-ai-selection-quote" tabIndex={0}>{noteDraft.quote}</blockquote>
          <textarea className="pd-textarea pd-ai-selection-comment" rows={2}
            value={noteDraft.comment} placeholder={labels.noteCommentPlaceholder} aria-label={labels.noteCommentPlaceholder}
            onChange={(event) => setNoteDraft({ ...noteDraft, comment: event.target.value })} />
          <div className="pd-ai-selection-actions">
            {noteDraft.noteId !== null ? <Button size="sm" variant="ghost" onClick={deleteNoteDraft}>{labels.noteDelete}</Button> : null}
            <Button size="sm" variant="ghost" onClick={closeNoteDraft}>{labels.noteCancel}</Button>
            <Button size="sm" disabled={noteDraft.comment.trim() === ''} onClick={saveNoteDraft}>{labels.noteSave}</Button>
            <Button size="sm" variant="primary" disabled={disabled} onClick={() => void askAboutDraft()}>{labels.noteAsk}</Button>
          </div>
        </section>
      ) : null}

      <div className="pd-ai-foot">
        {options.pages.length > 0 ? <div className="pd-ai-attachments">
          {options.pages.map((page) => <span className="pd-ai-page-chip" key={page}>
            <button type="button" onClick={editPages} disabled={disabled} aria-label={`${labels.imageEdit} p.${page}`}>{labels.imageChip} · p.{page}</button>
            <IconButton label={`${labels.imageRemove} p.${page}`} disabled={disabled} onClick={() => { updateOptions((previous) => ({ ...previous, pages: previous.pages.filter((value) => value !== page) })); setPageError(false) }}><IconClose size={12} /></IconButton>
          </span>)}
        </div> : null}
        {editingPages ? <div className="pd-ai-page-editor">
          <label>{labels.imagePages}<input className="pd-input" autoFocus value={pageInput} disabled={disabled} onChange={(event) => { setPageInput(event.target.value); setPageError(false) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); applyPages() } if (event.key === 'Escape') { event.stopPropagation(); setEditingPages(false); setPageError(false) } }} aria-invalid={pageError} /></label>
          <div className="pd-ai-page-editor-actions"><span>{labels.imageHint}</span><Button size="sm" variant="ghost" onClick={() => { setEditingPages(false); setPageError(false) }}>{labels.noteCancel}</Button><Button size="sm" onClick={applyPages}>{labels.apply}</Button></div>
        </div> : null}
        {pageError ? <p className="pd-ai-page-error" role="alert">{labels.imageInvalid}</p> : null}
        <div className="pd-ai-inputRow">
          <textarea
            ref={inputRef}
            className="pd-textarea pd-ai-input"
            rows={2}
            value={draft}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            disabled={attaching || sending}
            onChange={(event) => {
              const value = event.target.value
              setDraft(value)
              if (draftStoreKey !== null) {
                try {
                  if (value === '') localStorage.removeItem(draftStoreKey)
                  else localStorage.setItem(draftStoreKey, value)
                } catch {
                  // Draft persistence is a convenience only.
                }
              }
            }}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              // While an IME is composing, Enter belongs to candidate selection.
              // Use the composition events (not just nativeEvent.isComposing,
              // which can stay stale in some Chromium/IME combinations) so Enter
              // sends as soon as the composition has really ended.
              if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              void send()
            }}
          />
        </div>
        <div className="pd-ai-compose-actions">
          <IconButton label={labels.imageAttach} disabled={disabled || props.imagesAvailable === false} onClick={editPages}><IconPlus size={17} /></IconButton>

          <span className="pd-ai-send-hint">{labels.sendHint}</span>
          {running || sending ? <Button size="sm" variant="ghost" disabled={sending && !running} onClick={() => void onStop()}>{labels.stop}</Button> : <Button size="sm" variant="primary" disabled={disabled || editingPages || pageError || draft.trim() === ''} onClick={() => void send()}>{labels.send}</Button>}
        </div>
      </div>
    </div>
  )
}
