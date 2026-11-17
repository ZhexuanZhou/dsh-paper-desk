import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useT } from './i18n.js'
import { IconImport, IconLink } from './icons.js'
import { Button, Modal, Spinner, TextInput } from './ui.js'

export interface ImportDialogProps {
  open: boolean
  importing: boolean
  urlBusy: boolean
  url: string
  error: string | null
  onUrlChange: (value: string) => void
  onUrlSubmit: () => void
  onPickFiles: () => void
  onFiles: (files: File[]) => void
  onClose: () => void
}

export function ImportDialog(props: ImportDialogProps) {
  const t = useT()
  const id = useId()
  const [mode, setMode] = useState<'file' | 'link'>('file')
  const [dragging, setDragging] = useState(false)
  const tabsRef = useRef<HTMLDivElement>(null)
  const busy = props.importing || props.urlBusy
  const switchByKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'file' : event.key === 'End' ? 'link' : mode === 'file' ? 'link' : 'file'
    setMode(next)
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus()
  }

  return <Modal open={props.open} title={t('import.button')} className="pd-import-dialog" onClose={props.onClose}>
    <p className="pd-import-intro">{t('import.intro')}</p>
    <div ref={tabsRef} className="pd-import-tabs" role="tablist" aria-label={t('import.method')}>
      {(['file', 'link'] as const).map((item) => <button key={item} type="button" role="tab"
        id={`${id}-${item}`} data-mode={item} aria-selected={mode === item} aria-controls={`${id}-panel`}
        tabIndex={mode === item ? 0 : -1} disabled={busy} onKeyDown={switchByKey} onClick={() => setMode(item)}>
        {item === 'file' ? <IconImport size={15} /> : <IconLink size={15} />}
        {t(item === 'file' ? 'import.fileTab' : 'import.linkTab')}
      </button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${mode}`} className="pd-import-panel" aria-busy={busy}>
      {mode === 'file' ? <div className="pd-import-dropzone" data-dragging={dragging}
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) setDragging(true) }}
        onDragLeave={(event) => { const next = event.relatedTarget; if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); if (!busy) props.onFiles(Array.from(event.dataTransfer.files)) }}>
        <span className="pd-import-mark"><IconImport size={24} /></span>
        <h3>{t('import.dropTitle')}</h3>
        <p>{t('import.hint')}</p>
        <Button variant="primary" disabled={busy} onClick={props.onPickFiles}>{t('import.chooseFiles')}</Button>
      </div> : <form className="pd-import-url-form" onSubmit={(event) => { event.preventDefault(); if (!busy) props.onUrlSubmit() }}>
        <label htmlFor={`${id}-url`}>{t('import.urlLabel')}</label>
        <TextInput id={`${id}-url`} value={props.url} inputMode="url" autoComplete="off"
          placeholder={t('import.urlPlaceholder')} disabled={busy} invalid={props.error !== null}
          aria-describedby={`${id}-help${props.error ? ` ${id}-error` : ''}`}
          onChange={(event) => props.onUrlChange(event.target.value)} />
        <div id={`${id}-help`} className="pd-import-url-help">
          <p>{t('import.urlHint')}</p>
          <p>{t('import.urlLimit')}</p>
        </div>
        {props.error ? <div id={`${id}-error`} className="pd-import-error" role="alert">{props.error}</div> : null}
        <Button type="submit" variant="primary" loading={props.urlBusy} disabled={busy || !props.url.trim()}>{t('import.urlSubmit')}</Button>
      </form>}
    </div>
    {busy ? <div className="pd-import-status" role="status">
      <Spinner size={14} /><div><strong>{t(props.urlBusy ? 'import.urlImporting' : 'import.importing')}</strong><p>{t('import.background')}</p></div>
    </div> : <p className="pd-import-footnote">{t('import.afterImport')}</p>}
  </Modal>
}
