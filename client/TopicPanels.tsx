import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { clampTopicWidth, DEFAULT_TOPIC_LAYOUT, readTopicLayout, topicWidthRange } from './topicLayout.js'
import type { TopicLayoutSettings, TopicSide } from './topicLayout.js'
import { browserDraftStore } from './topicDraft.js'
import { useT } from './i18n.js'

export function useTopicPanels(hasChat: boolean) {
  const rootRef = useRef<HTMLElement>(null)
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)
  const attachRoot = useCallback((node: HTMLElement | null) => { rootRef.current = node; setRootElement(node) }, [])
  const [settings, setSettings] = useState(() => readTopicLayout(browserDraftStore()))
  const current = useRef(settings); current.current = settings
  const [available, setAvailable] = useState(1400)
  const [overlay, setOverlay] = useState<TopicSide | null>(null)
  const cleanupDrag = useRef<(() => void) | null>(null)
  const compact = available < 1080
  const listOpen = compact ? overlay === 'list' : !settings.listClosed
  const chatOpen = hasChat && (compact ? overlay === 'chat' : !settings.chatClosed)
  useEffect(() => {
    const node = rootElement
    if (!node) return
    const observer = new ResizeObserver(() => setAvailable(node.clientWidth))
    setAvailable(node.clientWidth); observer.observe(node)
    return () => { observer.disconnect(); cleanupDrag.current?.() }
  }, [rootElement])
  useEffect(() => { setOverlay(null) }, [compact])
  const persist = (next: TopicLayoutSettings) => {
    setSettings(next)
    try { browserDraftStore()?.setItem('paperdesk:topic-layout', JSON.stringify(next)) } catch { /* Width memory is optional. */ }
  }
  const otherWidth = (side: TopicSide) => side === 'list' ? chatOpen ? settings.chatWidth : 0 : listOpen ? settings.listWidth : 0
  const width = (side: TopicSide) => clampTopicWidth(side === 'list' ? settings.listWidth : settings.chatWidth, side, available, otherWidth(side))
  const setWidth = (side: TopicSide, value: number) => persist({ ...current.current, [side === 'list' ? 'listWidth' : 'chatWidth']: clampTopicWidth(value, side, available, otherWidth(side)) })
  const toggle = (side: TopicSide) => {
    if (compact) setOverlay((current) => current === side ? null : side)
    else persist({ ...current.current, [side === 'list' ? 'listClosed' : 'chatClosed']: side === 'list' ? listOpen : chatOpen })
  }
  const reveal = (side: TopicSide) => {
    if (compact) setOverlay(side)
    else persist({ ...current.current, [side === 'list' ? 'listClosed' : 'chatClosed']: false })
  }
  const beginResize = (side: TopicSide, event: ReactPointerEvent<HTMLDivElement>) => {
    if (compact || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault(); cleanupDrag.current?.()
    const root = rootRef.current
    if (!root) return
    const initialX = event.clientX, initialWidth = width(side), variable = side === 'list' ? '--pd-topic-list-width' : '--pd-topic-chat-width'
    const apply = (x: number) => { const next = clampTopicWidth(initialWidth + (x - initialX) * (side === 'list' ? 1 : -1), side, available, otherWidth(side)); root.style.setProperty(variable, `${next}px`); return next }
    let frame: number | null = null, lastX = initialX
    const move = (event: PointerEvent) => { lastX = event.clientX; if (frame === null) frame = requestAnimationFrame(() => { frame = null; apply(lastX) }) }
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape)
      if (frame !== null) cancelAnimationFrame(frame)
      delete root.dataset.resizing; cleanupDrag.current = null
    }
    const end = (event: PointerEvent) => { cleanup(); setWidth(side, apply(event.clientX)) }
    const cancel = () => { cleanup(); root.style.setProperty(variable, `${initialWidth}px`) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }
    root.dataset.resizing = side
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', escape)
    cleanupDrag.current = cancel
  }
  return { rootRef: attachRoot, compact, listOpen, chatOpen, overlay, setOverlay, toggle, reveal, beginResize, setWidth, width,
    range: (side: TopicSide) => topicWidthRange(side, available, otherWidth(side)),
    style: { '--pd-topic-list-width': `${width('list')}px`, '--pd-topic-chat-width': `${width('chat')}px` } as CSSProperties }
}
export function TopicDivider({ side, panels }: { side: TopicSide; panels: ReturnType<typeof useTopicPanels> }) {
  const t = useT(), open = side === 'list' ? panels.listOpen : panels.chatOpen, range = panels.range(side)
  return <div className={`pd-topic-divider pd-topic-divider-${side}`} data-open={open}>
    {!panels.compact && open ? <div className="pd-topic-resizer" role="separator" aria-orientation="vertical" aria-label={t(side === 'list' ? 'research.resizeList' : 'research.resizeChat')}
      aria-valuemin={range.min} aria-valuemax={range.max} aria-valuenow={panels.width(side)} aria-controls={`pd-topic-${side}`} tabIndex={0}
      title={t('research.resizeHint')} onPointerDown={(event) => panels.beginResize(side, event)}
      onDoubleClick={() => panels.setWidth(side, side === 'list' ? DEFAULT_TOPIC_LAYOUT.listWidth : DEFAULT_TOPIC_LAYOUT.chatWidth)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const direction = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'list' ? 1 : -1)
        panels.setWidth(side, event.key === 'Home' ? range.min : event.key === 'End' ? range.max : panels.width(side) + direction * (event.shiftKey ? 80 : 20))
      }} /> : null}
    <button type="button" className="pd-topic-toggle" aria-controls={`pd-topic-${side}`} aria-expanded={open}
      aria-label={t(side === 'list' ? open ? 'research.closeList' : 'research.openList' : open ? 'research.closeChat' : 'research.openChat')}
      title={t(side === 'list' ? open ? 'research.closeList' : 'research.openList' : open ? 'research.closeChat' : 'research.openChat')}
      onPointerDown={(event) => event.stopPropagation()} onClick={() => panels.toggle(side)}>{side === 'list' ? open ? '‹' : '›' : open ? '›' : '‹'}</button>
  </div>
}
