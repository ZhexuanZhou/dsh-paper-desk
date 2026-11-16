import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-agent-actions-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
let checks = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`) }
try {
  const { registerTools } = await import('../lib/tools.js')
  const { readCards } = await import('../lib/cards.js')
  const { readerAgentInstruction, systemPromptText } = await import('../lib/prompt.js')
  const { effectiveSettings } = await import('../lib/settings.js')
  const library = path.join(root, 'library')
  const paperId = 'test-paper'
  await mkdir(path.join(library, 'papers', paperId), { recursive: true })
  await writeFile(path.join(library, 'papers', paperId, 'meta.json'), JSON.stringify({ id: paperId, title: 'Synthetic paper', authors: [], year: 2026 }))
  const tools = new Map()
  const config = { libraryPath: library, language: 'zh', enrich: false, autoImportInbox: false, maxPdfBytes: 0, citationSync: false }
  const dispose = registerTools({ register(def) { tools.set(def.name, def); return () => tools.delete(def.name) } }, config)
  const signal = new AbortController().signal
  const run = (name, args) => tools.get(name).execute(args, { signal })
  const card = (title, body) => ({ paperId, title, body, tags: ['test'], pages: [1] })
  const a = await run('paper_card_create', card('First', 'Evidence A (p.1)'))
  check('card create returns persisted identity and source', [a.ok, a.card.source, (await readCards(library, paperId)).items[0].id], [true, 'agent', a.card.id])
  const b = await run('paper_card_create', card('Second', 'Evidence B (p.1)'))
  const listed = await run('paper_cards', { paperId })
  const rendered = JSON.parse(tools.get('paper_cards').output.render({}, listed)[0].text)
  check('model can read all cards, IDs, tags and update versions', rendered.cards.map(c => [c.id, c.tags, c.updatedAt]), [a.card, b.card].map(c => [c.id, c.tags, c.updatedAt]))
  const before = (await readCards(library, paperId)).items
  const synthesis = await run('paper_card_create', card('Synthesis', 'A and B (p.1)'))
  check('synthesis preserves original cards byte-for-byte', (await readCards(library, paperId)).items.slice(0, 2), before)
  check('synthesis is a separate saved card', synthesis.count, 3)
  const updated = await run('paper_card_update', { paperId, cardId: a.card.id, expectedUpdatedAt: a.card.updatedAt, title: 'Updated' })
  check('requested update preserves body, source and creation time', [updated.ok, updated.card.body, updated.card.source, updated.card.createdAt], [true, a.card.body, a.card.source, a.card.createdAt])
  const stale = await run('paper_card_update', { paperId, cardId: a.card.id, expectedUpdatedAt: a.card.updatedAt, body: 'STALE' })
  check('stale update is rejected without overwriting', [stale.ok, (await readCards(library, paperId)).items[0].body], [false, a.card.body])
  await assert.rejects(() => run('paper_card_update', { paperId, cardId: a.card.id, body: 'UNSAFE' }), /expectedUpdatedAt/); checks++
  for (const args of [card('', 'body'), { ...card('Bad page', 'body'), pages: [0] }, { ...card('Bad id', 'body'), paperId: '../outside' }, { ...card('Missing paper', 'body'), paperId: 'nonexistent' }]) {
    check(`invalid card rejected: ${args.title || 'empty title'}`, (await run('paper_card_create', args)).ok, false)
  }
  const currentCount = (await readCards(library, paperId)).items.length
  await Promise.all(Array.from({ length: 8 }, (_, i) => run('paper_card_create', card(`Parallel ${i}`, `Body ${i}`))))
  check('parallel agent saves do not lose cards', (await readCards(library, paperId)).items.length, currentCount + 8)
  const note = await run('paper_note_append', { paperId, text: 'Explicitly requested note (p.1)', section: 'summary' })
  check('note action actually writes requested content', [note.ok, (await readFile(path.join(library, 'papers', paperId, 'notes.md'), 'utf8')).includes('Explicitly requested note')], [true, true])
  const notes = await run('paper_notes_read', { paperId })
  check('notes render includes hash and truncation state', JSON.parse(tools.get('paper_notes_read').output.render({}, notes)[0].text).hash, notes.hash)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(() => tools.get('paper_card_create').execute(card('Cancelled', 'body'), { signal: controller.signal })); checks++
  for (const language of ['zh', 'en']) {
    const policy = readerAgentInstruction(language)
    check(`system prompt includes natural language action policy: ${language}`, systemPromptText({ ...effectiveSettings(config), language }).includes(policy), true)
  }
  dispose()
  check('all action tools unregister', tools.size, 0)
  console.log(`${checks} agent action checks passed`)
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  await rm(root, { recursive: true, force: true })
}
