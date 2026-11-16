/** Conversation navigation uses the same menu, buttons and modal as the library. */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PaperChat } from '../src/types.js'
import { Button, IconButton, Menu, Modal } from './ui.js'
import type { MenuItemDef } from './ui.js'
import { IconCheck, IconClose, IconEdit, IconPlus, IconTrash } from './icons.js'

export interface ChatBarLabels {
  title: string; create: string; rename: string; renamePlaceholder: string
  remove: string; removeConfirm: string; removeCancel: string; empty: string; more: string
}
export interface ChatBarProps {
  chats: readonly PaperChat[]; activeId: string | null; labels: ChatBarLabels
  onSelect: (chatId: string) => void; onCreate: () => void
  onRename: (chatId: string, title: string) => void; onRemove: (chatId: string) => void
  extraActions?: readonly MenuItemDef[]
}
export function ChatBar(props: ChatBarProps): ReactElement {
  const { chats, activeId, labels } = props
  const active = useMemo(() => chats.find((chat) => chat.id === activeId) ?? null, [chats, activeId])
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { setRenaming(false); setConfirming(false) }, [activeId])
  const rename = () => { if (active && draft.trim()) { props.onRename(active.id, draft.trim()); setRenaming(false) } }
  return <div className="pd-chat-bar">
    {renaming && active ? <div className="pd-chat-rename-form">
      <input className="pd-input pd-chat-rename" value={draft} maxLength={120} placeholder={labels.renamePlaceholder}
        aria-label={labels.renamePlaceholder} autoFocus onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter') { event.preventDefault(); rename() }
          if (event.key === 'Escape') { event.stopPropagation(); setRenaming(false) }
        }} />
      <IconButton label={labels.rename} disabled={!draft.trim()} onClick={rename}><IconCheck size={15} /></IconButton>
      <IconButton label={labels.removeCancel} onClick={() => setRenaming(false)}><IconClose size={15} /></IconButton>
    </div> : <>
      <Menu className="pd-chat-picker" label={`${labels.title}: ${active?.title || labels.empty}`} triggerLabel={active?.title || labels.empty}
        icon={<span aria-hidden="true">⌄</span>} disabled={!chats.length}
        items={chats.map((chat) => ({ id: chat.id, label: chat.title || labels.empty,
          ...(chat.id === activeId ? { icon: <IconCheck size={14} /> } : {}), onSelect: () => props.onSelect(chat.id) }))} />
      <Button className="pd-chat-new" size="sm" variant="ghost" icon={<IconPlus size={15} />} onClick={props.onCreate}>{labels.create}</Button>
      <Menu label={labels.more} className="pd-chat-more" items={[
        ...(active ? [
          { id: 'rename', label: labels.rename, icon: <IconEdit size={14} />, onSelect: () => { setRenaming(true); setDraft(active.title) } },
          { id: 'delete', label: labels.remove, icon: <IconTrash size={14} />, danger: true, onSelect: () => setConfirming(true) },
        ] : []), ...(props.extraActions ?? []),
      ]} />
    </>}
    <Modal open={confirming && active !== null} title={labels.remove} description={labels.removeConfirm} onClose={() => setConfirming(false)}
      footer={<><Button onClick={() => setConfirming(false)}>{labels.removeCancel}</Button><Button variant="danger" onClick={() => { if (active) { setConfirming(false); props.onRemove(active.id) } }}>{labels.remove}</Button></>} />
  </div>
}
