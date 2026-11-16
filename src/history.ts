/** Durable pre-edit snapshots shared by UI and agent writes. No automatic pruning. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { atomicWrite, safeJoin, sha256 } from './util.js'

import type { DocumentKind, Revision, RevisionSummary, DocumentState } from './types.js'
export type { DocumentKind, Revision, RevisionSummary, DocumentState } from './types.js'
export class DocumentConflict extends Error { readonly status = 409 }
let revisionClock = 0
const pending = new Map<string, Promise<unknown>>()

function validate(paperId: string, kind: DocumentKind): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(paperId)) throw new Error('invalid paper id')
  if (kind !== 'notes' && kind !== 'cards') throw new Error('invalid document kind')
}
function documentPath(root: string, paperId: string, kind: DocumentKind): string {
  validate(paperId, kind)
  return safeJoin(root, `papers/${paperId}/${kind === 'notes' ? 'notes.md' : 'cards.json'}`)
}
function historyPath(root: string, paperId: string, kind: DocumentKind): string {
  validate(paperId, kind)
  return safeJoin(root, `.paperdesk/history/${paperId}/${kind}`)
}
async function paperExists(root: string, paperId: string): Promise<void> {
  if (!(await stat(safeJoin(root, `papers/${paperId}/meta.json`))).isFile()) throw new Error('paper not found')
}
export async function documentState(root: string, paperId: string, kind: DocumentKind): Promise<DocumentState> {
  const file = documentPath(root, paperId, kind)
  let content: string | null
  try { content = await readFile(file, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; content = null }
  return { content, hash: content === null ? '' : sha256(content) }
}

/** Serialized within this Host. A cloud edit observed before commit is rejected. */
export async function editDocument(
  root: string, paperId: string, kind: DocumentKind,
  transform: (state: DocumentState) => string | null | Promise<string | null>,
  options: { expectedHash?: string; reason: string },
): Promise<DocumentState> {
  const file = documentPath(root, paperId, kind)
  const previous = pending.get(file) ?? Promise.resolve()
  const work = previous.catch(() => {}).then(async () => {
    await paperExists(root, paperId)
    const current = await documentState(root, paperId, kind)
    if (options.expectedHash !== undefined && options.expectedHash !== current.hash) throw new DocumentConflict('document changed; read the current version before editing')
    const next = await transform(current)
    if (next === current.content) return current
    revisionClock = Math.max(Date.now(), revisionClock + 1)
    const revision: Revision = {
      id: `v-${revisionClock.toString(16)}-${randomUUID().slice(0, 8)}`, paperId, kind,
      createdAt: new Date(revisionClock).toISOString(), reason: options.reason.trim().slice(0, 200),
      exists: current.content !== null, hash: current.hash, content: current.content,
    }
    const dir = historyPath(root, paperId, kind)
    await mkdir(dir, { recursive: true })
    // Snapshot failure aborts the edit. Preserve exact text/JSON bytes, not a normalized projection.
    await atomicWrite(safeJoin(dir, `${revision.id}.json`), JSON.stringify(revision, null, 2) + '\n')
    if ((await documentState(root, paperId, kind)).hash !== current.hash) throw new DocumentConflict('document changed while saving; no edit applied')
    if (next === null) await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    else await atomicWrite(file, next)
    return { content: next, hash: next === null ? '' : sha256(next) }
  })
  pending.set(file, work)
  try { return await work }
  finally { if (pending.get(file) === work) pending.delete(file) }
}

export async function readRevision(root: string, paperId: string, kind: DocumentKind, id: string): Promise<Revision> {
  if (!/^v-[a-f0-9]+-[a-f0-9]{8}$/.test(id)) throw new Error('invalid revision id')
  let text: string
  try { text = await readFile(safeJoin(historyPath(root, paperId, kind), `${id}.json`), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('version not found'), { status: 404 }); throw error }
  const raw: unknown = JSON.parse(text)
  const value = raw as Revision
  if (!value || value.id !== id || value.kind !== kind || value.paperId !== paperId ||
      (typeof value.content !== 'string' && value.content !== null) ||
      value.hash !== (value.content === null ? '' : sha256(value.content)) || value.exists !== (value.content !== null) ||
      typeof value.createdAt !== 'string' || typeof value.reason !== 'string') throw new Error('invalid history snapshot; original file preserved')
  return value
}
export async function listRevisions(root: string, paperId: string, kind: DocumentKind): Promise<RevisionSummary[]> {
  const dir = historyPath(root, paperId, kind)
  let names: string[]
  try { names = await readdir(dir) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return [] }
  const items: RevisionSummary[] = []
  for (const name of names.filter((name) => /^v-[a-f0-9]+-[a-f0-9]{8}\.json$/.test(name))) {
    const { content: _content, ...summary } = await readRevision(root, paperId, kind, name.slice(0, -5))
    items.push(summary)
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}
export async function restoreRevision(root: string, paperId: string, kind: DocumentKind, id: string, expectedHash: string): Promise<DocumentState & { changed: boolean }> {
  if (typeof expectedHash !== 'string') throw new Error('expectedHash is required')
  const revision = await readRevision(root, paperId, kind, id)
  let changed = false
  const result = await editDocument(root, paperId, kind, (current) => { changed = current.content !== revision.content; return revision.content }, { expectedHash, reason: `restore ${id}` })
  return { ...result, changed }
}
