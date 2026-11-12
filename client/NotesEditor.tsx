/**
 * Markdown notes editor for one paper. Owns the draft, dirty tracking, Cmd/Ctrl+S
 * save, optimistic-concurrency conflict banner and the "append quote with page"
 * flow. The actual HTTP calls arrive as callbacks from `App`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NotesDocument, NotesWriteResult } from '../src/types.js'
import { IconCheck, IconNote, IconQuote, IconSave, IconWarning } from './icons.js'
import { createAutosaveQueue } from './autosave.js'
import type { AutosaveQueue } from './autosave.js'
import { errorText, useT } from './i18n.js'
import { noteOutline, renderMarkdownSectioned } from './markdown.js'
import { Button, Modal, TextInput, Textarea } from './ui.js'

type ToastKind = 'info' | 'success' | 'error' | 'warn'
type ToastPush = (kind: ToastKind, message: string) => void

export interface NotesEditorProps {
  notes: NotesDocument | null
  onReadSource: () => void
  disabled?: boolean
  onSave: (markdown: string, baseHash?: string) => Promise<NotesWriteResult>
  onReload: () => Promise<NotesDocument>
  onAppendQuote: (text: string, page?: number) => Promise<NotesWriteResult>
  onDirtyChange: (dirty: boolean) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
  onToast: ToastPush
}

export function NotesEditor(props: NotesEditorProps) {
  const t = useT()
  const { notes, disabled = false, onSave, onReload, onAppendQuote, onDirtyChange, registerSave, onToast } = props

  const initialMarkdown = notes?.markdown ?? ''
  const [draft, setDraft] = useState(initialMarkdown)
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown)
  const [baseHash, setBaseHash] = useState(notes?.hash ?? '')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<NotesWriteResult | null>(null)
  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [activeSection, setActiveSection] = useState(0)
  const [appendOpen, setAppendOpen] = useState(false)
  const [appendText, setAppendText] = useState('')
  const [appendPage, setAppendPage] = useState('')

  const dirty = draft !== savedMarkdown

  const draftRef = useRef(draft)
  const baseHashRef = useRef(baseHash)
  const dirtyRef = useRef(dirty)
  const savingRef = useRef(saving)
  const notesRef = useRef(notes)
  const savedMarkdownRef = useRef(savedMarkdown)
  draftRef.current = draft
  baseHashRef.current = baseHash
  dirtyRef.current = dirty
  savingRef.current = saving
  notesRef.current = notes
  savedMarkdownRef.current = savedMarkdown

  const previewRef = useRef<HTMLDivElement | null>(null)
  const outline = useMemo(() => noteOutline(draft), [draft])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  /* ── autosave (400 ms debounce, serialized, does not replace explicit save) ── */

  const onSaveRef = useRef(onSave)
  const onToastRef = useRef(onToast)
  const tRef = useRef(t)
  const conflictRef = useRef<NotesWriteResult | null>(null)
  const disabledRef = useRef(disabled)
  onSaveRef.current = onSave
  onToastRef.current = onToast
  tRef.current = t
  conflictRef.current = conflict
  disabledRef.current = disabled

  const writeRef = useRef<(markdown: string) => Promise<void>>(async () => {})

  const autosaveRef = useRef<AutosaveQueue | null>(null)
  if (autosaveRef.current === null) {
    autosaveRef.current = createAutosaveQueue({
      write: (markdown) => writeRef.current(markdown),
      onError: (error) => {
        const detail = errorText(error)
        /* A conflict already shows its own banner + toast from the write path. */
        if (detail === tRef.current('notes.conflict.title')) return
        onToastRef.current(
          'warn',
          detail !== '' ? `${tRef.current('notes.autosaveFailed')} · ${detail}` : tRef.current('notes.autosaveFailed'),
        )
      },
    })
  }

  writeRef.current = async (markdown: string): Promise<void> => {
    const base = baseHashRef.current !== '' ? baseHashRef.current : undefined
    const result = await onSaveRef.current(markdown, base)
    if (!result.ok) {
      if (result.conflict) {
        conflictRef.current = result
        setConflict(result)
        throw new Error(tRef.current('notes.conflict.title'))
      }
      throw new Error(tRef.current('notes.saveFailed'))
    }
    setBaseHash(result.notes.hash)
    baseHashRef.current = result.notes.hash
    setSavedMarkdown(result.notes.markdown)
    savedMarkdownRef.current = result.notes.markdown
    setConflict(null)
    conflictRef.current = null
    autosaveRef.current?.markSaved(result.notes.markdown)
  }

  const scheduleAutosave = useCallback((next: string): void => {
    const queue = autosaveRef.current
    if (queue === null || disabledRef.current || conflictRef.current !== null) return
    if (next === savedMarkdownRef.current) {
      queue.cancel()
      return
    }
    queue.schedule(next)
  }, [])

  /* Flush pending autosave when the page is hidden/unloaded (tab close/reload). */
  useEffect(() => {
    const flush = (): void => {
      void autosaveRef.current?.flush()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      /* Paper switches are guarded by App (save/discard): never write a
         discarded draft on unmount, just drop the pending debounce. */
      autosaveRef.current?.dispose()
    }
  }, [])

  /* Adopt disk versions pushed by the parent (reload, agent append, …). */
  useEffect(() => {
    const incoming = notes?.markdown ?? ''
    const incomingHash = notes?.hash ?? ''
    if (dirtyRef.current) return
    if (incomingHash === baseHashRef.current && incoming === savedMarkdownRef.current) return
    setDraft(incoming)
    setSavedMarkdown(incoming)
    setBaseHash(incomingHash)
    baseHashRef.current = incomingHash
    autosaveRef.current?.markSaved(incoming)
  }, [notes?.hash, notes?.markdown])

  /* Report dirty state to the shell (unsaved-changes guard). */
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    return () => {
      onDirtyChange(false)
    }
  }, [onDirtyChange])

  const save = useCallback(
    async (overwrite = false): Promise<boolean> => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const queue = autosaveRef.current
        queue?.cancel()
        if (!overwrite) await queue?.wait()
        const markdown = draftRef.current
        const base = overwrite ? undefined : baseHashRef.current !== '' ? baseHashRef.current : undefined
        const result = await onSave(markdown, base)
        if (result.ok) {
          setBaseHash(result.notes.hash)
          baseHashRef.current = result.notes.hash
          setSavedMarkdown(result.notes.markdown)
          savedMarkdownRef.current = result.notes.markdown
          setConflict(null)
          conflictRef.current = null
          autosaveRef.current?.markSaved(result.notes.markdown)
          onToast('success', t('notes.saved'))
          return true
        }
        if (result.conflict) {
          conflictRef.current = result
          setConflict(result)
          onToast('warn', t('notes.conflict.title'))
          return false
        }
        onToast('error', t('notes.saveFailed'))
        return false
      } catch (error) {
        onToast('error', errorText(error) || t('notes.saveFailed'))
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [onSave, onToast, t],
  )

  const saveRef = useRef(save)
  saveRef.current = save

  /* Expose the save action to the shell so switching papers can save first. */
  useEffect(() => {
    registerSave(() => saveRef.current(false))
    return () => registerSave(null)
  }, [registerSave])

  /* Cmd/Ctrl+S anywhere while the editor is mounted. */
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
        event.preventDefault()
        void saveRef.current(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled])

  const useDiskVersion = useCallback(async (): Promise<void> => {
    try {
      const fresh = await onReload()
      setDraft(fresh.markdown)
      setSavedMarkdown(fresh.markdown)
      setBaseHash(fresh.hash)
      baseHashRef.current = fresh.hash
      setConflict(null)
      conflictRef.current = null
      savedMarkdownRef.current = fresh.markdown
      autosaveRef.current?.cancel()
      autosaveRef.current?.markSaved(fresh.markdown)
      onToast('success', t('notes.conflict.diskLoaded'))
    } catch (error) {
      onToast('error', errorText(error) || t('notes.loadFailed'))
    }
  }, [onReload, onToast, t])

  const jumpToSection = (sectionIndex: number): void => {
    const section = outline[sectionIndex]
    if (section === undefined) return
    setActiveSection(sectionIndex)
    if (mode === 'preview') {
      const heading = previewRef.current?.querySelectorAll('.pd-md > h2')[sectionIndex]
      heading?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.focus()
    textarea.setSelectionRange(section.offset, section.offset)
    const line = draft.slice(0, section.offset).split('\n').length - 1
    const total = Math.max(draft.split('\n').length, 1)
    textarea.scrollTop = Math.floor((line / total) * textarea.scrollHeight)
  }

  const openAppend = useCallback((): void => {
    if (dirtyRef.current) {
      onToast('warn', t('notes.appendQuote.saveFirst'))
      return
    }
    setAppendText('')
    setAppendPage('')
    setAppendOpen(true)
  }, [onToast, t])

  const confirmAppend = useCallback(async (): Promise<void> => {
    const text = appendText.trim()
    if (text === '') {
      onToast('warn', t('notes.appendQuote.empty'))
      return
    }
    if (dirtyRef.current) {
      onToast('warn', t('notes.appendQuote.saveFirst'))
      return
    }
    const pageNumber = Number.parseInt(appendPage, 10)
    const page = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined
    try {
      const result = await onAppendQuote(text, page)
      if (result.ok) {
        setDraft(result.notes.markdown)
        setSavedMarkdown(result.notes.markdown)
        setBaseHash(result.notes.hash)
        baseHashRef.current = result.notes.hash
        setConflict(null)
        conflictRef.current = null
        autosaveRef.current?.cancel()
        autosaveRef.current?.markSaved(result.notes.markdown)
        setAppendOpen(false)
        onToast('success', t('notes.appendQuote.appended'))
        return
      }
      if (result.conflict) setConflict(result)
      onToast('error', t('notes.appendQuote.failed'))
    } catch (error) {
      onToast('error', errorText(error) || t('notes.appendQuote.failed'))
    }
  }, [appendPage, appendText, onAppendQuote, onToast, t])

  const previewHtml = useMemo(() => (mode === 'preview' ? renderMarkdownSectioned(draft) : ''), [draft, mode])

  return (
    <div className="pd-notebook-editor">
      <nav className="pd-notebook-outline" aria-label={t('notes.outline')}>
        <h3>{t('notes.outline')}</h3>
        {outline.length === 0 ? <p className="pd-field-hint">{t('notes.outlineEmpty')}</p> : outline.map((section, index) => (
          <button key={`${index}-${section.label}`} type="button" aria-current={index === activeSection ? 'location' : undefined} onClick={() => jumpToSection(index)}>{section.label}</button>
        ))}
      </nav>
      <div className="pd-notes" data-mode={mode}>
      {conflict !== null ? (
        <div className="pd-conflict" role="alert">
          <div className="pd-conflict-head">
            <IconWarning />
            <span>{t('notes.conflict.title')}</span>
          </div>
          <div className="pd-conflict-desc">{t('notes.conflict.desc')}</div>
          {conflict.conflictPath !== undefined ? (
            <div className="pd-conflict-path">{t('notes.conflict.path', { path: conflict.conflictPath })}</div>
          ) : null}
          <div className="pd-conflict-actions">
            <Button size="sm" variant="primary" loading={saving} onClick={() => void save(true)}>
              {t('notes.conflict.useMine')}
            </Button>
            <Button size="sm" loading={saving} onClick={() => void useDiskVersion()}>
              {t('notes.conflict.useDisk')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="pd-notes-toolbar">
        <span className="pd-notes-toolbar-spacer" />
        {mode === 'preview' ? (
          <Button variant="primary" icon={<IconNote />} onClick={() => setMode('edit')}>{t('notes.editDocument')}</Button>
        ) : (
          <>
            <Button onClick={() => setMode('preview')}>{t('notes.readPreview')}</Button>
            <Button variant="primary" icon={<IconSave />} loading={saving} disabled={disabled || !dirty} onClick={() => void save(false)} title={t('notes.saveShortcut')}>
              {saving ? t('notes.saving') : t('notes.save')}
            </Button>
          </>
        )}
        <Button onClick={props.onReadSource}>{t('notes.readSource')}</Button>
        {mode === 'edit' ? <Button size="sm" variant="ghost" icon={<IconQuote />} onClick={openAppend} disabled={disabled}>{t('notes.appendQuote')}</Button> : null}
      </div>

      <div className="pd-notes-body">
        {mode === 'edit' ? (
          <div className="pd-notes-editor">
            <textarea
              ref={textareaRef}
              className="pd-notes-textarea"
              aria-label={t('aria.notesEditor')}
              placeholder={t('notes.placeholder')}
              value={draft}
              spellCheck={false}
              onChange={(event) => {
                const next = event.target.value
                setDraft(next)
                scheduleAutosave(next)
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
                  event.preventDefault()
                  void save(false)
                }
              }}
            />
          </div>
        ) : (
          <div className="pd-notes-preview" ref={previewRef}>
            {draft.trim() === '' ? (
              <span className="pd-inline-empty">{t('notes.placeholder')}</span>
            ) : (
              <div className="pd-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </div>
        )}
      </div>

      <div className="pd-notes-status">
        {dirty ? (
          <span className="pd-notes-dirty">
            <IconNote size={12} />
            {t('notes.dirtyHint')}
          </span>
        ) : (
          <span className="pd-notes-saved">
            <IconCheck size={12} />
            {t('notes.cleanHint')}
          </span>
        )}
        <span className="pd-notes-status-spacer" />
        <span>{t('reader.text.chars', { n: draft.length })}</span>
      </div>

      </div>
      <Modal
        open={appendOpen}
        title={t('notes.appendQuote.title')}
        description={t('notes.appendQuote.desc')}
        onClose={() => setAppendOpen(false)}
        footer={
          <>
            <Button onClick={() => setAppendOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => void confirmAppend()}>
              {t('notes.appendQuote.append')}
            </Button>
          </>
        }
      >
        <label className="pd-field">
          <span className="pd-field-label">{t('notes.appendQuote.text')}</span>
          <Textarea
            value={appendText}
            onChange={setAppendText}
            rows={5}
            placeholder={t('notes.appendQuote.placeholder')}
            ariaLabel={t('notes.appendQuote.text')}
          />
        </label>
        <label className="pd-field">
          <span className="pd-field-label">
            {t('notes.appendQuote.page')} <span className="pd-field-hint">({t('notes.appendQuote.pageHint')})</span>
          </span>
          <TextInput
            value={appendPage}
            inputMode="numeric"
            placeholder="1"
            onChange={(event) => setAppendPage(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </label>
      </Modal>
    </div>
  )
}
