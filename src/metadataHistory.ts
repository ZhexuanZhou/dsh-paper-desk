/** Reversible editable metadata; PDF identity and storage paths never enter a restore. */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir } from 'node:fs/promises'
import type { PaperMeta, MetadataUndo } from './types.js'
import { atomicWrite, readJsonFile, safeJoin, sha256 } from './util.js'

export const METADATA_FIELDS = ['title','authors','year','venue','doi','url','abstract','keywords','tags','status','rating'] as const
export type EditableMetadata = Pick<PaperMeta, typeof METADATA_FIELDS[number]>
export interface MetadataRevision {
  id: string; paperId: string; before: EditableMetadata; after: EditableMetadata
  beforeHash: string; afterHash: string; action: 'edit' | 'undo' | 'redo'
}
export type { MetadataUndo } from './types.js'
export function editableMetadata(meta: PaperMeta): EditableMetadata {
  return Object.fromEntries(METADATA_FIELDS.map((key) => [key, meta[key]])) as unknown as EditableMetadata
}
export function metadataHash(meta: PaperMeta | EditableMetadata): string {
  return sha256(JSON.stringify(METADATA_FIELDS.map((key) => meta[key])))
}
export class MetadataConflict extends Error { readonly status = 409 }
function directory(root: string, paperId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(paperId)) throw new Error('invalid paper id')
  return safeJoin(root, `.paperdesk/metadata-history/${paperId}`)
}
let clock = 0
export async function snapshotMetadata(root: string, before: PaperMeta, after: PaperMeta, action: MetadataRevision['action'] = 'edit'): Promise<void> {
  const beforeHash = metadataHash(before), afterHash = metadataHash(after)
  if (beforeHash === afterHash) return
  clock = Math.max(Date.now(), clock + 1)
  const id = `m-${clock.toString(16)}-${randomUUID().slice(0, 8)}`
  const revision: MetadataRevision = { id, paperId: before.id, before: editableMetadata(before), after: editableMetadata(after), beforeHash, afterHash, action }
  const dir = directory(root, before.id)
  await mkdir(dir, { recursive: true })
  await atomicWrite(safeJoin(dir, `${id}.json`), JSON.stringify(revision, null, 2) + '\n')
}
export async function readMetadataRevision(root: string, paperId: string, id: string): Promise<MetadataRevision> {
  if (!/^m-[a-f0-9]+-[a-f0-9]{8}$/.test(id)) throw Object.assign(new Error('invalid metadata version'), { status: 400 })
  const revision = await readJsonFile<MetadataRevision>(safeJoin(directory(root, paperId), `${id}.json`))
  if (!revision || revision.id !== id || revision.paperId !== paperId || !revision.before || !revision.after ||
    metadataHash(revision.before) !== revision.beforeHash || metadataHash(revision.after) !== revision.afterHash ||
    !['edit','undo','redo'].includes(revision.action) ||
    [revision.before, revision.after].some((value) => Object.keys(value).length !== METADATA_FIELDS.length || Object.keys(value).some((key) => !(METADATA_FIELDS as readonly string[]).includes(key)))) throw new Error('invalid metadata version; current metadata preserved')
  return revision
}
export async function metadataUndoState(root: string, meta: PaperMeta): Promise<MetadataUndo> {
  const expectedHash = metadataHash(meta)
  const empty: MetadataUndo = { revisionId: null, expectedHash, action: 'undo', fields: [] }
  let names: string[]
  try { names = await readdir(directory(root, meta.id)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty; throw error }
  // Failed pre-write snapshots do not match the current content and are skipped.
  for (const file of names.filter((name) => /^m-[a-f0-9]+-[a-f0-9]{8}\.json$/.test(name)).sort().reverse()) {
    const revision = await readMetadataRevision(root, meta.id, file.slice(0, -5))
    if (revision.afterHash !== expectedHash) continue
    return { revisionId: revision.id, expectedHash, action: revision.action === 'undo' ? 'redo' : 'undo',
      fields: METADATA_FIELDS.filter((key) => JSON.stringify(revision.before[key]) !== JSON.stringify(revision.after[key])) }
  }
  return empty
}
