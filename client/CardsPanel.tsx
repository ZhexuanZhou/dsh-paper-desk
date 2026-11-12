/**
 * Note cards from AI answers (DESIGN-FEATURES §1).
 *
 * `CardEditor` is the create/edit modal (title, Markdown body, tags, page
 * chips); `CardsPanel` is the full-page card reading view. Both are
 * presentational — persistence lives in `App`, which owns the `/cards` API.
 */
import { useEffect, useRef, useState } from 'react'
import type { CardContextTurn, NoteCard } from '../src/types.js'
import { IconEdit, IconNote, IconPlus, IconTrash } from './icons.js'
import { Markdown } from './markdown.js'
import { useT } from './i18n.js'
import { Button, EmptyState, Field, IconButton, Modal, Spinner, Textarea, TextInput } from './ui.js'

/** Editable draft shared by "create from AI answer" / "new card" / "edit card". */
export interface CardDraft {
  title: string
  body: string
  tags: string[]
  pages: number[]
  context: CardContextTurn[]
}

/** Suggested title: first non-empty line with markdown decoration stripped. */
export function suggestCardTitle(markdown: string, fallback: string): string {
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*>]\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .trim()
    if (line !== '') {
      const sentence = (line.split(/[。！？!?；;]/)[0] ?? line).trim()
      const short = sentence.length > 0 ? sentence : line
      return short.length > 60 ? `${short.slice(0, 60)}…` : short
    }
  }
  return fallback
}

/** The Markdown block inserted into notes.md for a saved card. */
export function cardToNotesMarkdown(card: NoteCard): string {
  const pages = card.pages.length > 0 ? card.pages.map((page) => `p.${page}`).join(', ') : '—'
  const date = card.createdAt !== '' ? card.createdAt.slice(0, 10) : ''
  const body = card.body.trim()
  return `### 卡片：${card.title}\n- 来源：${pages} / ${date}\n\n${body}\n`
}

function parseTagList(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of value.split(/[,，;；]/)) {
    const tag = part.trim()
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= 12) break
  }
  return tags
}

function normalizePages(pages: readonly number[]): number[] {
  const seen = new Set<number>()
  const result: number[] = []
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1 || page > 999 || seen.has(page)) continue
    seen.add(page)
    result.push(page)
    if (result.length >= 20) break
  }
  return result
}

/* ── card editor ───────────────────────────────────────────────────────── */

export interface CardEditorProps {
  open: boolean
  mode: 'create' | 'edit'
  initial: CardDraft | null
  busy: boolean
  /** Turns available for the context picker (current AI thread). */
  availableTurns?: readonly CardContextTurn[]
  /** Turn the selected conversation into a card draft with the Host model. */
  onSynthesize?: (turns: readonly CardContextTurn[]) => Promise<CardDraft | null>
  onClose: () => void
  onSave: (draft: CardDraft) => void | Promise<void>
  onDelete?: (() => void | Promise<void>) | undefined
}

export function CardEditor({ open, mode, initial, busy, availableTurns, onSynthesize, onClose, onSave, onDelete }: CardEditorProps) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [pages, setPages] = useState<number[]>([])
  const [pageInput, setPageInput] = useState('')
  const [context, setContext] = useState<CardContextTurn[]>([])
  const [showContext, setShowContext] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setBody(initial?.body ?? '')
    setTagsText((initial?.tags ?? []).join(', '))
    setPages(normalizePages(initial?.pages ?? []))
    setPageInput('')
    setContext([...(initial?.context ?? [])])
    setShowContext((initial?.context?.length ?? 0) > 0)
    setSynthesizing(false)
  }, [open, initial])

  const contextKey = (turn: CardContextTurn): string => turn.id ?? `${turn.role}:${turn.text.slice(0, 120)}`
  const selectedKeys = new Set(context.map(contextKey))

  const toggleTurn = (turn: CardContextTurn): void => {
    const key = contextKey(turn)
    setContext((previous) =>
      previous.some((entry) => contextKey(entry) === key)
        ? previous.filter((entry) => contextKey(entry) !== key)
        : [...previous, turn],
    )
  }

  const synthesize = async (): Promise<void> => {
    if (onSynthesize === undefined || synthesizing) return
    const turns = context.length > 0 ? context : [...(availableTurns ?? [])]
    if (turns.length === 0) return
    setSynthesizing(true)
    try {
      const draft = await onSynthesize(turns)
      if (draft !== null) {
        setTitle(draft.title)
        setBody(draft.body)
        setTagsText(draft.tags.join(', '))
        setPages(normalizePages(draft.pages))
        setShowContext(true)
      }
    } finally {
      setSynthesizing(false)
    }
  }

  const canSave = title.trim() !== '' && body.trim() !== '' && !busy

  const addPage = (): void => {
    const page = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(page) || page < 1 || page > 999) {
      setPageInput('')
      return
    }
    setPages((previous) => normalizePages([...previous, page]))
    setPageInput('')
  }

  const save = (): void => {
    if (!canSave) return
    void onSave({
      title: title.trim().slice(0, 200),
      body: body.trim(),
      tags: parseTagList(tagsText),
      pages: normalizePages(pages),
      context,
    })
  }

  return (
    <Modal
      open={open}
      wide
      title={mode === 'create' ? t('cards.editorCreate') : t('cards.editorEdit')}
      description={t('cards.editorHint')}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && onDelete !== undefined ? (
            <Button variant="danger" disabled={busy} onClick={() => void onDelete()}>
              {t('cards.delete')}
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={busy}>
            {t('cards.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!canSave} onClick={save}>
            {t('cards.save')}
          </Button>
        </>
      }
    >
      <Field label={t('cards.titleLabel')} htmlFor="pd-card-title">
        <TextInput
          id="pd-card-title"
          value={title}
          maxLength={200}
          placeholder={t('cards.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label={t('cards.bodyLabel')} htmlFor="pd-card-body">
        <Textarea
          value={body}
          onChange={setBody}
          rows={10}
          placeholder={t('cards.bodyPlaceholder')}
          ariaLabel={t('cards.bodyLabel')}
        />
      </Field>
      {(availableTurns !== undefined && availableTurns.length > 0) || context.length > 0 ? (
        <div className="pd-card-context">
          <div className="pd-card-context-head">
            <button type="button" className="pd-card-context-toggle" onClick={() => setShowContext((value) => !value)}>
              {showContext ? '▾' : '▸'} {t('cards.contextLabel')} · {context.length}
            </button>
            {onSynthesize !== undefined ? (
              <Button size="sm" variant="ghost" loading={synthesizing} disabled={busy || context.length === 0} onClick={() => void synthesize()}>
                {t('cards.synthesize')}
              </Button>
            ) : null}
          </div>
          {showContext ? (
            <div className="pd-card-context-list">
              {(availableTurns !== undefined && availableTurns.length > 0 ? availableTurns : context).map((turn, index) => {
                const key = contextKey(turn)
                return (
                  <label key={`${key}-${index}`} className="pd-card-context-turn">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      onChange={() => toggleTurn(turn)}
                      disabled={busy || synthesizing}
                    />
                    <span className="pd-card-context-role">{turn.role === 'user' ? t('cards.contextUser') : t('cards.contextAssistant')}</span>
                    <span className="pd-card-context-text">{turn.text}</span>
                  </label>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      <Field label={t('cards.tagsLabel')} hint={t('cards.tagsHint')} htmlFor="pd-card-tags">
        <TextInput
          id="pd-card-tags"
          value={tagsText}
          placeholder={t('cards.tagsPlaceholder')}
          onChange={(event) => setTagsText(event.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label={t('cards.pagesLabel')} hint={t('cards.pagesHint')}>
        <div className="pd-card-pages">
          {pages.length === 0 ? <span className="pd-card-pages-empty">{t('cards.noPages')}</span> : null}
          {pages.map((page) => (
            <span key={`card-page-${page}`} className="pd-card-page-chip">
              {`p.${page}`}
              <button
                type="button"
                className="pd-chip-x"
                aria-label={t('cards.removePage', { n: page })}
                title={t('cards.removePage', { n: page })}
                onClick={() => setPages((previous) => previous.filter((value) => value !== page))}
              >
                ×
              </button>
            </span>
          ))}
          <span className="pd-card-page-add">
            <TextInput
              className="pd-card-page-input"
              value={pageInput}
              inputMode="numeric"
              aria-label={t('cards.addPage')}
              placeholder={t('cards.pagePlaceholder')}
              onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addPage()
                }
              }}
            />
            <IconButton label={t('cards.addPage')} onClick={addPage} disabled={pageInput === ''}>
              <IconPlus size={12} />
            </IconButton>
          </span>
        </div>
      </Field>
    </Modal>
  )
}

/* ── cards rail ────────────────────────────────────────────────────────── */

export interface CardsPanelProps {
  cards: readonly NoteCard[]
  loading: boolean
  onNew: () => void
  onEdit: (card: NoteCard) => void
  onInsert: (card: NoteCard) => void
  onCopy: (card: NoteCard) => void
  onDelete: (card: NoteCard) => void
  onJumpPages: (card: NoteCard, page?: number) => void
  onSummarize?: () => Promise<void>
  onMerge?: (cards: readonly NoteCard[]) => Promise<void>
}

export function CardsPanel(props: CardsPanelProps) {
  const t = useT()
  const { cards, loading, onNew, onEdit, onInsert, onCopy, onDelete, onJumpPages, onSummarize, onMerge } = props
  const [summarizing, setSummarizing] = useState(false)
  const [merging, setMerging] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [activeId, setActiveId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef(new Map<string, HTMLLIElement>())
  const currentId = cards.some((card) => card.id === activeId) ? activeId : cards[0]?.id
  const trackReadingPosition = (): void => {
    const scroll = scrollRef.current
    if (scroll === null) return
    if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 2) {
      setActiveId(cards.at(-1)?.id ?? null)
      return
    }
    const top = scroll.getBoundingClientRect().top + 80
    let current = cards[0]?.id ?? null
    for (const card of cards) {
      const element = cardRefs.current.get(card.id)
      if (element && element.getBoundingClientRect().top <= top) current = card.id
    }
    setActiveId(current)
  }

  return (
    <aside className="pd-cards-rail" aria-label={t('cards.title')}>
      <nav className="pd-notebook-outline pd-cards-directory" aria-label={t('cards.outline')}>
        <h3>{t('cards.outline')}</h3>
        {cards.length === 0 ? <p className="pd-field-hint">{t(loading ? 'cards.loading' : 'cards.empty')}</p> : cards.map((card, index) => (
          <button key={card.id} type="button" aria-current={currentId === card.id ? 'location' : undefined} onClick={() => {
            setActiveId(card.id)
            cardRefs.current.get(card.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }}>
            <span className="pd-card-outline-number">{index + 1}</span><span>{card.title}</span>
          </button>
        ))}
      </nav>
      <div className="pd-cards-main">
      <div className="pd-cards-head">
        <IconNote size={13} />
        <span>{t('cards.title')}</span>
        <span className="pd-badge" data-kind="local">
          {t('cards.count', { n: cards.length })}
        </span>
        <span className="pd-cards-head-spacer" />
        {onMerge !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            loading={merging}
            disabled={selected.size < 2}
            onClick={() => {
              const chosen = cards.filter((card) => selected.has(card.id))
              if (chosen.length < 2) return
              setMerging(true)
              void onMerge(chosen).finally(() => {
                setMerging(false)
                setSelected(new Set())
              })
            }}
          >
            {t('cards.mergeSelected', { n: selected.size })}
          </Button>
        ) : null}
        {onSummarize !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            loading={summarizing}
            disabled={cards.length === 0 || loading}
            onClick={() => {
              setSummarizing(true)
              void onSummarize().finally(() => setSummarizing(false))
            }}
          >
            {t('cards.summarize')}
          </Button>
        ) : null}
        <IconButton label={t('cards.create')} onClick={onNew}>
          <IconPlus size={12} />
        </IconButton>
      </div>
      <div className="pd-cards-scroll" ref={scrollRef} onScroll={trackReadingPosition}>
        {loading ? (
          <div className="pd-loading-block">
            <Spinner size={12} label={t('cards.loading')} />
            <span>{t('cards.loading')}</span>
          </div>
        ) : cards.length === 0 ? (
          <EmptyState
            icon={<IconNote size={20} />}
            title={t('cards.empty')}
            description={t('cards.emptyHint')}
            action={
              <Button size="sm" icon={<IconPlus size={12} />} onClick={onNew}>
                {t('cards.create')}
              </Button>
            }
          />
        ) : (
          <ul className="pd-card-list">
            {cards.map((card) => (
              <li key={card.id} className="pd-card-item" ref={(element) => {
                if (element) cardRefs.current.set(card.id, element)
                else cardRefs.current.delete(card.id)
              }}>
                {onMerge !== undefined ? (
                  <label className="pd-card-select" title={t('cards.mergeSelect')}>
                    <input
                      type="checkbox"
                      checked={selected.has(card.id)}
                      onChange={(event) => {
                        setSelected((previous) => {
                          const next = new Set(previous)
                          if (event.target.checked) next.add(card.id)
                          else next.delete(card.id)
                          return next
                        })
                      }}
                    />
                  </label>
                ) : null}
                <button type="button" className="pd-card-locate" onClick={() => onEdit(card)} title={t('cards.edit')}>
                  <span className="pd-card-title">{card.title}</span>
                </button>
                <Markdown markdown={card.body} className="pd-card-body" />
                {(card.tags.length > 0 || card.pages.length > 0 || (card.context?.length ?? 0) > 0) ? (
                  <div className="pd-card-meta">
                    {(card.context?.length ?? 0) > 0 ? (
                      <span className="pd-tag">{t('cards.contextCount', { n: card.context?.length ?? 0 })}</span>
                    ) : null}
                    {card.pages.map((page) => (
                      <button
                        key={`${card.id}-page-${page}`}
                        type="button"
                        className="pd-card-page-chip pd-card-page-jump"
                        title={t('cards.jumpPages')}
                        onClick={() => onJumpPages(card, page)}
                      >
                        {`p.${page}`}
                      </button>
                    ))}
                    {card.tags.slice(0, 3).map((tag) => (
                      <span key={`${card.id}-tag-${tag}`} className="pd-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="pd-card-actions">
                  <Button size="sm" variant="ghost" icon={<IconEdit size={12} />} onClick={() => onEdit(card)}>
                    {t('cards.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onInsert(card)}>
                    {t('cards.insert')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onCopy(card)}>
                    {t('cards.copy')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconTrash size={12} />}
                    onClick={() => onDelete(card)}
                  >
                    {t('cards.delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </aside>
  )
}
