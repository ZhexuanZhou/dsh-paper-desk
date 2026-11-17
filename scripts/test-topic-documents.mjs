import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import path from 'node:path'
import os from 'node:os'
const root = await mkdtemp(path.join(os.tmpdir(), 'topic-documents-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
let server
let count = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); count++; console.log(`ok ${name}`) }
try {
  const { readResearch, saveTopic, setTopicStatus, updateResearch, saveTopicAnalysis, topicInputHash } = await import('../lib/research.js')
  const { editTopicDocument, readTopic, restoreTopicDocument } = await import('../lib/topicDocuments.js')
  const { listTopicRevisions, readTopicRevision, topicDocumentHash } = await import('../lib/topicHistory.js')
  const { registerTools } = await import('../lib/tools.js')
  const library = path.join(root, 'library'), sourceId = 'test-paper'
  await mkdir(path.join(library, 'papers', sourceId), { recursive: true })
  await writeFile(path.join(library, 'papers', sourceId, 'meta.json'), JSON.stringify({ id: sourceId, title: 'Synthetic source', authors: [], abstract: '', status: 'unread' }))
  let next = await saveTopic(library, { title: 'Topic', question: 'What is the evidence gap?', paperIds: [sourceId], notes: 'original\r\n$x>1$', baseHash: (await readResearch(library)).hash })
  let topic = next.document.topics[0], id = topic.id
  const edit = async (document, body) => { topic = await readTopic(library, id); next = await editTopicDocument(library, { topicId: id, document, expectedHash: topicDocumentHash(topic, document), ...body }); topic = next.document.topics[0]; return topic }
  check('legacy topic has no invented revisions', await listTopicRevisions(library, id, 'notes'), [])
  const oldHash = topicDocumentHash(topic, 'notes')
  await edit('notes', { markdown: '# Reorganized\n\n$x>1$\n\nNew evidence gap.' })
  const original = (await listTopicRevisions(library, id, 'notes'))[0]
  check('snapshot preserves raw CRLF and TeX', (await readTopicRevision(library, id, 'notes', original.id)).content, 'original\r\n$x>1$')
  await assert.rejects(() => editTopicDocument(library, { topicId: id, document: 'notes', expectedHash: oldHash, markdown: 'stale' }), { status: 409 }); count++
  check('stale edit leaves original rewrite intact', (await readTopic(library, id)).notes.includes('New evidence gap.'), true)
  await edit('analysis', { markdown: '# Main reading\n\nGrounded evidence (p.1)', sourcePaperIds: [sourceId] })
  check('main interpretation stores current definition and source IDs', [topic.analysis.question, topic.analysis.paperIds], ['What is the evidence gap?', [sourceId]])
  const reportHash = topicDocumentHash(topic, 'analysis')
  const definitionHash = topicInputHash(topic)
  await edit('analysis', { markdown: '# Newer interpretation\n\nGrounded evidence (p.1)', sourcePaperIds: [sourceId] })
  await assert.rejects(() => saveTopicAnalysis(library, { id, inputHash: definitionHash, expectedHash: reportHash, paperIds: [sourceId], markdown: 'Late generated overwrite' }), { status: 409 }); count++
  check('late generated report cannot overwrite a newer edit with the same question', (await readTopic(library, id)).analysis.markdown.includes('Newer'), true)

  const reportVersions = await listTopicRevisions(library, id, 'analysis')
  const reportBefore = reportVersions[0]
  const notesBeforeRestore = topic.notes
  next = await restoreTopicDocument(library, id, 'analysis', reportBefore.id, topicDocumentHash(topic, 'analysis')); topic = next.document.topics[0]
  check('analysis restoration recovers the selected complete report', topic.analysis.markdown, '# Main reading\n\nGrounded evidence (p.1)')
  check('restoring analysis leaves notes and definition intact', [topic.notes, topic.question, topic.paperIds], [notesBeforeRestore, 'What is the evidence gap?', [sourceId]])
  const blank = reportVersions.find(row => row.hash === '')
  next = await restoreTopicDocument(library, id, 'analysis', blank.id, topicDocumentHash(topic, 'analysis')); topic = next.document.topics[0]
  check('the original empty analysis version can be restored', topic.analysis, undefined)
  const undoReport = (await listTopicRevisions(library, id, 'analysis'))[0]
  next = await restoreTopicDocument(library, id, 'analysis', undoReport.id, topicDocumentHash(topic, 'analysis')); topic = next.document.topics[0]
  check('restoring an empty report is recoverable too', topic.analysis.markdown.includes('Grounded'), true)
  await edit('cards', { action: 'create', title: 'Evidence gap', body: '$x>1$ (p.1)', sourcePaperIds: [sourceId] })
  const firstCard = topic.cards[0]
  await edit('cards', { action: 'create', cardId: firstCard.id, title: 'Second', body: 'Different evidence', sourcePaperIds: [sourceId] })
  check('create always creates rather than overwriting a supplied existing ID', [topic.cards.length, topic.cards[0]], [2, firstCard])
  await edit('cards', { action: 'move', cardId: firstCard.id, position: 1 })
  check('cards can be reorganized without changing content', topic.cards[1], firstCard)
  await edit('cards', { action: 'update', cardId: firstCard.id, title: 'Updated gap' })
  check('partial edit preserves card body and source links', [topic.cards[1].body, topic.cards[1].sourcePaperIds], [firstCard.body, [sourceId]])
  await assert.rejects(() => edit('cards', { action: 'create', title: 'No source', body: 'x' }), { status: 400 }); count++
  const beforeBad = await readResearch(library)
  await assert.rejects(() => edit('cards', { action: 'create', title: 'Invalid', body: 'x', sourcePaperIds: ['foreign'] }), { status: 400 }); count++
  check('invalid source rejects the whole transaction', (await readResearch(library)).hash, beforeBad.hash)
  await assert.rejects(() => edit('analysis', { markdown: 'Wrong', sourcePaperIds: ['foreign'] }), { status: 400 }); count++
  check('topic cards do not create a paper card document', await readFile(path.join(library, 'papers', sourceId, 'cards.json'), 'utf8').catch(e => e.code), 'ENOENT')
  const finished = await setTopicStatus(library, { id, status: 'completed', baseHash: (await readResearch(library)).hash, markRead: true })
  const definition = { title: finished.document.topics[0].title, question: finished.document.topics[0].question, paperIds: finished.document.topics[0].paperIds, status: 'completed' }
  topic = await readTopic(library, id)
  next = await restoreTopicDocument(library, id, 'notes', original.id, topicDocumentHash(topic, 'notes')); topic = next.document.topics[0]
  check('restore recovers exact original bytes', topic.notes, 'original\r\n$x>1$')
  check('restore does not change definition or lifecycle', Object.fromEntries(Object.keys(definition).map(k => [k, topic[k]])), definition)
  check('restoring notes preserves cards and analysis', [topic.cards.length, topic.analysis.markdown.includes('Grounded')], [2, true])
  check('restoring notes preserves paper read state', JSON.parse(await readFile(path.join(library, 'papers', sourceId, 'meta.json'), 'utf8')).status, 'read')
  const revisions = await listTopicRevisions(library, id, 'notes')
  check('restore snapshots the replaced content for undo', (await readTopicRevision(library, id, 'notes', revisions[0].id)).content.includes('New evidence gap.'), true)
  const tools = new Map()
  registerTools({ register(tool) { tools.set(tool.name, tool); return () => {} } }, { libraryPath: library, language: 'zh', enrich: false, autoImportInbox: false, citationSync: false })
  const require = createRequire(import.meta.url), sdkRequire = createRequire(require.resolve('@deepseek-ai/dsh-tools'))
  const { snapshotJsonValue } = await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-util-values')))
  const run = async (name, args) => {
    const tool = tools.get(name), result = await tool.execute(args, { signal: new AbortController().signal })
    const detached = snapshotJsonValue(result)
    assert.notEqual(detached, undefined, `${name} lossless JSON`)
    assert.deepEqual(validateJsonSchemaValue(tool.output.schema, detached), [], `${name} schema`)
    assert.notEqual(snapshotJsonValue(tool.output.render(args, detached)), undefined, `${name} render`)
    count++; return result
  }
  const overview = await run('research_topic_read', { topicId: id })
  check('agent reads current topic identity and document hashes', [overview.ok, overview.topic.id, !!overview.documents.notes.hash], [true, id, true])
  await run('research_topic_read', { topicId: id, document: 'analysis' })
  const large = 'L'.repeat(22000)
  await edit('notes', { markdown: large })
  const page = await run('research_topic_read', { topicId: id, document: 'notes' })
  const page2 = await run('research_topic_read', { topicId: id, document: 'notes', offset: page.nextOffset })
  check('agent paginates before rewriting a large document', [page.truncated, page.markdown + page2.markdown, page2.truncated], [true, large, false])
  await run('research_topic_read', { topicId: id, document: 'cards', cardId: firstCard.id })
  const changed = await run('research_topic_edit', { topicId: id, document: 'notes', expectedHash: page.hash, markdown: '# Agent rewrite\n\n$x>1$' })
  check('agent edit actually persists Markdown', [changed.ok, (await readTopic(library, id)).notes], [true, '# Agent rewrite\n\n$x>1$'])
  const listed = await run('research_topic_history', { topicId: id, document: 'notes', action: 'list' })
  await run('research_topic_history', { topicId: id, document: 'notes', action: 'read', versionId: listed.versions[0].id })
  await run('research_topic_history', { topicId: id, document: 'notes', action: 'restore', versionId: original.id, expectedHash: changed.hash })
  const bad = await run('research_topic_edit', { topicId: id, document: 'cards', expectedHash: 'wrong', action: 'remove', cardId: firstCard.id })
  check('tool failure is observable without losing cards', [bad.ok, (await readTopic(library, id)).cards.length], [false, 2])
  await assert.rejects(() => readTopicRevision(library, '../outside', 'notes', original.id)); count++
  await assert.rejects(() => readTopicRevision(library, id, 'notes', '../outside')); count++
  const { buildRoutes } = await import('../lib/http.js')
  server = createServer((req, res) => { void buildRoutes({ libraryPath: library, language: 'zh', enrich: false })[0].handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/paper-desk`
  const api = async (route, method = 'GET', body) => { const res = await fetch(url + route, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() } }
  const versions = await api(`/research/history?topicId=${id}&kind=notes`)
  check('HTTP lists document versions and current hash', [versions.status, versions.data.revisions.length > 0, versions.data.hash], [200, true, topicDocumentHash(await readTopic(library, id), 'notes')])
  const preview = await api('/research/history', 'POST', { topicId: id, kind: 'notes', id: original.id })
  check('HTTP previews raw history without mutation', [preview.status, preview.data.content], [200, 'original\r\n$x>1$'])
  const stale = await api('/research/history', 'PUT', { topicId: id, kind: 'notes', id: original.id, expectedHash: 'stale' })
  check('HTTP refuses stale history restore', stale.status, 409)
  const restored = await api('/research/history', 'PUT', { topicId: id, kind: 'notes', id: original.id, expectedHash: versions.data.hash })
  check('HTTP restores the selected topic document', [restored.status, restored.data.document.topics[0].notes], [200, 'original\r\n$x>1$'])
  check('HTTP rejects invalid history kinds', (await api(`/research/history?topicId=${id}&kind=unknown`)).status, 400)
  const edited = await api('/research/document', 'POST', { topicId: id, document: 'notes', expectedHash: topicDocumentHash(await readTopic(library, id), 'notes'), markdown: 'HTTP rewrite' })
  check('HTTP agent editor updates the original rather than appending', [edited.status, edited.data.document.topics[0].notes], [200, 'HTTP rewrite'])
  const prepared = await api('/research/prompt', 'POST', { id, question: 'Compare evidence', paperIds: [sourceId], includeAnalysis: false })
  check('HTTP preparation exposes definition and current report versions', [prepared.status, typeof prepared.data.inputHash, prepared.data.analysisHash], [200, 'string', topicDocumentHash(await readTopic(library, id), 'analysis')])
  const reportBody = { id, inputHash: prepared.data.inputHash, expectedHash: prepared.data.analysisHash, paperIds: [sourceId], markdown: '# HTTP interpretation\n\nGrounded evidence (p.1)' }
  const report = await api('/research/analysis', 'POST', reportBody)
  check('HTTP persists generated report with the prepared version', [report.status, report.data.document.topics[0].analysis.markdown], [200, reportBody.markdown])
  check('HTTP late report cannot overwrite a newer saved report', (await api('/research/analysis', 'POST', { ...reportBody, markdown: 'LATE' })).status, 409)
  const beforeExternal = await readResearch(library)
  await assert.rejects(() => updateResearch(library, beforeExternal.hash, async (doc) => {
    doc.topics[0].notes = 'UNSAFE overwrite'
    await writeFile(path.join(library, '.paperdesk', 'research.json'), JSON.stringify({ ...beforeExternal.document, externalMarker: true }))
  }), { status: 409 }); count++
  check('detected external research update is not overwritten', JSON.parse(await readFile(path.join(library, '.paperdesk', 'research.json'), 'utf8')).externalMarker, true)
  next = await saveTopic(library, { title: 'Snapshot failure', question: 'Preserve content', paperIds: [sourceId], notes: 'SAFE original', baseHash: (await readResearch(library)).hash })
  const protectedTopic = next.document.topics.at(-1)
  const blockedDir = path.join(library, '.paperdesk', 'topic-history', protectedTopic.id)
  await mkdir(blockedDir, { recursive: true }); await writeFile(path.join(blockedDir, 'notes'), 'block directory')
  await assert.rejects(() => editTopicDocument(library, { topicId: protectedTopic.id, document: 'notes', expectedHash: topicDocumentHash(protectedTopic, 'notes'), markdown: 'UNSAFE edit' })); count++
  check('snapshot failure aborts the content update', (await readTopic(library, protectedTopic.id)).notes, 'SAFE original')
  console.log(`${count} topic document and tool checks passed`)
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  await rm(root, { recursive: true, force: true })
}
