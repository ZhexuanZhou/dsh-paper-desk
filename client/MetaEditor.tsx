/**
 * Editable metadata form for the reader's 信息 tab. The form is local until
 * saved; `App` performs the PATCH and refreshes both the reader and list rows.
 */
import { reconcileMetaForm, toMetaForm } from './metaForm.js'
import type { MetaForm } from './metaForm.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PaperMeta, PaperStatus } from '../src/types.js'
import { IconExternal, IconRefresh, IconSave } from './icons.js'
import { errorText, formatBytes, formatDateTime, sourceLabel, statusLabel, useLang, useT } from './i18n.js'
import { Button, Field, Rating, Select, TextInput, Textarea } from './ui.js'

type ToastKind = 'info' | 'success' | 'error' | 'warn'
type ToastPush = (kind: ToastKind, message: string) => void


function splitList(value: string): string[] {
  return value
    .split(/[,，;；]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}


export interface MetaEditorProps {
  meta: PaperMeta
  pdfBytes: number
  pdfEvicted: boolean
  busy: boolean
  onSave: (patch: Partial<PaperMeta>) => Promise<void>
  onEnrich: () => Promise<void>
  onLlmEnrich: () => Promise<void>
  onToast: ToastPush
}

const STATUSES: readonly PaperStatus[] = ['unread', 'reading', 'read', 'archived']

export function MetaEditor({ meta, pdfBytes, pdfEvicted, busy, onSave, onEnrich, onLlmEnrich, onToast }: MetaEditorProps) {
  const t = useT()
  const lang = useLang()
  const baseline = useMemo(() => toMetaForm(meta), [meta])
  const [form, setForm] = useState<MetaForm>(baseline)
  const [yearError, setYearError] = useState<string | null>(null)
  const previousMetaRef = useRef(meta)

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline])
  /* Compare to the previous server values; incoming results are not user edits. */
  useEffect(() => {
    const previous = previousMetaRef.current
    previousMetaRef.current = meta
    setForm((current) => reconcileMetaForm(current, previous, meta))
    if (previous.id !== meta.id) setYearError(null)
  }, [meta])

  function update<K extends keyof MetaForm>(key: K, value: MetaForm[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  const submit = async (): Promise<void> => {
    const yearText = form.year.trim()
    let year: number | null = null
    if (yearText !== '') {
      const parsed = Number(yearText)
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1000 || parsed > 3000) {
        setYearError(t('meta.yearInvalid'))
        return
      }
      year = parsed
    }
    setYearError(null)
    const patch: Partial<PaperMeta> = {
      title: form.title.trim(),
      authors: splitList(form.authors),
      year,
      venue: form.venue.trim(),
      doi: form.doi.trim(),
      url: form.url.trim(),
      abstract: form.abstract.trim(),
      keywords: splitList(form.keywords),
      tags: splitList(form.tags),
      status: form.status,
      rating: form.rating,
    }
    try {
      await onSave(patch)
    } catch (error) {
      onToast('error', errorText(error) || t('error.patch'))
    }
  }

  const enrich = async (): Promise<void> => {
    try {
      await onEnrich()
    } catch (error) {
      onToast('error', errorText(error) || t('meta.enrichFailed'))
    }
  }

  const statusOptions = STATUSES.map((status) => ({ value: status, label: statusLabel(t, status) }))
  const pageCountText = meta.pageCount === null ? '—' : t('meta.value.pages', { n: meta.pageCount })

  return (
    <div className="pd-meta">
      <div className="pd-meta-head">
        <span className="pd-field-label">{t('reader.tab.info')}</span>
        <span className="pd-meta-hint">{t('reader.meta.tabHint')}</span>
      </div>

      <Field label={t('meta.title')} htmlFor="pd-meta-title">
        <TextInput
          id="pd-meta-title"
          value={form.title}
          onChange={(event) => update('title', event.target.value)}
          disabled={busy}
        />
      </Field>

      <Field label={t('meta.authors')} hint={t('meta.authorsHint')} htmlFor="pd-meta-authors">
        <TextInput
          id="pd-meta-authors"
          value={form.authors}
          onChange={(event) => update('authors', event.target.value)}
          disabled={busy}
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
            disabled={busy}
          />
        </Field>
        <Field label={t('meta.venue')} htmlFor="pd-meta-venue">
          <TextInput
            id="pd-meta-venue"
            value={form.venue}
            onChange={(event) => update('venue', event.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('meta.status')} htmlFor="pd-meta-status">
          <Select
            value={form.status}
            options={statusOptions}
            onChange={(value) => update('status', value as PaperStatus)}
            disabled={busy}
            ariaLabel={t('meta.status')}
          />
        </Field>
        <Field label={t('meta.rating')}>
          <Rating value={form.rating} label={t('aria.rating')} onChange={(value) => update('rating', value)} disabled={busy} />
        </Field>
      </div>

      <div className="pd-field-grid">
        <Field label={t('meta.doi')} htmlFor="pd-meta-doi">
          <TextInput
            id="pd-meta-doi"
            value={form.doi}
            onChange={(event) => update('doi', event.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('meta.url')} htmlFor="pd-meta-url">
          <TextInput
            id="pd-meta-url"
            value={form.url}
            inputMode="url"
            onChange={(event) => update('url', event.target.value)}
            disabled={busy}
          />
        </Field>
      </div>

      <Field label={t('meta.abstract')} htmlFor="pd-meta-abstract">
        <Textarea
          value={form.abstract}
          onChange={(value) => update('abstract', value)}
          rows={5}
          disabled={busy}
          ariaLabel={t('meta.abstract')}
        />
      </Field>

      <div className="pd-field-grid">
        <Field label={t('meta.keywords')} hint={t('meta.keywordsHint')} htmlFor="pd-meta-keywords">
          <TextInput
            id="pd-meta-keywords"
            value={form.keywords}
            onChange={(event) => update('keywords', event.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('meta.tags')} hint={t('meta.tagsHint')} htmlFor="pd-meta-tags">
          <TextInput
            id="pd-meta-tags"
            value={form.tags}
            onChange={(event) => update('tags', event.target.value)}
            disabled={busy}
          />
        </Field>
      </div>

      <p className="pd-field-hint">{t('meta.llmHint')}</p>
      <div className="pd-meta-actions">
        <Button icon={<IconRefresh />} loading={busy} disabled={dirty || Boolean(meta.abstract.trim() && meta.keywords.length && meta.tags.length)} onClick={() => void onLlmEnrich()} title={dirty ? t('meta.llmSaveFirst') : t('meta.llmHint')}>
          {t('meta.llmEnrich')}
        </Button>
        <Button variant="primary" icon={<IconSave />} loading={busy} disabled={!dirty} onClick={() => void submit()}>
          {t('meta.save')}
        </Button>
        <Button icon={<IconRefresh />} loading={busy} onClick={() => void enrich()}>
          {t('meta.enrich')}
        </Button>
        {dirty ? <span className="pd-notes-dirty">{t('meta.dirty')}</span> : null}
      </div>

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
