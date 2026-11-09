/**
 * Paper-scoped conversation switcher shown above the AI drawer body.
 * Conversations are stored by the Host in `papers/<id>/chats.json`, so they
 * follow the paper and survive deleting their DSH sidebar session.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PaperChat } from '../src/types.js'
import { IconButton } from './ui.js'
import { IconCheck, IconClose, IconEdit, IconPlus, IconTrash } from './icons.js'

export interface ChatBarLabels {
  title: string
  create: string
  rename: string
  renamePlaceholder: string
  remove: string
  removeConfirm: string
  removeCancel: string
  empty: string
}

export interface ChatBarProps {
  chats: readonly PaperChat[]
  activeId: string | null
  labels: ChatBarLabels
  onSelect: (chatId: string) => void
  onCreate: () => void
  onRename: (chatId: string, title: string) => void
  onRemove: (chatId: string) => void
}

function shortTitle(chat: PaperChat): string {
  const title = chat.title.trim() === '' ? '新对话' : chat.title.trim()
  return title.length > 24 ? `${title.slice(0, 24)}…` : title
}

export function ChatBar(props: ChatBarProps): ReactElement {
  const { chats, activeId, labels } = props
  const active = useMemo(() => chats.find((chat) => chat.id === activeId) ?? null, [chats, activeId])
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setRenaming(false)
    setConfirming(false)
  }, [activeId])

  return (
    <div className="pd-chat-bar">
      <span className="pd-chat-bar-label">{labels.title}</span>
      {renaming && active !== null ? (
        <>
          <input
            className="pd-input pd-chat-rename"
            value={draft}
            maxLength={120}
            placeholder={labels.renamePlaceholder}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                props.onRename(active.id, draft.trim())
                setRenaming(false)
              } else if (event.key === 'Escape') {
                setRenaming(false)
              }
            }}
          />
          <IconButton
            label={labels.rename}
            onClick={() => {
              props.onRename(active.id, draft.trim())
              setRenaming(false)
            }}
          >
            <IconCheck size={13} />
          </IconButton>
          <IconButton label={labels.removeCancel} onClick={() => setRenaming(false)}>
            <IconClose size={13} />
          </IconButton>
        </>
      ) : (
        <>
          <select
            className="pd-chat-select"
            value={activeId ?? ''}
            onChange={(event) => props.onSelect(event.target.value)}
            aria-label={labels.title}
            disabled={chats.length === 0}
          >
            {chats.length === 0 ? <option value="">{labels.empty}</option> : null}
            {chats.map((chat) => (
              <option key={chat.id} value={chat.id}>
                {shortTitle(chat)}
              </option>
            ))}
          </select>
          <IconButton label={labels.create} onClick={props.onCreate}>
            <IconPlus size={13} />
          </IconButton>
          {active !== null ? (
            <>
              <IconButton
                label={labels.rename}
                onClick={() => {
                  setRenaming(true)
                  setDraft(active.title)
                }}
              >
                <IconEdit size={13} />
              </IconButton>
              <IconButton label={labels.remove} onClick={() => setConfirming(true)}>
                <IconTrash size={13} />
              </IconButton>
            </>
          ) : null}
        </>
      )}
      {confirming && active !== null ? (
        <span className="pd-chat-confirm" role="alert">
          {labels.removeConfirm}
          <button type="button" className="pd-btn pd-btn-sm pd-btn-ghost" onClick={() => setConfirming(false)}>
            {labels.removeCancel}
          </button>
          <button
            type="button"
            className="pd-btn pd-btn-sm pd-btn-danger"
            onClick={() => {
              setConfirming(false)
              props.onRemove(active.id)
            }}
          >
            {labels.remove}
          </button>
        </span>
      ) : null}
    </div>
  )
}
