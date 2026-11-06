/**
 * Settings pane: library path picker + save, interface language, Crossref enrich
 * toggle, inbox scan, device id and a short explanation of the cloud-sync
 * design. App owns loading/saving; the form is local until saved.
 */
import { useEffect, useState } from 'react'
import type { StatusPayload, SyncStatus } from '../src/types.js'
import type { SettingsPatch, SettingsPayload } from './api.js'
import { IconFolder, IconRefresh, IconSync } from './icons.js'
import { useT } from './i18n.js'
import { Button, Checkbox, Field, Select, Spinner, TextInput } from './ui.js'

export interface SettingsViewProps {
  settings: SettingsPayload | null
  status: StatusPayload | null
  sync: SyncStatus | null
  loading: boolean
  error: string | null
  busy: string | null
  onPickDirectory: () => Promise<string | null>
  onSave: (patch: SettingsPatch) => Promise<void>
  onScanInbox: () => Promise<void>
  onOpenFolder: () => Promise<void>
  onReload: () => void
}

interface SettingsForm {
  path: string
  language: 'zh' | 'en'
  enrich: boolean
  autoImportInbox: boolean
}

export function SettingsView(props: SettingsViewProps) {
  const t = useT()
  const { settings, status, sync, loading, error, busy, onPickDirectory, onSave, onScanInbox, onOpenFolder, onReload } =
    props

  const effective = settings?.effective ?? null
  const [form, setForm] = useState<SettingsForm>({
    path: effective?.libraryPath ?? '',
    language: effective?.language ?? 'zh',
    enrich: effective?.enrich ?? true,
    autoImportInbox: effective?.autoImportInbox ?? true,
  })
  const [pathError, setPathError] = useState<string | null>(null)

  useEffect(() => {
    if (effective === null) return
    setForm({
      path: effective.libraryPath,
      language: effective.language,
      enrich: effective.enrich,
      autoImportInbox: effective.autoImportInbox,
    })
    setPathError(null)
  }, [effective])

  const configured = status?.configured === true && status.libraryExists === true
  const saving = busy === 'save'
  const picking = busy === 'pick'

  const dirty =
    effective !== null &&
    (form.path !== effective.libraryPath ||
      form.language !== effective.language ||
      form.enrich !== effective.enrich ||
      form.autoImportInbox !== effective.autoImportInbox)

  const pick = async (): Promise<void> => {
    try {
      const picked = await onPickDirectory()
      if (picked !== null) {
        setForm((previous) => ({ ...previous, path: picked }))
        setPathError(null)
      }
    } catch {
      // App surfaces the failure as a toast; keep the form usable.
    }
  }

  const save = async (): Promise<void> => {
    const path = form.path.trim()
    if (path === '') {
      setPathError(t('settings.pathRequired'))
      return
    }
    setPathError(null)
    try {
      await onSave({
        libraryPath: path,
        language: form.language,
        enrich: form.enrich,
        autoImportInbox: form.autoImportInbox,
      })
    } catch {
      // Toast handled by App.
    }
  }

  return (
    <section className="pd-pane pd-pane-single" aria-label={t('settings.title')}>
      <div className="pd-settings">
        <div className="pd-settings-head">
          <h2 className="pd-settings-title">{t('settings.title')}</h2>
          <div className="pd-settings-actions">
            <Button size="sm" icon={<IconRefresh />} loading={loading} onClick={onReload}>
              {t('settings.reload')}
            </Button>
            <Button
              size="sm"
              icon={<IconFolder />}
              loading={busy === 'reveal'}
              disabled={!configured}
              onClick={() => void onOpenFolder()}
            >
              {t('settings.openFolder')}
            </Button>
          </div>
        </div>

        {loading && settings === null ? (
          <div className="pd-loading-block">
            <Spinner size={14} label={t('settings.loading')} />
            <span>{t('settings.loading')}</span>
          </div>
        ) : null}

        {error !== null ? (
          <div className="pd-detail-error" role="alert">
            <span>{t('settings.error')}</span>
            <span>{error}</span>
            <Button size="sm" onClick={onReload}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        <section className="pd-section">
          <div className="pd-section-head">
            <span>{t('settings.library')}</span>
            {effective !== null ? (
              <span className="pd-badge" data-kind={configured ? 'cloud' : 'warn'}>
                {t(`settings.source.${effective.source}`)}
              </span>
            ) : null}
          </div>
          <div className="pd-section-body">
            <Field label={t('settings.library')} hint={t('settings.libraryHint')} error={pathError} htmlFor="pd-settings-path">
              <div className="pd-path-row">
                <TextInput
                  id="pd-settings-path"
                  value={form.path}
                  placeholder={t('settings.pathPlaceholder')}
                  invalid={pathError !== null}
                  disabled={saving}
                  onChange={(event) => setForm((previous) => ({ ...previous, path: event.target.value }))}
                />
                <Button icon={<IconFolder />} loading={picking} disabled={saving} onClick={() => void pick()}>
                  {t('settings.choose')}
                </Button>
              </div>
            </Field>
            <div className="pd-settings-row-inline">
              <Field label={t('settings.language')} hint={t('settings.languageHint')} htmlFor="pd-settings-language">
                <Select
                  value={form.language}
                  options={[
                    { value: 'zh', label: t('app.lang.zh') },
                    { value: 'en', label: t('app.lang.en') },
                  ]}
                  onChange={(value) => setForm((previous) => ({ ...previous, language: value === 'en' ? 'en' : 'zh' }))}
                  disabled={saving}
                  ariaLabel={t('settings.language')}
                />
              </Field>
            </div>
            <Checkbox
              checked={form.enrich}
              onChange={(checked) => setForm((previous) => ({ ...previous, enrich: checked }))}
              label={t('settings.enrich')}
              hint={t('settings.enrichHint')}
              disabled={saving}
            />
            <Checkbox
              checked={form.autoImportInbox}
              onChange={(checked) => setForm((previous) => ({ ...previous, autoImportInbox: checked }))}
              label={t('settings.autoImportInbox')}
              hint={t('settings.autoImportHint')}
              disabled={saving}
            />
            <div className="pd-settings-actions">
              <Button
                variant="primary"
                loading={saving}
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                {saving ? t('common.saving') : t('settings.save')}
              </Button>
              {dirty ? <span className="pd-notes-dirty">{t('settings.dirty')}</span> : null}
            </div>
          </div>
        </section>

        <section className="pd-section">
          <div className="pd-section-head">
            <span>{t('settings.inbox')}</span>
          </div>
          <div className="pd-section-body">
            <div className="pd-inline-empty">{t('settings.autoImportHint')}</div>
            <div>
              <Button
                size="sm"
                icon={<IconSync />}
                loading={busy === 'inbox'}
                disabled={!configured || (busy !== null && busy !== 'inbox')}
                onClick={() => void onScanInbox()}
              >
                {busy === 'inbox' ? t('settings.inboxScanning') : t('settings.inbox')}
              </Button>
            </div>
          </div>
        </section>

        <section className="pd-section">
          <div className="pd-section-head">
            <span>{t('settings.cloudDesign.title')}</span>
          </div>
          <div className="pd-section-body">
            <div className="pd-inline-empty">{t('settings.cloudDesign.body')}</div>
            <div className="pd-settings-row">
              <span className="pd-field-label">{t('settings.device')}</span>
              <span className="pd-inline-empty">
                {sync?.deviceId ?? t('common.unknown')} · {t('settings.deviceHint')}
              </span>
              <span className="pd-field-label">{t('settings.file')}</span>
              <span className="pd-code">{effective?.settingsFile ?? t('common.unknown')}</span>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
