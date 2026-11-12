import { useEffect, useState } from 'react'
import { renderPageImages } from './pageImages.js'
import { useT } from './i18n.js'
import { Button, Spinner } from './ui.js'

/** A local rendering of the actual PDF; no network source beyond the library. */
export function NotebookReference({ pdfUrl, available, title, pages, onJump }: {
  pdfUrl: string
  available: boolean
  title: string
  pages: readonly number[]
  onJump: (page: number) => void
}) {
  const t = useT()
  const [image, setImage] = useState('')
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setImage('')
    setFailed(false)
    if (available) void renderPageImages(pdfUrl, [1]).then((images) => {
      if (active && images[0]) setImage(`data:image/jpeg;base64,${images[0].data}`)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [available, pdfUrl, retry])
  return (
    <aside className="pd-notebook-reference" aria-label={t('notes.source')}>
      <h3>{t('notes.source')}</h3>
      {available ? image ? (
        <button type="button" className="pd-notebook-cover" onClick={() => onJump(1)} title={t('notes.readSource')}>
          <img src={image} alt={`${title} · p.1`} />
        </button>
      ) : failed ? (
        <div className="pd-notebook-source-error"><p>{t('notes.sourceFailed')}</p><Button size="sm" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button></div>
      ) : <Spinner /> : <p className="pd-field-hint">{t('notes.sourceMissing')}</p>}
      <p className="pd-notebook-source-title">{title}</p>
      <h3>{t('notes.relatedPages')}</h3>
      {pages.length === 0 ? <p className="pd-field-hint">{t('notes.noPages')}</p> : (
        <div className="pd-notebook-page-links">{pages.map((page) => (
          <button key={page} type="button" disabled={!available} onClick={() => onJump(page)}>{`p.${page}`}</button>
        ))}</div>
      )}
    </aside>
  )
}
