/**
 * Markdown notes editor for one paper. Owns the draft, dirty tracking, Cmd/Ctrl+S
 * save, optimistic-concurrency conflict banner and the "append quote with page"
 * flow. The actual HTTP calls arrive as callbacks from `App`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NotesDocument, NotesWriteResult } from '../src/types.js'
import { IconCheck, IconNote, IconQuote, IconSave, IconWarning } from './icons.js'
import { errorText, useT } from './i18n.js'
import { renderMarkdown } from './markdown.js'
import { Button, Modal, TextInput, Textarea } from './ui.js'

type ToastKind = 'info' | 'success' | 'error' | 'warn'
type ToastPush = (kind: ToastKind, message: string) => void

type SectionKey = 'summary' | 'points' | 'questions' | 'quotes' | 'thoughts' | 'conversation'

const SECTIONS: readonly { key: SectionKey; zh: string; en: string }[] = [
  { key: 'summary', zh: '摘要', en: 'Summary' },
  { key: 'points', zh: '要点', en: 'Key points' },
  { key: 'questions', zh: '疑问', en: 'Open questions' },
  { key: 'quotes', zh: '引用', en: 'Quotes' },
  { key: 'thoughts', zh: '我的想法', en: 'My take' },
  { key: 'conversation', zh: '对话与补充', en: 'Conversation notes' },
]

export interface NotesEditorProps {
  notes: NotesDocument | null
  disabled?: boolean
  onSave: (markdown: string, baseHash?: string) => Promise<NotesWriteResult>
  onReload: () => Promise<NotesDocument>
  onAppendQuote: (text: string, page?: number) => Promise<NotesWriteResult>
  onDirtyChange: (dirty: boolean) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
  onToast: ToastPush
}

function headingIndex(markdown: string, section: SectionKey): number {
  const entry = SECTIONS.find((candidate) => candidate.key === section)
  if (entry === undefined) return -1
  const zh = markdown.indexOf(`## ${entry.zh}`)
  const en = markdown.indexOf(`## ${entry.en}`)
  if (zh < 0) return en
  if (en < 0) return zh
  return Math.min(zh, en)
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
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
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

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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
        const markdown = draftRef.current
        const base = overwrite ? undefined : baseHashRef.current !== '' ? baseHashRef.current : undefined
        const result = await onSave(markdown, base)
        if (result.ok) {
          setBaseHash(result.notes.hash)
          baseHashRef.current = result.notes.hash
          setSavedMarkdown(result.notes.markdown)
          setConflict(null)
          onToast('success', t('notes.saved'))
          return true
        }
        if (result.conflict) {
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
      onToast('success', t('notes.conflict.diskLoaded'))
    } catch (error) {
      onToast('error', errorText(error) || t('notes.loadFailed'))
    }
  }, [onReload, onToast, t])

  const jumpToSection = useCallback((section: SectionKey): void => {
    const textarea = textareaRef.current
    if (textarea === null) return
    const index = headingIndex(draftRef.current, section)
    if (index < 0) {
      onToast('info', t('notes.sections'))
      return
    }
    textarea.focus()
    textarea.setSelectionRange(index, index)
    const before = draftRef.current.slice(0, index)
    const line = before.split('\n').length - 1
    const total = Math.max(draftRef.current.split('\n').length, 1)
    const viewport = Math.max(textarea.scrollHeight - textarea.clientHeight, 0)
    textarea.scrollTop = Math.floor((line / total) * viewport)
  }, [onToast, t])

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

  const sectionOptions = useMemo(
    () => SECTIONS.map((section) => ({ value: section.key, label: t(`notes.section.${section.key}`) })),
    [t],
  )

  const previewHtml = useMemo(() => (mode === 'preview' ? renderMarkdown(draft) : ''), [draft, mode])

  return (
    <div className="pd-notes">
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
        <Button size="sm" variant={mode === 'edit' ? 'default' : 'ghost'} onClick={() => setMode('edit')}>
          {t('notes.edit')}
        </Button>
        <Button size="sm" variant={mode === 'preview' ? 'default' : 'ghost'} onClick={() => setMode('preview')}>
          {t('notes.preview')}
        </Button>
        <span className="pd-notes-toolbar-spacer" />
        <select
          className="pd-select pd-select-sm"
          aria-label={t('notes.sections')}
          title={t('notes.sections')}
          value=""
          onChange={(event) => {
            const value = event.target.value
            if (value !== '') jumpToSection(value as SectionKey)
            event.target.value = ''
          }}
        >
          <option value="">{t('notes.sections')}</option>
          {sectionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button size="sm" icon={<IconQuote />} onClick={openAppend} disabled={disabled}>
          {t('notes.appendQuote')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<IconSave />}
          loading={saving}
          disabled={disabled || !dirty}
          onClick={() => void save(false)}
          title={t('notes.saveShortcut')}
        >
          {saving ? t('notes.saving') : t('notes.save')}
        </Button>
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
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
                  event.preventDefault()
                  void save(false)
                }
              }}
            />
          </div>
        ) : (
          <div className="pd-notes-preview">
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
