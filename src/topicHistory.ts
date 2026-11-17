/** Document snapshots for topics. Definition and lifecycle are not restored with a document. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { atomicWrite, safeJoin, sha256 } from './util.js'
import type { ResearchDocument, ResearchTopic } from './types.js'
export type TopicDocumentKind = 'notes' | 'analysis' | 'cards'
export interface TopicRevision { id: string; topicId: string; kind: TopicDocumentKind; content: string | null; hash: string; createdAt: string }
let clock = 0
export function topicDocumentContent(topic: ResearchTopic, kind: TopicDocumentKind): string | null {
  if (kind === 'notes') return topic.notes
  if (kind === 'analysis') return topic.analysis ? JSON.stringify(topic.analysis) : null
  return JSON.stringify(topic.cards ?? [])
}
export function topicDocumentHash(topic: ResearchTopic, kind: TopicDocumentKind): string { const value = topicDocumentContent(topic, kind); return value === null ? '' : sha256(value) }
function dir(root: string, topicId: string, kind: string): string {
  if (!/^topic-[0-9a-f-]{36}$/.test(topicId) || !['notes', 'analysis', 'cards'].includes(kind)) throw new Error('invalid topic history identity')
  return safeJoin(root, `.paperdesk/topic-history/${topicId}/${kind}`)
}
export async function snapshotTopicDocuments(root: string, before: ResearchDocument, after: ResearchDocument): Promise<void> {
  for (const topic of after.topics) {
    const old = before.topics.find((item) => item.id === topic.id)
    if (!old) continue
    for (const kind of ['notes', 'analysis', 'cards'] as const) {
      const content = topicDocumentContent(old, kind)
      if (content === topicDocumentContent(topic, kind)) continue
      clock = Math.max(Date.now(), clock + 1)
      const revision: TopicRevision = { id: `v-${clock.toString(16)}-${randomUUID().slice(0, 8)}`, topicId: topic.id, kind, content, hash: content === null ? '' : sha256(content), createdAt: new Date(clock).toISOString() }
      const path = dir(root, topic.id, kind)
      await mkdir(path, { recursive: true })
      await atomicWrite(safeJoin(path, `${revision.id}.json`), JSON.stringify(revision, null, 2) + '\n')
    }
  }
}
export async function readTopicRevision(root: string, topicId: string, kind: TopicDocumentKind, id: string): Promise<TopicRevision> {
  if (!/^v-[a-f0-9]+-[a-f0-9]{8}$/.test(id)) throw new Error('invalid revision id')
  const row = JSON.parse(await readFile(safeJoin(dir(root, topicId, kind), `${id}.json`), 'utf8')) as TopicRevision
  if (row.id !== id || row.topicId !== topicId || row.kind !== kind || (typeof row.content !== 'string' && row.content !== null) || row.hash !== (row.content === null ? '' : sha256(row.content))) throw new Error('invalid history snapshot')
  return row
}
export async function listTopicRevisions(root: string, topicId: string, kind: TopicDocumentKind): Promise<Omit<TopicRevision, 'content'>[]> {
  let names: string[]
  try { names = await readdir(dir(root, topicId, kind)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const result = []
  for (const name of names.filter((value) => /^v-[a-f0-9]+-[a-f0-9]{8}\.json$/.test(value))) {
    const { content: _, ...row } = await readTopicRevision(root, topicId, kind, name.slice(0, -5)); result.push(row)
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}
