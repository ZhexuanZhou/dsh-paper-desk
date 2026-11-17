import { useRef, useState } from 'react'
import type { PaperStatus } from '../src/types.js'
import { statusLabel, useT } from './i18n.js'
import { Menu, Spinner } from './ui.js'

const STATUSES: readonly PaperStatus[] = ['unread', 'reading', 'read', 'archived']

/** A reading action; the displayed state changes only after persistence succeeds. */
export function ReaderStatus({ status, disabled, onChange }: {
  status: PaperStatus
  disabled: boolean
  onChange: (status: PaperStatus) => Promise<void>
}) {
  const t = useT()
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const change = async (next: PaperStatus) => {
    if (pending.current || next === status) return
    pending.current = true
    setSaving(true)
    try { await onChange(next) }
    finally { pending.current = false; setSaving(false) }
  }
  return <Menu className={`pd-reader-status pd-reader-status-${status}`}
    label={`${t('meta.status')} · ${statusLabel(t, status)}`}
    disabled={disabled || saving}
    triggerLabel={<span className="pd-reader-status-label"><span className="pd-reader-status-mark" aria-hidden="true">{saving ? <Spinner size={7} /> : <span />}</span><span>{statusLabel(t, status)}</span>{saving ? <span className="pd-reader-sr-only" role="status">{t('common.saving')}</span> : null}</span>}
    icon={<span className="pd-reader-status-caret" aria-hidden="true">⌄</span>}
    items={STATUSES.map((item) => ({ id: item, label: statusLabel(t, item), selected: item === status,
      icon: <span className={`pd-reader-status-option-dot pd-reader-status-${item}`} aria-hidden="true" />,
      onSelect: () => { void change(item) },
    }))} />
}
