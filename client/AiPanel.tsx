/**
 * In-panel AI drawer: renders one paper's agent thread inside the reader.
 * Pure presentational component — it reads an `AiThreadController` snapshot via
 * `useSyncExternalStore` and forwards every action to the coordinator in App.
 * DESIGN-AI.md §2.3.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { AssistTask } from '../src/types.js'
import type { AiRow, AiThreadController } from './aiSession.js'
import { Markdown } from './markdown.js'
import { Button, Spinner } from './ui.js'

/** Tasks rendered as chips (提问 focuses the follow-up box instead). */
type PanelTask = 'summary' | 'method' | 'critique' | 'related'
const PANEL_TASKS: readonly PanelTask[] = ['summary', 'method', 'critique', 'related']

/** Every string the panel renders (owned by i18n, zh + en). */
export interface AiPanelLabels {
  title: string
  emptyHint: string
  thinking: string
  attaching: string
  stop: string
  send: string
  placeholder: string
  saveToNotes: string
  copy: string
  openInSession: string
  retry: string
  error: string
  jumpHint: string
  scrolledUpHint: string
  newAnswer: string
  reasoning: string
  createCard: string
  taskLabels: Readonly<Record<'summary' | 'method' | 'critique' | 'related' | 'questions', string>>
}

export interface AiPanelProps {
  ai: AiThreadController
  busyTask: AssistTask | null
  labels: AiPanelLabels
  onRunTask: (task: AssistTask, extra?: string) => void | Promise<void>
  onAsk: (question: string) => void | Promise<void>
  onStop: () => void | Promise<void>
  onSaveToNotes: (text: string) => void | Promise<void>
  onCopy: (text: string) => void | Promise<void>
  onOpenInSession: () => void | Promise<void>
  onJumpPage: (page: number) => void
  /** Per-answer 「生成卡片」 action (omitted → no per-message card button). */
  onCreateCard?: (row: AiRow) => void
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

export function AiPanel(props: AiPanelProps) {
  const { ai, busyTask, labels, onRunTask, onAsk, onStop, onSaveToNotes, onCopy, onOpenInSession, onJumpPage, onCreateCard } = props

  const subscribe = useCallback((listener: () => void) => ai.subscribe(listener), [ai])
  const getSnapshot = useCallback(() => ai.getSnapshot(), [ai])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const [draft, setDraft] = useState('')
  const [follow, setFollow] = useState(true)
  const [hasNew, setHasNew] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const rows = snapshot.rows
  const running = snapshot.status === 'running'
  const attaching = snapshot.status === 'attaching'
  const disabled = running || attaching
  const answer = ai.lastAnswer()
  const pages = useMemo(() => collectCitedPages(rows), [rows])

  const lastPrompt = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row !== undefined && row.kind === 'user') return row.text
    }
    return null
  }, [rows])

  const lastAssistantIndex = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row !== undefined && row.kind === 'assistant') return index
    }
    return -1
  }, [rows])

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

  const focusFollowUp = (): void => {
    inputRef.current?.focus()
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || disabled) return
    setDraft('')
    setFollow(true)
    await onAsk(text)
  }

  const runTask = (task: AssistTask): void => {
    if (disabled || busyTask !== null) return
    void onRunTask(task)
  }

  const retryLast = (prompt: string): void => {
    if (disabled) return
    setFollow(true)
    void onAsk(prompt)
  }

  const renderRow = (row: AiRow): ReactElement => {
    switch (row.kind) {
      case 'user':
        return (
          <div key={row.id} className="pd-ai-user">
            {row.text}
          </div>
        )
      case 'assistant':
        return (
          <div key={row.id} className="pd-ai-assistant">
            <Markdown markdown={row.text} />
            {row.streaming === true ? <span className="pd-ai-caret" aria-hidden="true" /> : null}
            {row.streaming !== true && onCreateCard !== undefined ? (
              <div className="pd-ai-row-actions">
                <Button size="sm" variant="ghost" onClick={() => onCreateCard(row)}>
                  {labels.createCard}
                </Button>
              </div>
            ) : null}
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
    <div className="pd-ai" role="region" aria-label={labels.title}>
      <div className="pd-ai-tasks" role="group" aria-label={labels.title}>
        {PANEL_TASKS.map((task) => (
          <Button
            key={task}
            size="sm"
            variant="ghost"
            disabled={disabled || busyTask !== null}
            loading={busyTask === task}
            onClick={() => runTask(task)}
          >
            {labels.taskLabels[task]}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={disabled || busyTask !== null} onClick={focusFollowUp}>
          {labels.taskLabels.questions}
        </Button>
      </div>

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

          {rows.length === 0 && !attaching && snapshot.status !== 'error' ? (
            <div className="pd-ai-empty">{labels.emptyHint}</div>
          ) : null}

          {rows.map((row, index) => (
            <div key={row.id} className="pd-ai-row">
              {renderRow(row)}
              {index === lastAssistantIndex && pages.length > 0 ? (
                <div className="pd-ai-cites" role="group" aria-label={labels.jumpHint}>
                  {pages.map((page) => (
                    <button
                      key={`cite-${page}`}
                      type="button"
                      className="pd-ai-cite"
                      onClick={() => onJumpPage(page)}
                      title={labels.jumpHint}
                    >
                      {`p.${page}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          {running ? (
            <div className="pd-ai-thinking">
              <Spinner size={11} label={labels.thinking} />
              <span>{labels.thinking}</span>
            </div>
          ) : null}
        </div>

        {!follow ? (
          <button
            type="button"
            className="pd-ai-jump"
            onClick={jumpToLatest}
            title={hasNew ? labels.newAnswer : labels.scrolledUpHint}
          >
            {labels.scrolledUpHint}
          </button>
        ) : null}
      </div>

      <div className="pd-ai-foot">
        <div className="pd-ai-actions">
          {running ? (
            <Button size="sm" variant="ghost" onClick={() => void onStop()}>
              {labels.stop}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={answer === null || answer.trim() === ''}
            onClick={() => {
              if (answer !== null && answer.trim() !== '') void onSaveToNotes(answer)
            }}
          >
            {labels.saveToNotes}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={answer === null || answer.trim() === ''}
            onClick={() => {
              if (answer !== null && answer.trim() !== '') void onCopy(answer)
            }}
          >
            {labels.copy}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={snapshot.sessionId === null}
            onClick={() => void onOpenInSession()}
          >
            {labels.openInSession}
          </Button>
        </div>
        <div className="pd-ai-inputRow">
          <textarea
            ref={inputRef}
            className="pd-textarea pd-ai-input"
            rows={2}
            value={draft}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              void send()
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={disabled || draft.trim() === ''}
            onClick={() => void send()}
          >
            {labels.send}
          </Button>
        </div>
      </div>
    </div>
  )
}
