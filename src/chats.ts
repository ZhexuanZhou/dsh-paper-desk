/**
 * Per-paper AI conversations stored inside the library (DESIGN-CHATS.md).
 *
 * Storage: `papers/<paperId>/chats.json`. The plugin owns the transcript, so a
 * conversation survives deleting its sidebar session and travels with the
 * library folder through cloud sync. DSH session ids are intentionally NOT
 * stored here (they are machine-local); the client caches them separately.
 */
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { ChatMessage, ChatsDocument, NewPaperChat, PaperChat } from './types.js'
import { fileInfo, nowIso, posixJoin, safeJoin, writeJsonFile } from './util.js'

export const CHATS_FILE = 'chats.json'

const PAPERS_DIR = 'papers'
const META_FILE = 'meta.json'
const INTERNAL_DIR = '.paperdesk'
const CONFLICTS_DIR = 'conflicts'
const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_CHAT_ID_LENGTH = 128

const LIMITS = {
  chats: 40,
  messages: 400,
  messageText: 50_000,
  title: 120,
} as const

function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function emptyDocument(paperId: string): ChatsDocument {
  return { schemaVersion: 1, paperId, updatedAt: nowIso(), items: [] }
}

function assertPaperId(paperId: string): void {
  if (typeof paperId !== 'string' || !PAPER_ID_RE.test(paperId)) {
    throw fail(`invalid paper id: ${String(paperId)}`, 400)
  }
}

function chatsPath(root: string, paperId: string): string {
  assertPaperId(paperId)
  return safeJoin(root, posixJoin(PAPERS_DIR, paperId, CHATS_FILE))
}

async function loadDocument(root: string, paperId: string): Promise<ChatsDocument> {
  const absPath = chatsPath(root, paperId)
  let raw: string
  try {
    raw = await readFile(absPath, 'utf8')
  } catch {
    return emptyDocument(paperId)
  }
  const parsed = parseDocument(raw, paperId)
  if (parsed === null) {
    await quarantineCorruptFile(root, absPath)
    return emptyDocument(paperId)
  }
  return parsed
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

function coerceMessage(raw: unknown): ChatMessage | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const role = record['role']
  const text = record['text']
  const at = record['at']
  if (role !== 'user' && role !== 'assistant') return null
  if (typeof text !== 'string') return null
  const normalized = normalizeText(text)
  if (normalized === '' || normalized.length > LIMITS.messageText) return null
  const timestamp = typeof at === 'string' && at !== '' ? at : nowIso()
  return { role, text: normalized, at: timestamp }
}

function coerceChat(raw: unknown, paperId: string): PaperChat | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const id = typeof record['id'] === 'string' ? record['id'] : ''
  if (!/^chat-[0-9a-f]{8}$/.test(id) && id !== '') return null
  const titleRaw = typeof record['title'] === 'string' ? normalizeText(record['title']) : ''
  const createdAt = typeof record['createdAt'] === 'string' ? record['createdAt'] : nowIso()
  const updatedAt = typeof record['updatedAt'] === 'string' ? record['updatedAt'] : createdAt
  const messages: ChatMessage[] = []
  if (Array.isArray(record['messages'])) {
    for (const item of record['messages']) {
      const message = coerceMessage(item)
      if (message !== null) messages.push(message)
      if (messages.length >= LIMITS.messages) break
    }
  }
  return {
    id: id === '' ? `chat-${randomBytes(4).toString('hex')}` : id,
    title: titleRaw.slice(0, LIMITS.title),
    createdAt,
    updatedAt,
    messages,
  }
}

function parseDocument(raw: string, paperId: string): ChatsDocument | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const items: PaperChat[] = []
  if (Array.isArray(record['items'])) {
    for (const item of record['items']) {
      const chat = coerceChat(item, paperId)
      if (chat !== null) items.push(chat)
      if (items.length >= LIMITS.chats) break
    }
  }
  return { schemaVersion: 1, paperId, updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : nowIso(), items }
}

async function quarantineCorruptFile(root: string, absPath: string): Promise<void> {
  const conflictsDirAbs = safeJoin(root, posixJoin(INTERNAL_DIR, CONFLICTS_DIR))
  await mkdir(conflictsDirAbs, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const destination = path.join(conflictsDirAbs, `chats-${stamp}${suffix}.json`)
    try {
      await copyFile(absPath, destination, constants.COPYFILE_EXCL)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
      if (code === 'EEXIST') continue
      throw error
    }
    try {
      await unlink(absPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return
  }
}

async function assertPaperExists(root: string, paperId: string): Promise<void> {
  const info = await fileInfo(safeJoin(root, posixJoin(PAPERS_DIR, paperId, META_FILE)))
  if (info === null) throw fail('paper not found', 404)
}

async function saveDocument(root: string, paperId: string, doc: ChatsDocument): Promise<ChatsDocument> {
  const next: ChatsDocument = { ...doc, updatedAt: nowIso() }
  await writeJsonFile(chatsPath(root, paperId), next)
  return next
}

export async function readChats(root: string, paperId: string): Promise<ChatsDocument> {
  return loadDocument(root, paperId)
}

export async function addChat(root: string, paperId: string, input: NewPaperChat): Promise<ChatsDocument> {
  await assertPaperExists(root, paperId)
  const doc = await loadDocument(root, paperId)
  if (doc.items.length >= LIMITS.chats) throw fail(`at most ${LIMITS.chats} chats per paper`, 400)
  const title = typeof input?.title === 'string' ? normalizeText(input.title).slice(0, LIMITS.title) : ''
  const chat: PaperChat = {
    id: `chat-${randomBytes(4).toString('hex')}`,
    title: title === '' ? '新对话' : title,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
  }
  doc.items = [chat, ...doc.items]
  return saveDocument(root, paperId, doc)
}

export async function updateChat(
  root: string,
  paperId: string,
  chatId: string,
  patch: { title?: string; messages?: ChatMessage[] },
): Promise<ChatsDocument> {
  if (typeof chatId !== 'string' || chatId.length === 0 || chatId.length > MAX_CHAT_ID_LENGTH) {
    throw fail('invalid chat id', 400)
  }
  const doc = await loadDocument(root, paperId)
  const index = doc.items.findIndex((item) => item.id === chatId)
  if (index < 0) throw fail('chat not found', 404)
  const current = doc.items[index]
  if (current === undefined) throw fail('chat not found', 404)
  let title = current.title
  if (patch.title !== undefined) {
    if (typeof patch.title !== 'string') throw fail('title must be a string', 400)
    title = normalizeText(patch.title).slice(0, LIMITS.title)
  }
  let messages = current.messages
  if (patch.messages !== undefined) {
    if (!Array.isArray(patch.messages)) throw fail('messages must be an array', 400)
    if (patch.messages.length > LIMITS.messages) throw fail(`at most ${LIMITS.messages} messages`, 400)
    messages = []
    for (const raw of patch.messages) {
      const message = coerceMessage(raw)
      if (message === null) throw fail('invalid chat message', 400)
      messages.push(message)
    }
  }
  doc.items[index] = { ...current, title, messages, updatedAt: nowIso() }
  return saveDocument(root, paperId, doc)
}

export async function deleteChat(root: string, paperId: string, chatId: string): Promise<ChatsDocument> {
  const doc = await loadDocument(root, paperId)
  const next = doc.items.filter((item) => item.id !== chatId)
  if (next.length === doc.items.length) throw fail('chat not found', 404)
  doc.items = next
  return saveDocument(root, paperId, doc)
}
