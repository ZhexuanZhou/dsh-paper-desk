import { useEffect, useId, useRef, useState } from 'react'
import { useT } from './i18n.js'

/** Two quiet tag previews; the disclosure exposes every tag without clipping. */
export function ReaderTags({ tags }: { tags: readonly string[] }) {
  const t = useT(), id = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation(); setOpen(false); triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', closeOutside, true)
    document.addEventListener('keydown', closeByKey, true)
    return () => {
      document.removeEventListener('mousedown', closeOutside, true)
      document.removeEventListener('keydown', closeByKey, true)
    }
  }, [open])
  if (!tags.length) return null
  return <div className="pd-reader-tags" ref={rootRef}>
    {tags.slice(0, 2).map((tag) => <span key={tag} className="pd-tag pd-reader-tag-preview" title={tag}>{tag}</span>)}
    <button type="button" className="pd-reader-tags-toggle" data-extra={tags.length > 2} ref={triggerRef}
      aria-label={`${t('meta.tags')} · ${tags.length}`} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen((value) => !value)}>
      <span className="pd-reader-tags-more">{tags.length > 2 ? `+${tags.length - 2}` : ''}</span>
      <span className="pd-reader-tags-count">{t('meta.tags')} {tags.length}</span>
    </button>
    {open ? <div id={id} className="pd-reader-tags-panel" role="group" aria-label={t('meta.tags')}>
      <strong>{t('meta.tags')} · {tags.length}</strong><div>{tags.map((tag) => <span key={tag} className="pd-tag">{tag}</span>)}</div>
    </div> : null}
  </div>
}
