import { useId, useState } from 'react'
import { useT } from './i18n.js'

/** Expand in place so every tag remains readable at the current reader width. */
export function ReaderTags({ tags }: { tags: readonly string[] }) {
  const t = useT(), id = useId()
  const [open, setOpen] = useState(false)
  if (!tags.length) return null
  return <div className="pd-reader-tags" data-expanded={open} role="group" aria-label={t('meta.tags')}>
    <div id={id} className="pd-reader-tag-list">{(open ? tags : tags.slice(0, 2)).map((tag) =>
      <span key={tag} className="pd-tag pd-reader-tag-preview" title={tag}>{tag}</span>)}</div>
    {tags.length > 2 ? <button type="button" className="pd-reader-tags-toggle"
      aria-label={t(open ? 'reader.collapseTags' : 'reader.expandTags', { n: tags.length })}
      aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      {open ? t('reader.collapseTags') : `+${tags.length - 2}`}
    </button> : null}
  </div>
}
