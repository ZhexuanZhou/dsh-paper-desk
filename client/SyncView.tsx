/**
 * Sync pane: cloud-drive badge, counters, external-change delta, conflict copies
 * and iCloud-evicted files. Data and actions come from `App`.
 */
import type { SyncStatus } from '../src/types.js'
import { IconDownload, IconFolder, IconRefresh } from './icons.js'
import { cloudLabel, formatDateTime, formatNumber, useLang, useT } from './i18n.js'
import { Button, EmptyState, Spinner } from './ui.js'

type ToastPush = (kind: 'info' | 'success' | 'error' | 'warn', message: string) => void

export interface SyncViewProps {
  status: SyncStatus | null
  loading: boolean
  error: string | null
  busy: string | null
  onRefresh: () => void
  onScan: () => Promise<void>
  onOpenFolder: () => Promise<void>
  onResolve: (relPath: string, action: 'use-conflict' | 'discard-conflict') => Promise<void>
  onDownload: (relPath: string) => Promise<void>
  onToast: ToastPush
}

export function SyncView(props: SyncViewProps) {
  const t = useT()
  const lang = useLang()
  const { status, loading, error, busy, onRefresh, onScan, onOpenFolder, onResolve, onDownload } = props

  if (status === null) {
    return (
      <section className="pd-pane pd-pane-single" aria-label={t('sync.title')}>
        {loading ? (
          <div className="pd-loading-block">
            <Spinner size={16} label={t('sync.loading')} />
            <span>{t('sync.loading')}</span>
          </div>
        ) : error !== null ? (
          <div className="pd-detail-error" role="alert">
            <span>{t('sync.error')}</span>
            <span>{error}</span>
            <Button size="sm" onClick={onRefresh}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <EmptyState title={t('sync.noLibrary')} description={t('sync.error')} />
        )}
      </section>
    )
  }

  const delta = status.delta
  const hasDelta = delta.added.length > 0 || delta.changed.length > 0 || delta.removed.length > 0
  const lastScan =
    status.lastScanAt === null ? t('sync.neverScanned') : t('sync.lastScan', { time: formatDateTime(lang, status.lastScanAt) })

  return (
    <section className="pd-pane pd-pane-single" aria-label={t('sync.title')}>
      <div className="pd-sync">
        <div className="pd-sync-head">
          <h2 className="pd-sync-title">{t('sync.title')}</h2>
          <span className="pd-badge" data-kind={status.cloud.synced ? 'cloud' : 'local'}>
            {cloudLabel(t, status.cloud.kind)}
          </span>
          <span className="pd-badge" data-kind="local">
            {lastScan}
          </span>
          <div className="pd-sync-actions">
            <Button size="sm" icon={<IconFolder />} loading={busy === 'reveal'} onClick={() => void onOpenFolder()}>
              {t('sync.openFolder')}
            </Button>
            <Button size="sm" icon={<IconRefresh />} loading={busy === 'scan'} onClick={() => void onScan()}>
              {busy === 'scan' ? t('sync.scanning') : t('sync.rescan')}
            </Button>
          </div>
        </div>

        <div className="pd-sync-note" data-kind={status.cloud.synced ? 'cloud' : undefined}>
          <span>{status.cloud.synced ? t('sync.note.synced') : t('sync.note.local')}</span>
        </div>

        {status.readOnly ? (
          <div className="pd-sync-note" data-kind="warn" role="alert">
            <span>{t('sync.readOnly')}</span>
          </div>
        ) : null}

        {error !== null ? (
          <div className="pd-detail-error" role="alert">
            <span>{error}</span>
            <Button size="sm" onClick={onRefresh}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        <div className="pd-stats">
          <div className="pd-stat">
            <span className="pd-stat-value">{formatNumber(lang, status.trackedFiles)}</span>
            <span className="pd-stat-label">{t('sync.stats.tracked')}</span>
          </div>
          <div className="pd-stat">
            <span className="pd-stat-value">{formatNumber(lang, status.pdfCount)}</span>
            <span className="pd-stat-label">{t('sync.stats.pdfs')}</span>
          </div>
          <div className="pd-stat">
            <span className="pd-stat-value">{formatNumber(lang, status.conflicts.length)}</span>
            <span className="pd-stat-label">{t('sync.stats.conflicts')}</span>
          </div>
          <div className="pd-stat">
            <span className="pd-stat-value">{formatNumber(lang, status.evicted.length)}</span>
            <span className="pd-stat-label">{t('sync.stats.evicted')}</span>
          </div>
        </div>

        <section className="pd-section" aria-label={t('sync.external.title')}>
          <div className="pd-section-head">
            <span>{t('sync.external.title')}</span>
            {hasDelta ? (
              <span className="pd-badge" data-kind="cloud">
                +{delta.added.length} · ~{delta.changed.length} · -{delta.removed.length}
              </span>
            ) : null}
          </div>
          <div className="pd-section-body">
            {hasDelta ? (
              <>
                <div className="pd-inline-empty">{t('sync.external.hint')}</div>
                {delta.added.length > 0 ? (
                  <DeltaGroup label={t('sync.external.added')} paths={delta.added.map((file) => file.relPath)} />
                ) : null}
                {delta.changed.length > 0 ? (
                  <DeltaGroup label={t('sync.external.changed')} paths={delta.changed.map((file) => file.relPath)} />
                ) : null}
                {delta.removed.length > 0 ? (
                  <DeltaGroup label={t('sync.external.removed')} paths={delta.removed} />
                ) : null}
              </>
            ) : (
              <div className="pd-inline-empty">{t('sync.external.none')}</div>
            )}
          </div>
        </section>

        <section className="pd-section" aria-label={t('sync.conflicts.title')}>
          <div className="pd-section-head">
            <span>{t('sync.conflicts.title')}</span>
            <span className="pd-badge" data-kind={status.conflicts.length > 0 ? 'warn' : 'local'}>
              {formatNumber(lang, status.conflicts.length)}
            </span>
          </div>
          <div className="pd-section-body">
            {status.conflicts.length === 0 ? (
              <div className="pd-inline-empty">{t('sync.conflicts.none')}</div>
            ) : (
              <ul className="pd-list">
                {status.conflicts.map((conflict) => {
                  const path = conflict.relPath
                  return (
                    <li key={path} className="pd-listitem">
                      <span className="pd-listitem-path">{path}</span>
                      <span className="pd-listitem-actions">
                        <Button
                          size="sm"
                          loading={busy === `conflict:${path}`}
                          disabled={busy !== null && busy !== `conflict:${path}`}
                          onClick={() => void onResolve(path, 'use-conflict')}
                        >
                          {t('sync.conflicts.use')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null && busy !== `conflict:${path}`}
                          onClick={() => void onResolve(path, 'discard-conflict')}
                        >
                          {t('sync.conflicts.discard')}
                        </Button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="pd-section" aria-label={t('sync.evicted.title')}>
          <div className="pd-section-head">
            <span>{t('sync.evicted.title')}</span>
            <span className="pd-badge" data-kind={status.evicted.length > 0 ? 'warn' : 'local'}>
              {formatNumber(lang, status.evicted.length)}
            </span>
          </div>
          <div className="pd-section-body">
            {status.evicted.length === 0 ? (
              <div className="pd-inline-empty">{t('sync.evicted.none')}</div>
            ) : (
              <ul className="pd-list">
                {status.evicted.map((item) => (
                  <li key={item.relPath} className="pd-listitem">
                    <span className="pd-listitem-path">{item.relPath}</span>
                    <span className="pd-listitem-actions">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<IconDownload />}
                        loading={busy === `download:${item.relPath}`}
                        disabled={busy !== null && busy !== `download:${item.relPath}`}
                        onClick={() => void onDownload(item.relPath)}
                      >
                        {busy === `download:${item.relPath}` ? t('sync.evicted.downloading') : t('sync.evicted.download')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

function DeltaGroup({ label, paths }: { label: string; paths: readonly string[] }) {
  return (
    <div className="pd-delta-group">
      <span className="pd-delta-label">{label}</span>
      <ul className="pd-list">
        {paths.map((path) => (
          <li key={`${label}-${path}`} className="pd-listitem">
            <span className="pd-listitem-path">{path}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
