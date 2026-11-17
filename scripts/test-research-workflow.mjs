import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { readMeta, updateMeta, recordReadingActivity } from '../lib/library.js'
import { writeNotes, readNotes } from '../lib/notes.js'
import { addCard } from '../lib/cards.js'
import { saveTopic, readResearch, setTopicStatus, topicPrompt, topicInputHash, saveTopicAnalysis } from '../lib/research.js'
import { queryPapers } from '../lib/search.js'
import { topicDocumentHash } from '../lib/topicHistory.js'
import { TOPIC_CONTEXT_CHAR_LIMIT } from '../lib/researchLimits.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'zhiyereading-'))
let count = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); count++; console.log(`ok ${name}`) }
const reject = async (name, task, expected) => { await assert.rejects(task, expected, name); count++; console.log(`ok ${name}`) }
try {
  const ids = Array.from({ length: 36 }, (_, i) => `paper-${i}`)
  for (const [i, id] of ids.entries()) {
    await mkdir(path.join(root, 'papers', id), { recursive: true })
    await writeFile(path.join(root, 'papers', id, 'meta.json'), JSON.stringify({ id, title: `Paper ${i}`, authors: [], status: i === 1 ? 'read' : i === 2 ? 'archived' : 'unread', abstract: `unique-${id}`, addedAt: new Date(i * 1000).toISOString() }))
  }
  const notes = await writeNotes(root, ids[0], '# Study\n\nactual notes', { baseHash: '' })
  check('actual saved notes promote unread', (await readMeta(root, ids[0])).status, 'reading')
  check('notes result exposes canonical activity', notes.activity.status, 'reading')
  await writeNotes(root, ids[1], '# Notes on a read paper', { baseHash: '' })
  await addCard(root, ids[2], { title: 'Archived card', body: 'evidence', source: 'user' })
  check('read and archived are never reopened by writing', [(await readMeta(root, ids[1])).status, (await readMeta(root, ids[2])).status], ['read', 'archived'])
  await addCard(root, ids[3], { title: 'New card', body: 'evidence', source: 'user' })
  check('manual cards promote unread', (await readMeta(root, ids[3])).status, 'reading')
  await updateMeta(root, ids[0], { status: 'unread' })
  const conflict = await writeNotes(root, ids[0], 'stale text', { baseHash: 'wrong' })
  check('conflicting note edit does not promote status', [conflict.conflict, (await readMeta(root, ids[0])).status], [true, 'unread'])
  const current = await readNotes(root, ids[0]); await writeNotes(root, ids[0], current.markdown, { baseHash: current.hash })
  check('no-op save does not start reading', (await readMeta(root, ids[0])).status, 'unread')
  await writeNotes(root, ids[4], '', { baseHash: '' })
  check('empty note does not start reading', (await readMeta(root, ids[4])).status, 'unread')
  await Promise.all([recordReadingActivity(root, ids[5]), updateMeta(root, ids[5], { status: 'read' })])
  check('metadata queue preserves an explicit completed state', (await readMeta(root, ids[5])).status, 'read')
  const empty = await readResearch(root)
  const saved = await saveTopic(root, { title: 'Large topic', question: 'Compare evidence', notes: '', paperIds: ids, baseHash: empty.hash })
  let topic = saved.document.topics[0]
  check('more than 30 papers are stored without truncation', topic.paperIds.length, 36)
  check('new topics default active', topic.status, 'active')
  check('new topic promotes only unread papers', [(await readMeta(root, ids[4])).status, (await readMeta(root, ids[1])).status, (await readMeta(root, ids[2])).status], ['reading', 'read', 'archived'])
  const scoped = await topicPrompt(root, topic.id, 'What differs?', [ids[0], ids[1]])
  check('explicit discussion scope includes selected evidence', scoped.includes('unique-paper-0') && scoped.includes('unique-paper-1'), true)
  check('explicit discussion scope excludes unselected evidence', scoped.includes('unique-paper-35'), false)
  check('scope explicitly reports partial coverage', scoped.includes('2 篇（专题共 36 篇）'), true)
  await reject('foreign papers cannot be silently added to a discussion', () => topicPrompt(root, topic.id, '?', ['foreign']), { status: 400 })
  await reject('empty discussion scope is rejected', () => topicPrompt(root, topic.id, '?', []), { status: 400 })
  await reject('malformed discussion scope is rejected', () => topicPrompt(root, topic.id, '?', 'all'), { status: 400 })
  for (const id of ids) { await updateMeta(root, id, { abstract: 'x'.repeat(1200) }); await writeFile(path.join(root, 'papers', id, 'notes.md'), 'n'.repeat(2000)) }
  await reject('oversized material is reported instead of silently dropping papers', () => topicPrompt(root, topic.id, '?'), (error) => error.status === 400 && error.message.includes(String(TOPIC_CONTEXT_CHAR_LIMIT)))
  const generated = await saveTopicAnalysis(root, { id: topic.id, inputHash: topicInputHash(topic), expectedHash: topicDocumentHash(topic, 'analysis'), paperIds: [ids[0]], markdown: '# Interpretation\n\n$x>1$ (p.1)' })
  topic = generated.document.topics[0]
  check('interpretation persists original Markdown and scope', [topic.analysis.markdown, topic.analysis.paperIds], ['# Interpretation\n\n$x>1$ (p.1)', [ids[0]]])
  check('interpretation records the original definition', [topic.analysis.question, topic.analysis.definitionPaperIds.length], ['Compare evidence', 36])
  const changed = await saveTopic(root, { ...topic, question: 'New question', baseHash: generated.hash })
  await reject('a late result cannot overwrite a changed research definition', () => saveTopicAnalysis(root, { id: topic.id, inputHash: topicInputHash(topic), expectedHash: topicDocumentHash(topic, 'analysis'), paperIds: [ids[0]], markdown: 'STALE' }), { status: 409 })
  check('old interpretation stays available after editing the definition', changed.document.topics[0].analysis.markdown.includes('$x>1$'), true)
  const finished = await setTopicStatus(root, { id: topic.id, status: 'completed', markRead: false, baseHash: changed.hash })
  check('topic completion without bulk read preserves reading status', [finished.document.topics[0].status, (await readMeta(root, ids[4])).status], ['completed', 'reading'])
  const marked = await setTopicStatus(root, { id: topic.id, status: 'completed', markRead: true, baseHash: finished.hash })
  check('explicit bulk completion marks linked papers read except archived', [(await readMeta(root, ids[4])).status, (await readMeta(root, ids[2])).status], ['read', 'archived'])
  await updateMeta(root, ids[4], { status: 'unread' })
  const reopened = await setTopicStatus(root, { id: topic.id, status: 'active', markRead: false, baseHash: marked.hash })
  check('reopening only promotes unread', [(await readMeta(root, ids[4])).status, (await readMeta(root, ids[1])).status], ['reading', 'read'])
  await reject('stale topic completion cannot update papers', () => setTopicStatus(root, { id: topic.id, status: 'completed', markRead: true, baseHash: marked.hash }), { status: 409 })
  check('stale completion leaves state active', (await readResearch(root)).document.topics[0].status, 'active')
  check('paginated source selection reaches papers beyond the first page', (await queryPapers(root, { sort: 'title', limit: 10, offset: 30 })).length, 6)
  await reject('wrong topic status is refused', () => setTopicStatus(root, { id: topic.id, status: 'unknown', baseHash: reopened.hash }), { status: 400 })
  console.log(`${count} research workflow checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
