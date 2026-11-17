import { randomUUID } from 'node:crypto'
import { readResearch, updateResearch, topicInputHash } from './research.js'
import { recordReadingActivity } from './library.js'
import { readTopicRevision, topicDocumentHash, type TopicDocumentKind } from './topicHistory.js'
import type { ResearchTopic, ResearchSnapshot, TopicCard } from './types.js'

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status })
export async function readTopic(root: string, id: string): Promise<ResearchTopic> {
  const topic = (await readResearch(root)).document.topics.find((item) => item.id === id)
  if (!topic) throw fail('专题不存在。', 404)
  return topic
}
async function edit(root: string, id: string, kind: TopicDocumentKind, expectedHash: string, mutate: (topic: ResearchTopic) => void): Promise<ResearchSnapshot> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readResearch(root)
    try {
      return await updateResearch(root, current.hash, (doc) => {
        const topic = doc.topics.find((item) => item.id === id)
        if (!topic) throw fail('专题不存在。', 404)
        if (topicDocumentHash(topic, kind) !== expectedHash) throw Object.assign(fail('内容已变化，请重新读取后编辑。', 409), { staleDocument: true })
        mutate(topic)
        topic.updatedAt = new Date().toISOString()
      })
    } catch (error) {
      if ((error as { status?: number }).status !== 409 || (error as { staleDocument?: boolean }).staleDocument || attempt === 2) throw error
    }
  }
  throw fail('保存失败。')
}
function field(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(`内容不能为空且不能超过 ${max} 字符。`)
  return value
}
export async function editTopicDocument(root: string, body: Record<string, unknown>): Promise<ResearchSnapshot> {
  if (typeof body.topicId !== 'string' || typeof body.expectedHash !== 'string' || !['notes', 'analysis', 'cards'].includes(String(body.document))) throw fail('缺少专题、文档或版本。')
  const kind = body.document as TopicDocumentKind
  const saved = await edit(root, body.topicId, kind, body.expectedHash, (topic) => {
    if (kind === 'notes') topic.notes = field(body.markdown, 60000)
    else if (kind === 'analysis') {
      const markdown = field(body.markdown, 100000, true)
      const paperIds = Array.isArray(body.sourcePaperIds) ? [...new Set(body.sourcePaperIds)] : topic.analysis?.paperIds ?? topic.paperIds
      if (paperIds.some((id) => typeof id !== 'string' || !topic.paperIds.includes(id))) throw fail('解读引用的论文须属于专题。')
      topic.analysis = { markdown, inputHash: topicInputHash(topic), question: topic.question, definitionPaperIds: [...topic.paperIds], paperIds: paperIds as string[], updatedAt: new Date().toISOString() }
    } else {
      const cards = [...(topic.cards ?? [])]
      const index = cards.findIndex((card) => card.id === body.cardId)
      if (body.action === 'remove') { if (index < 0) throw fail('卡片不存在。', 404); cards.splice(index, 1) }
      else if (body.action === 'move') {
        if (index < 0 || !Number.isInteger(body.position) || Number(body.position) < 0 || Number(body.position) >= cards.length) throw fail('卡片位置不正确。')
        const [card] = cards.splice(index, 1); cards.splice(Number(body.position), 0, card!)
      } else {
        if (!['create', 'update'].includes(String(body.action)) || (body.action === 'update' && index < 0)) throw fail('卡片操作不正确。')
        if (body.action === 'create' && cards.length >= 200) throw fail('专题卡片已达200张，请先整理。')
        const old = body.action === 'update' ? cards[index] : undefined
        const sources = body.sourcePaperIds ?? old?.sourcePaperIds ?? []
        if (body.action === 'create' && (!Array.isArray(sources) || sources.length === 0)) throw fail('新建专题卡片须关联至少一篇来源论文。')
        if (!Array.isArray(sources) || sources.some((id) => typeof id !== 'string' || !topic.paperIds.includes(id))) throw fail('卡片来源须是专题中的论文。')
        const card: TopicCard = { id: old?.id ?? `tc-${randomUUID().slice(0, 8)}`, title: field(body.title ?? old?.title, 200, true), body: field(body.body ?? old?.body, 20000, true), sourcePaperIds: [...new Set(sources as string[])], createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() }
        if (old) cards[index] = card; else cards.push(card)
      }
      topic.cards = cards
    }
  })
  const topic = saved.document.topics.find((item) => item.id === body.topicId)!
  if (topic.status === 'completed' || (kind === 'notes' && !topic.notes.trim()) || (kind === 'cards' && !topic.cards?.length)) return saved
  const warnings: string[] = []
  for (const id of topic.paperIds) { const activity = await recordReadingActivity(root, id); if (activity.warning) warnings.push(activity.warning) }
  return { ...saved, ...(warnings.length ? { activityWarnings: warnings } : {}) }
}
export async function restoreTopicDocument(root: string, topicId: string, kind: TopicDocumentKind, id: string, expectedHash: string): Promise<ResearchSnapshot> {
  const revision = await readTopicRevision(root, topicId, kind, id)
  return edit(root, topicId, kind, expectedHash, (topic) => {
    if (kind === 'notes') topic.notes = revision.content ?? ''
    else if (kind === 'analysis') {
      if (revision.content === null) delete topic.analysis
      else { const value = JSON.parse(revision.content); if (typeof value.markdown !== 'string' || !Array.isArray(value.paperIds)) throw fail('解读历史损坏。'); topic.analysis = value }
    } else {
      const value = JSON.parse(revision.content ?? '[]')
      if (!Array.isArray(value) || value.some((card) => typeof card.id !== 'string' || typeof card.title !== 'string' || typeof card.body !== 'string' || !Array.isArray(card.sourcePaperIds))) throw fail('卡片历史损坏。')
      topic.cards = value
    }
  })
}
