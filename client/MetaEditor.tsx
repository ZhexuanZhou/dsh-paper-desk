/** Automatically persisted metadata with a reversible, server-checked last edit. */
import { createMetadataAutosave } from './metadataAutosave.js'
import type { MetaForm } from './metaForm.js'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PaperMeta, PaperStatus } from '../src/types.js'
import type { MetadataUndo } from '../src/types.js'
import { api } from './api.js'
import { IconExternal, IconRefresh } from './icons.js'
import { errorText, formatBytes, formatDateTime, sourceLabel, statusLabel, useLang, useT } from './i18n.js'
import { Button, Field, Rating, Select, TextInput, Textarea } from './ui.js'

type ToastKind = 'info' | 'success' | 'error' | 'warn'
type ToastPush = (kind: ToastKind, message: string) => void


export interface MetaEditorProps {
  meta: PaperMeta
  pdfBytes: number
  pdfEvicted: boolean
  busy: boolean
  libraryPath: string
  supported: boolean
  onApplied: (meta: PaperMeta, libraryPath: string) => void
  onEnrich: () => Promise<void>
  onLlmEnrich: () => Promise<void>
  onToast: ToastPush
}

const STATUSES: readonly PaperStatus[] = ['unread', 'reading', 'read', 'archived']

export function MetaEditor({ meta, pdfBytes, pdfEvicted, busy, libraryPath, supported, onApplied, onEnrich, onLlmEnrich, onToast }: MetaEditorProps) {
  const t = useT()
  const lang = useLang()
  const applied = useRef(onApplied)
  applied.current = onApplied
  const save = useMemo(() => createMetadataAutosave(meta, {
    save: async (patch, expected) => (await api.patchPaper(meta.id, patch, expected, libraryPath)).meta,
    applied: (incoming) => applied.current(incoming, libraryPath),
    draftKey: supported ? `paperdesk:metadata-draft:${libraryPath}:${meta.id}` : undefined,
  }), [meta.id, libraryPath, supported])
  const state = useSyncExternalStore(save.subscribe, save.getSnapshot)
  const form = state.form
  const dirty = state.phase !== 'saved'
  const saving = state.phase === 'saving' || state.phase === 'pending'
  const [undo, setUndo] = useState<MetadataUndo | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState('')
  useEffect(() => { save.receive(meta) }, [save, meta])
  useEffect(() => () => save.dispose(), [save])
  useEffect(() => {
    if (!supported) return
    let alive = true
    void api.metadataUndo(meta.id).then((value) => { if (alive) { setUndo(value); setUndoError('') } }, (error: unknown) => { if (alive) setUndoError(errorText(error)) })
    return () => { alive = false }
  }, [meta, supported])
  function update<K extends keyof MetaForm>(key: K, value: MetaForm[K]): void { save.update(key, value) }
  const yearError = state.error === 'year' ? t('meta.yearInvalid') : null
  const locked = busy || undoing || !supported
  const restore = async () => {
    if (!undo?.revisionId || !(await save.flush())) return
    setUndoing(true); setUndoError('')
    try {
      const result = await api.undoMetadata(meta.id, undo.revisionId, undo.expectedHash, libraryPath)
      save.receive(result.meta); applied.current(result.meta, libraryPath); setUndo(result.undo)
    } catch (error) { setUndoError(errorText(error)) }
    finally { setUndoing(false) }
  }
  const enrich = async (llm: boolean) => {
    if (!(await save.flush())) return
    try { await (llm ? onLlmEnrich() : onEnrich()) }
    catch (error) { onToast('error', errorText(error) || t('meta.enrichFailed')) }
  }

  const statusOptions = STATUSES.map((status) => ({ value: status, label: statusLabel(t, status) }))
  const pageCountText = meta.pageCount === null ? '—' : t('meta.value.pages', { n: meta.pageCount })

  return (
    <div className="pd-meta" onBlurCapture={() => { if (supported) void save.flush() }}>
      <div className="pd-meta-head">
        <span className="pd-field-label">{t('reader.tab.info')}</span>
        <span className="pd-meta-hint">{t('reader.meta.tabHint')}</span>
      </div>

      <Field label={t('meta.title')} htmlFor="pd-meta-title">
        <TextInput
          id="pd-meta-title"
          value={form.title}
          onChange={(event) => update('title', event.target.value)}
          disabled={locked}
        />
      </Field>

      <Field label={t('meta.authors')} hint={t('meta.authorsHint')} htmlFor="pd-meta-authors">
        <TextInput
          id="pd-meta-authors"
          value={form.authors}
          onChange={(event) => update('authors', event.target.value)}
          disabled={locked}
        />
      </Field>

      <div className="pd-field-grid">
        <Field label={t('meta.year')} error={yearError} htmlFor="pd-meta-year">
          <TextInput
            id="pd-meta-year"
            value={form.year}
            inputMode="numeric"
            invalid={yearError !== null}
            onChange={(event) => update('year', event.target.value.replace(/[^0-9]/g, ''))}
            disabled={locked}
          />
        </Field>
        <Field label={t('meta.venue')} htmlFor="pd-meta-venue">
          <TextInput
            id="pd-meta-venue"
            value={form.venue}
            onChange={(event) => update('venue', event.target.value)}
            disabled={locked}
          />
        </Field>
        <Field label={t('meta.status')} htmlFor="pd-meta-status">
          <Select
            value={form.status}
            options={statusOptions}
            onChange={(value) => update('status', value as PaperStatus)}
            disabled={locked}
            ariaLabel={t('meta.status')}
          />
        </Field>
        <Field label={t('meta.rating')}>
          <Rating value={form.rating} label={t('aria.rating')} onChange={(value) => update('rating', value)} disabled={locked} />
        </Field>
      </div>

      <div className="pd-field-grid">
        <Field label={t('meta.doi')} htmlFor="pd-meta-doi">
          <TextInput
            id="pd-meta-doi"
            value={form.doi}
            onChange={(event) => update('doi', event.target.value)}
            disabled={locked}
          />
        </Field>
        <Field label={t('meta.url')} htmlFor="pd-meta-url">
          <TextInput
            id="pd-meta-url"
            value={form.url}
            inputMode="url"
            onChange={(event) => update('url', event.target.value)}
            disabled={locked}
          />
        </Field>
      </div>

      <Field label={t('meta.abstract')} htmlFor="pd-meta-abstract">
        <Textarea
          value={form.abstract}
          onChange={(value) => update('abstract', value)}
          rows={5}
          disabled={locked}
          ariaLabel={t('meta.abstract')}
        />
      </Field>

      <div className="pd-field-grid">
        <Field label={t('meta.keywords')} hint={t('meta.keywordsHint')} htmlFor="pd-meta-keywords">
          <TextInput
            id="pd-meta-keywords"
            value={form.keywords}
            onChange={(event) => update('keywords', event.target.value)}
            disabled={locked}
          />
        </Field>
        <Field label={t('meta.tags')} hint={t('meta.tagsHint')} htmlFor="pd-meta-tags">
          <TextInput
            id="pd-meta-tags"
            value={form.tags}
            onChange={(event) => update('tags', event.target.value)}
            disabled={locked}
          />
        </Field>
      </div>

      <div className="pd-meta-toolbar">
        <div className="pd-meta-save-status" data-state={state.phase} role="status" aria-live="polite">
          {!supported ? t('meta.reloadAutosave') : state.phase === 'error' ? (state.error === 'year' ? t('meta.yearInvalid') : state.error === 'title' ? t('meta.titleRequired') : t('meta.autosaveFailed', { error: state.error || '' })) : t(saving ? 'meta.autosaving' : 'meta.autosaved')}
        </div>
        <div className="pd-meta-actions">
          {state.phase === 'error' ? <Button size="sm" disabled={locked} onClick={() => void save.flush()}>{t('common.retry')}</Button> : null}
          <Button size="sm" disabled={locked || saving || !undo?.revisionId} loading={undoing} onClick={() => void restore()}>{t(undo?.action === 'redo' ? 'meta.redo' : 'meta.undo')}</Button>
          <Button size="sm" variant="ghost" icon={<IconRefresh size={13} />} disabled={locked || dirty || Boolean(meta.abstract.trim() && meta.keywords.length && meta.tags.length)} onClick={() => void enrich(true)} title={t('meta.llmHint')}>{t('meta.llmEnrich')}</Button>
          <Button size="sm" variant="ghost" icon={<IconRefresh size={13} />} disabled={locked || dirty} onClick={() => void enrich(false)}>{t('meta.enrich')}</Button>
        </div>
      </div>
      {undoError ? <p className="pd-field-error" role="alert">{undoError}</p> : null}
      {state.storageError ? <p className="pd-field-error">{t('meta.draftStorageFailed')}</p> : null}
      <p className="pd-field-hint">{t('meta.llmHint')}</p>

      <div className="pd-meta-meta">
        <div className="pd-meta-meta-item">
          <span>{t('meta.source')}</span>
          <span className="pd-meta-meta-value">{sourceLabel(t, meta.source)}</span>
        </div>
        <div className="pd-meta-meta-item">
          <span>{t('meta.addedAt')}</span>
          <span className="pd-meta-meta-value">{formatDateTime(lang, meta.addedAt)}</span>
        </div>
        <div className="pd-meta-meta-item">
          <span>{t('meta.updatedAt')}</span>
          <span className="pd-meta-meta-value">{formatDateTime(lang, meta.updatedAt)}</span>
        </div>
        <div className="pd-meta-meta-item">
          <span>{t('meta.pageCount')}</span>
          <span className="pd-meta-meta-value">{pageCountText}</span>
        </div>
        <div className="pd-meta-meta-item">
          <span>{t('meta.pdfSize')}</span>
          <span className="pd-meta-meta-value">
            {pdfEvicted ? t('meta.value.evicted') : formatBytes(pdfBytes)}
          </span>
        </div>
        {meta.doi !== '' ? (
          <div className="pd-meta-meta-item">
            <span>{t('meta.doi')}</span>
            <span className="pd-meta-meta-value">
              <a
                className="pd-link"
                href={`https://doi.org/${encodeURIComponent(meta.doi)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {meta.doi} <IconExternal size={11} />
              </a>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
