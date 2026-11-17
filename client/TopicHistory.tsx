import { useEffect, useState } from 'react'
import type { ResearchSnapshot } from '../src/types.js'
import { api } from './api.js'
import { Markdown } from './markdown.js'
import { useT, errorText } from './i18n.js'
import { Button, Modal, Tabs } from './ui.js'

type Kind = 'analysis' | 'notes' | 'cards'
export function TopicHistory({ topicId, onClose, onRestore }: { topicId: string; onClose: () => void; onRestore: (next: ResearchSnapshot) => void }) {
  const t = useT()
  const [kind, setKind] = useState<Kind>('analysis')
  const [rows, setRows] = useState<{ id: string; createdAt: string }[]>([])
  const [hash, setHash] = useState(''), [selected, setSelected] = useState('')
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
  useEffect(() => {
    let live = true
    setSelected(''); setContent(null); setConfirm(false); setBusy(true); setError(''); setRows([])
    void api.topicHistory(topicId, kind).then((next) => { if (live) { setRows(next.revisions); setHash(next.hash) } }).catch((err) => { if (live) setError(errorText(err)) }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [topicId, kind])
  const preview = async (id: string) => {
    setBusy(true); setError(''); setConfirm(false)
    try { const next = await api.topicRevision(topicId, kind, id); setContent(next.content); setSelected(id) }
    catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  let markdown = content ?? ''
  if (content && kind !== 'notes') {
    try { const parsed = JSON.parse(content); markdown = kind === 'analysis' ? parsed.markdown : parsed.map((card: { title: string; body: string }) => `## ${card.title}\n\n${card.body}`).join('\n\n---\n\n') } catch { markdown = content }
  }
  return <Modal open title={t('research.history')} onClose={() => { if (!busy) onClose() }} wide footer={<>{confirm ? <span className="pd-field-hint">{t('research.restoreHint')}</span> : null}<Button disabled={busy || !selected} variant={confirm ? 'primary' : 'default'} loading={busy} onClick={() => {
    if (!confirm) { setConfirm(true); return }
    setBusy(true); setError('')
    void api.restoreTopicDocument(topicId, kind, selected, hash).then((next) => { onRestore(next); onClose() }).catch((err) => { setError(errorText(err)); setConfirm(false) }).finally(() => setBusy(false))
  }}>{t(confirm ? 'research.confirmRestore' : 'research.restore')}</Button></>}>
    <Tabs value={kind} onChange={(value) => { if (!busy) setKind(value as Kind) }} tabs={[{ id: 'analysis', label: t('research.interpretation') }, { id: 'notes', label: t('research.notebook') }, { id: 'cards', label: t('research.cards') }]} />
    {error ? <p role="alert" className="pd-field-error">{error}</p> : null}
    <div className="pd-topic-history"><div className="pd-topic-revisions">{rows.map((row) => <button key={row.id} disabled={busy} data-selected={row.id === selected} onClick={() => void preview(row.id)}>{new Date(row.createdAt).toLocaleString()}</button>)}{!busy && !rows.length ? <p className="pd-field-hint">{t('research.noHistory')}</p> : null}</div><div className="pd-topic-history-preview">{selected ? markdown ? <Markdown markdown={markdown} /> : <p className="pd-field-hint">{t('research.emptyVersion')}</p> : <p className="pd-field-hint">{t('research.selectVersion')}</p>}</div></div>
  </Modal>
}
