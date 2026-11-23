import { useEffect, useRef, useState } from 'react'
import type { DocumentKind, Revision, RevisionSummary } from '../src/types.js'
import { historyCardPreview } from './historyPreview.js'
import { api, ApiError } from './api.js'
import { useLang } from './i18n.js'
import { Markdown } from './markdown.js'
import { Button, Modal, Spinner } from './ui.js'
import { parseReproduction } from '../src/reproductionContract.js'

export function VersionHistory({ paperId, kind, disabled, onRestored, libraryPath }: {
  paperId: string; kind: DocumentKind; disabled: boolean; onRestored: () => Promise<void>; libraryPath?: string
}) {
  const en = useLang() === 'en'
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<RevisionSummary[]>([])
  const [selected, setSelected] = useState<Revision | null>(null)
  const [hash, setHash] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [undoId, setUndoId] = useState<string | null>(null)
  const [undoHash, setUndoHash] = useState('')
  const request = useRef(0)
  const title = en ? `${kind === 'notes' ? 'Notes' : kind === 'cards' ? 'Cards' : 'Reproduction'} version history` : `${kind === 'notes' ? '笔记' : kind === 'cards' ? '卡片' : '复现说明'}版本历史`
  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) setError(en
      ? 'The content changed. Nothing was restored; reload history and review before trying again.'
      : '内容已变化，本次恢复未执行。请重新加载历史，核对后再试。')
    else if (err instanceof ApiError && err.status === 404) setError(en
      ? 'This version is no longer available. Reload history.' : '这个版本已不存在，请重新加载历史。')
    else setError(en ? 'The operation could not be completed. Reload history; if it still fails, check library read/write access.'
      : '操作未完成，请重新加载历史；若仍失败，请检查论文库是否可读写。')
  }
  useEffect(() => { request.current++; setOpen(false); setSelected(null); setUndoId(null) }, [paperId, kind, libraryPath])
  useEffect(() => () => { request.current++ }, [])
  const close = () => { if (!busy) { request.current++; setOpen(false) } }
  const load = async () => {
    const token = ++request.current
    setLoading(true); setError(''); setSelected(null)
    try {
      const result = await api.history(paperId, kind, libraryPath)
      if (request.current !== token) return
      setVersions(result.versions); setHash(result.currentHash)
    } catch (err) { if (request.current === token) fail(err) }
    finally { if (request.current === token) setLoading(false) }
  }
  const preview = async (id: string) => {
    const token = ++request.current
    setSelected(null); setLoading(true); setError('')
    try { const version = await api.historyVersion(paperId, kind, id, libraryPath); if (request.current === token) setSelected(version) }
    catch (err) { if (request.current === token) fail(err) }
    finally { if (request.current === token) setLoading(false) }
  }
  const restore = async (id: string, expectedHash = hash) => {
    const token = ++request.current
    const beforeHash = hash
    setBusy(true); setError(''); setNotice('')
    try {
      const restored = await api.restoreVersion(paperId, kind, id, expectedHash, libraryPath)
      if (request.current !== token) return
      setHash(restored.hash); setUndoHash(restored.hash)
      setNotice(restored.changed
        ? (en ? 'Restored. The state it replaced is saved in history.' : '已恢复；恢复前的内容已另存为历史版本。')
        : (en ? 'This version already matches the current content.' : '当前内容已与此版本一致，无需恢复。'))
      const [refresh, history] = await Promise.allSettled([onRestored(), api.history(paperId, kind, libraryPath)])
      if (request.current !== token) return
      if (history.status === 'fulfilled') {
        setVersions(history.value.versions); setHash(history.value.currentHash)
        setUndoId(restored.changed ? history.value.versions.find((v) => v.hash === beforeHash)?.id ?? null : null)
      }
      if (refresh.status === 'rejected' || history.status === 'rejected') setError(en ? 'Restoration succeeded, but refreshing failed. Reload history to continue.' : '恢复已完成，但刷新失败。请重新加载历史后继续。')
    } catch (err) { if (request.current === token) fail(err) }
    finally { setBusy(false) }
  }
  const reason = (value: string) => value.startsWith('restore ') ? (en ? 'Before restoring a version' : '恢复版本前')
    : value === 'resolve notes conflict' ? (en ? 'Before resolving a notes conflict' : '处理笔记冲突前')
    : value === 'append notes' ? (en ? 'Before adding to notes' : '补充笔记前')
    : value === 'edit notes' ? (en ? 'Before editing notes' : '编辑笔记前')
    : value === 'reorganize cards' ? (en ? 'Before reorganizing cards' : '重组卡片前')
    : value === 'edit cards' ? (en ? 'Before editing cards' : '编辑卡片前')
    : value === 'edit reproduction' ? (en ? 'Before editing the guide' : '编辑复现说明前')
    : value === 'generate reproduction' ? (en ? 'Before generating the guide' : '生成复现说明前') : value
  const cards = kind === 'cards' && selected?.content ? historyCardPreview(selected.content) : null
  let reproduction: string | null = null
  if (kind === 'reproduction' && selected?.content) {
    try { reproduction = parseReproduction(selected.content)?.markdown ?? null } catch { /* Original remains available below; server rejects malformed restores. */ }
  }
  return <>
    <Button size="sm" variant="ghost" disabled={disabled} title={disabled ? (en ? 'Save your current draft first' : '请先保存当前草稿') : title}
      onClick={() => { setOpen(true); setNotice(''); setUndoId(null); void load() }}>{en ? 'Version history' : '版本历史'}</Button>
    <Modal open={open} title={title} wide className="pd-version-history" onClose={close}
      description={en ? 'Every edit saves its previous state. Restoring also saves the current state.' : '每次修改前自动保存旧版本；恢复时也会保存当前内容。'}
      footer={<><Button disabled={busy} onClick={close}>{en ? 'Close' : '关闭'}</Button>
        {undoId ? <Button disabled={busy || disabled || loading} onClick={() => void restore(undoId, undoHash)}>{en ? 'Undo restoration' : '撤销本次恢复'}</Button> : null}
        <Button variant="primary" loading={busy} disabled={!selected || disabled || loading} onClick={() => selected && void restore(selected.id)}>{en ? 'Restore this version' : '恢复此版本'}</Button></>}>
      <div className="pd-version-feedback" aria-live="polite">
        {error ? <p role="alert">{error} <Button size="sm" disabled={busy} onClick={() => void load()}>{en ? 'Reload history' : '重新加载历史'}</Button></p> : null}
        {notice ? <p>{notice}</p> : null}
      </div>
      <div className="pd-version-layout">
        <nav className="pd-version-list" aria-label={title}>
          {!loading && !versions.length ? <p>{en ? 'No versions yet. Versions appear after the next edit.' : '暂无历史版本，下一次修改时会自动保存。'}</p> : null}
          {versions.map((v) => <button type="button" key={v.id} aria-pressed={selected?.id === v.id} disabled={busy} onClick={() => void preview(v.id)}>
            <time>{new Date(v.createdAt).toLocaleString(en ? 'en-US' : 'zh-CN')}</time><span>{reason(v.reason)}</span>
            {!v.exists ? <small>{en ? 'Before creation' : '创建前'}</small> : null}
          </button>)}
        </nav>
        <section className="pd-version-preview" aria-label={en ? 'Version preview' : '版本预览'}>
          {loading ? <Spinner label={en ? 'Loading' : '加载中'} /> : !selected ? <p>{en ? 'Choose a version to preview before restoring.' : '选择版本，先预览内容再恢复。'}</p>
            : selected.content === null ? <p>{en ? 'The document did not exist then. Restoring removes the current document; its content remains recoverable.' : '此时尚未创建文件。恢复后会移除当前文件；当前内容仍保存在版本历史中。'}</p>
            : kind === 'notes' ? <Markdown markdown={selected.content} />
            : reproduction !== null ? <Markdown markdown={reproduction} />
            : cards ? <>{cards.length ? <p>{en ? `${cards.length} cards · restores the entire collection` : `${cards.length} 张卡片 · 恢复整个卡片集合`}</p> : <p>{en ? 'Empty card collection' : '空卡片集合'}</p>}{cards.map((c) => <article key={c.id}><h3>{c.title}</h3><Markdown markdown={c.body} /><p className="pd-panel-note">{c.tags.join(' · ')} {c.pages.map((page) => `p.${page}`).join(' · ')}</p></article>)}</>
            : <div><p role="alert">{en ? 'Unable to interpret this legacy card version. Review the original content before restoring.' : '此历史卡片格式异常，请先查看原始内容再决定是否恢复。'}</p><details><summary>{en ? 'Original content' : '原始内容'}</summary><pre>{selected.content}</pre></details></div>}
        </section>
      </div>
    </Modal>
  </>
}
