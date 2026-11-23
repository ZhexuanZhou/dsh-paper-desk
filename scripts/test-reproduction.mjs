import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

const temp = await mkdtemp(path.join(os.tmpdir(), 'paper-reproduction-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(temp, 'dsh-home')
let server, count = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); count++; console.log(`ok ${name}`) }
const rejects = async (name, run, expected) => { await assert.rejects(run, expected); count++; console.log(`ok ${name}`) }
try {
  const { readReproduction, writeReproduction, reproductionPrompt, reproductionReferences } = await import('../lib/reproduction.js')
  const { reproductionExport, parseReproduction, reproductionQuestionPayload } = await import('../lib/reproductionContract.js')
  const { listRevisions, readRevision, restoreRevision, documentState } = await import('../lib/history.js')
  const { readMeta, updateMeta, recordReadingActivity } = await import('../lib/library.js')
  const { sha256 } = await import('../lib/util.js')
  const { registerTools } = await import('../lib/tools.js')
  const { buildRoutes } = await import('../lib/http.js')
  const library = path.join(temp, 'library'), paperId = 'reproduction-paper', dir = path.join(library, 'papers', paperId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ id: paperId, title: 'Synthetic least squares', authors: ['Test Author'], year: 2026, doi: '10.0000/example', url: 'https://example.org/paper?token=private&id=42', sourceUrl: 'file:///private/paper.pdf', status: 'unread', addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
  const notes = '# Original notes\r\n\r\nKeep this judgment: $x>1$.\r\n'
  await writeFile(path.join(dir, 'notes.md'), notes)
  const config = { libraryPath: library, language: 'zh', enrich: false, autoImportInbox: false, maxPdfBytes: 0, citationSync: false }
  const tools = new Map()
  registerTools({ register(tool) { tools.set(tool.name, tool); return () => {} } }, config)
  const signal = new AbortController().signal
  const tool = async (name, args) => {
    const entry = tools.get(name), result = await entry.execute(args, { signal })
    const json = JSON.parse(JSON.stringify(result))
    check(`${name} result follows its real SDK schema`, validateJsonSchemaValue(entry.output.schema, json), [])
    check(`${name} render preserves model-readable JSON`, JSON.parse(entry.output.render(args, json)[0].text), json)
    return result
  }
  const empty = await readReproduction(library, paperId)
  check('opening an unused guide is read-only', [empty.document, empty.hash], [null, ''])
  check('read carries a non-path library identity', empty.libraryKey, sha256(library))
  const guide = '# Reproduction\r\n\r\n## Method\r\n$$\\nabla_w L = X^T(Xw-y)/n$$\r\n\r\n```python\ngrad = X.T @ (X @ w - y) / len(y)\n```\n\n## Missing details\nLearning rate is not specified (p.2). Use an explicit assumption, not an invented paper fact.\n'
  await rejects('a stale creation changes nothing', () => writeReproduction(library, paperId, { markdown: guide, expectedHash: 'stale' }), { status: 409 })
  check('failed creation leaves the file absent', (await readReproduction(library, paperId)).document, null)
  let saved = await writeReproduction(library, paperId, { markdown: guide, instructions: 'CPU; validate the core first', expectedHash: '', generationSourceHash: empty.sourceHash })
  check('generation records source provenance without experiment success', [saved.document.markdown, Boolean(saved.document.generatedAt), saved.document.executionVerified], [guide, true, undefined])
  check('generation is a reading activity, not a read-completion event', (await readMeta(library, paperId)).status, 'reading')
  check('source links contain neither local file paths nor credentials', saved.document.source.links, ['https://doi.org/10.0000/example', 'https://example.org/paper?id=42'])
  const exported = reproductionExport(saved.document)
  check('export retains exact raw TeX, code and CRLF body', exported.includes(guide), true)
  check('export can stand alone without plugin tools or earlier chat', exported.includes('论文与来源') && exported.includes('执行与交付要求') && exported.includes('CPU; validate') && !exported.includes(paperId) && !exported.includes('paper_text'), true)
  check('export distinguishes synthetic smoke tests from paper metrics', exported.includes('不得将合成数据跑通标成复现了论文指标'), true)
  check('English export has the same execution evidence boundary', reproductionExport(saved.document, 'en').includes('not evidence that an experiment ran or succeeded'), true)
  assert.throws(() => reproductionExport({ ...saved.document, markdown: '/Users/private-person/data' }), /本机路径/); count++
  check('generation does not touch notes or create replacement cards', [await readFile(path.join(dir, 'notes.md'), 'utf8'), await readFile(path.join(dir, 'cards.json'), 'utf8').catch(() => null)], [notes, null])
  const created = (await listRevisions(library, paperId, 'reproduction'))[0]
  check('first guide generation snapshots the missing document', (await readRevision(library, paperId, 'reproduction', created.id)).content, null)

  const initialHash = saved.hash
  const long = guide + 'Implementation detail and evidence.\n'.repeat(900)
  const edit = await tool('paper_reproduction_write', { paperId, expectedHash: saved.hash, libraryKey: saved.libraryKey, markdown: long, summary: 'Add implementation details' })
  check('conversation edit updates the same independent document', edit.ok, true)
  const first = await tool('paper_reproduction_read', { paperId })
  const second = await tool('paper_reproduction_read', { paperId, offset: first.nextOffset })
  check('paginated guide reads are lossless with a consistent hash', [first.truncated, second.truncated, first.markdown + second.markdown, first.hash === second.hash], [true, false, long, true])
  check('tool explicitly says the experiment is unverified', first.executionVerified, false)
  check('wrong-library edit is rejected', (await tool('paper_reproduction_write', { paperId, expectedHash: edit.hash, libraryKey: 'wrong', markdown: 'unsafe' })).ok, false)
  check('stale model edit is rejected', (await tool('paper_reproduction_write', { paperId, expectedHash: initialHash, libraryKey: saved.libraryKey, markdown: 'stale' })).ok, false)
  saved = await readReproduction(library, paperId)
  check('rejected writes leave the current guide intact', saved.document.markdown, long)
  const beforeEdit = (await listRevisions(library, paperId, 'reproduction')).find((item) => item.hash === initialHash)
  check('pre-edit history preserves exact guide bytes', parseReproduction((await readRevision(library, paperId, 'reproduction', beforeEdit.id)).content).markdown, guide)
  await restoreRevision(library, paperId, 'reproduction', beforeEdit.id, saved.hash)
  check('restore recovers the selected guide', (await readReproduction(library, paperId)).document.markdown, guide)
  const undo = (await listRevisions(library, paperId, 'reproduction')).find((item) => item.hash === saved.hash)
  await restoreRevision(library, paperId, 'reproduction', undo.id, (await readReproduction(library, paperId)).hash)
  check('restoration itself is reversible', (await readReproduction(library, paperId)).document.markdown, long)
  check('reproduction history does not create note or card versions', [await listRevisions(library, paperId, 'notes'), await listRevisions(library, paperId, 'cards')], [[], []])
  saved = await readReproduction(library, paperId)
  const writes = await Promise.allSettled([1, 2, 3].map((i) => writeReproduction(library, paperId, { markdown: `${guide}\nrevision ${i}`, expectedHash: saved.hash })))
  check('concurrent rewrites with one version have exactly one winner', writes.filter((item) => item.status === 'fulfilled').length, 1)
  check('other concurrent rewrites reject rather than overwrite', writes.filter((item) => item.status === 'rejected').map((item) => item.reason.status), [409, 409])
  await updateMeta(library, paperId, { status: 'read' })
  check('a reading-state change does not invalidate the source', (await readReproduction(library, paperId)).stale, false)
  await updateMeta(library, paperId, { title: 'Revised synthetic paper' })
  saved = await readReproduction(library, paperId)
  check('changed paper identity preserves the guide and exposes staleness', [saved.stale, saved.document.source.title], [true, 'Synthetic least squares'])
  await rejects('a late generated answer cannot claim a newer source', () => writeReproduction(library, paperId, { markdown: 'late', expectedHash: saved.hash, generationSourceHash: empty.sourceHash }), { status: 409 })
  const prompt = await reproductionPrompt(library, paperId, { intent: 'generate', instructions: 'CPU only' })
  check('missing PDF is an explicit evidence gap, not invented implementation', Boolean(prompt.textWarning) && prompt.prompt.includes('不得编造') && prompt.prompt.includes('CPU only'), true)
  check('generation asks for code mapping, shapes, tests and assumptions', ['张量形状', '原文依据', '待确认', '小规模', '不调用任何写入工具'].every((item) => prompt.prompt.includes(item)), true)
  const log = 'step=1 loss=1\n'.repeat(500)
  check('ordinary discussion accepts substantial execution logs', JSON.parse(reproductionQuestionPayload(log)).question, log)
  assert.throws(() => reproductionQuestionPayload('x'.repeat(16001)), /16000/); count++
  const comment = { id: 'c1', quote: '$X^T X$', comment: 'Explain the shape', version: saved.hash, section: 'Method', formulas: ['X^T X'] }
  const discussion = await reproductionPrompt(library, paperId, { intent: 'discussion', question: 'Update the guide', comments: [comment] })
  check('comments retain exact formula and document version', discussion.prompt.includes(JSON.stringify(comment)), true)
  check('discussion requires real writes and separates logs from verified execution', discussion.prompt.includes('paper_reproduction_write') && discussion.prompt.includes('实际可验证结果') && discussion.prompt.includes('expectedHash'), true)

  const meta = await readMeta(library, paperId)
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ ...meta, pdfFile: 'paper.pdf', pdfSha256: 'a'.repeat(64), pageCount: 3 }))
  await writeFile(path.join(dir, 'text.json'), JSON.stringify({ schemaVersion: 1, sourceSha256: 'a'.repeat(64), pageCount: 3, lowText: false, extractedAt: new Date().toISOString(), pages: [{ page: 1, text: 'A'.repeat(25000) }, { page: 2, text: 'B'.repeat(20000) }, { page: 3, text: 'Appendix details https://scikit-learn.org/stable/modules/linear_model.html' }] }))
  const bounded = await reproductionPrompt(library, paperId, { intent: 'generate' })
  check('context explicitly identifies truncated PDF coverage', [bounded.excerptPages, bounded.prompt.includes('(17000/20000 characters)'), Boolean(bounded.textWarning)], [[1, 2], true, true])
  check('bounded context tells the model to read remaining method and appendix pages', bounded.prompt.includes('用paper_text补读方法、实验和附录'), true)
  saved = await writeReproduction(library, paperId, { markdown: guide, expectedHash: (await readReproduction(library, paperId)).hash, generationSourceHash: bounded.sourceHash })
  check('explicit regeneration updates the source snapshot', saved.stale, false)
  check('PDF-provided related links carry a page and are separate from paper identity', saved.references, [{ url: 'https://scikit-learn.org/stable/modules/linear_model.html', page: 3 }])
  check('resource extraction preserves balanced parentheses and removes prose punctuation', reproductionReferences([{ page: 4, text: 'See (https://example.org/Function_(math)). Again https://example.org/Function_(math).' }]), [{ url: 'https://example.org/Function_(math)', page: 4 }])
  check('new generation policy includes numerical floors and separates runtime comparisons', ['分母设正数下限', '绝对与相对容差', '性能计时分开'].every((text) => bounded.prompt.includes(text)), true)

  server = createServer((req, res) => { void buildRoutes(config)[0].handler(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/paper-desk`
  const q = new URLSearchParams({ id: paperId, libraryPath: library })
  const http = async (route, method = 'GET', body) => { const res = await fetch(base + route, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() } }
  check('real API exposes the reproduction capability', (await http('/status')).data.features.reproduction, true)
  check('GET of a guide preserves the saved Markdown', (await http(`/reproduction?${q}`)).data.document.markdown, guide)
  check('wrong-library UI requests fail visibly', (await http(`/reproduction?id=${paperId}&libraryPath=wrong`)).status, 409)
  check('HTTP writes require an exact version', (await http(`/reproduction?${q}`, 'PUT', { markdown: 'bad' })).status, 400)
  check('HTTP rejects stale guide writes', (await http(`/reproduction?${q}`, 'PUT', { markdown: 'bad', expectedHash: 'old' })).status, 409)
  const task = await http(`/reproduction/export?${q}&expectedHash=${saved.hash}&language=en`)
  check('HTTP export is complete raw text, not rendered HTML', [task.status, task.data.markdown.includes(guide), task.data.markdown.includes('Execution and delivery requirements')], [200, true, true])
  check('export carries original PDF links even when the model omitted them', task.data.markdown.includes('https://scikit-learn.org/stable/modules/linear_model.html') && task.data.markdown.includes('PDF p.3') && task.data.markdown.includes('not web-verified'), true)
  check('exported numerical criteria cover zero denominators and nondeterministic timing', task.data.markdown.includes('positive denominator floor') && task.data.markdown.includes('real elapsed time'), true)
  check('export refuses an outdated on-screen version', (await http(`/reproduction/export?${q}&expectedHash=old`)).status, 409)
  const rows = await http(`/history?${q}&kind=reproduction`)
  check('shared history API exposes independent guide snapshots', rows.status === 200 && rows.data.versions.length > 0, true)
  check('guide history also enforces library scope', (await http(`/history?id=${paperId}&kind=reproduction`)).status, 409)
  const unchanged = (await readReproduction(library, paperId)).hash
  const validRevision = (await listRevisions(library, paperId, 'reproduction')).find((row) => row.exists)
  const revisionFile = path.join(library, '.paperdesk/history', paperId, 'reproduction', `${validRevision.id}.json`)
  const originalRevision = await readFile(revisionFile, 'utf8')
  const invalidRevision = JSON.parse(originalRevision)
  invalidRevision.content = '{"schemaVersion":1}'; invalidRevision.hash = sha256(invalidRevision.content)
  await writeFile(revisionFile, JSON.stringify(invalidRevision))
  await rejects('malformed guide snapshots cannot replace a valid document', () => restoreRevision(library, paperId, 'reproduction', validRevision.id, unchanged), /格式损坏/)
  check('failed malformed restore preserves the current file', (await documentState(library, paperId, 'reproduction')).hash, unchanged)
  await writeFile(revisionFile, originalRevision)
  check('all operations leave the original notes byte-identical', await readFile(path.join(dir, 'notes.md'), 'utf8'), notes)
  const legacyId = 'legacy-no-timestamps'
  await mkdir(path.join(library, 'papers', legacyId))
  await writeFile(path.join(library, 'papers', legacyId, 'meta.json'), JSON.stringify({ id: legacyId, title: 'Legacy paper', status: 'unread' }))
  const OriginalDate = globalThis.Date
  let clock = OriginalDate.now()
  globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [clock++])) } static now() { return clock++ } }
  try {
    check('legacy timestamp defaults cannot manufacture a concurrent edit', (await recordReadingActivity(library, legacyId)).status, 'reading')
  } finally { globalThis.Date = OriginalDate }

  const pure = path.join(temp, 'client.mjs')
  await build({ stdin: { contents: "export {reduceTranscript} from './client/aiSession.ts'; export * from './client/reproductionDraft.ts'; export * from './client/reproductionNavigation.ts'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: pure })
  const { reduceTranscript, reproductionDraftKey, readReproductionDraft, writeReproductionDraft, reproductionDiscardAction } = await import(pathToFileURL(pure))
  check('discard makes no write when the saved baseline is unchanged', reproductionDiscardAction('base', 'base', 'previous'), 'unchanged')
  check('discard can undo this editor save completed while its prompt was open', reproductionDiscardAction('base', 'own', 'own'), 'restore')
  check('discard cannot overwrite an external concurrent edit', reproductionDiscardAction('base', 'external', 'own'), 'conflict')
  const call = (id, name = 'paper_reproduction_write') => ({ seq: 1, type: 'tool/call', data: { name, callId: id, arguments: JSON.stringify({ paperId, kind: 'reproduction' }) } })
  const result = (id, value) => ({ seq: 2, type: 'tool/result', data: { message: { source: { callId: id }, content: [{ type: 'text', text: JSON.stringify(value) }] } } })
  check('a paired successful guide write produces a real receipt', reduceTranscript([call('w'), result('w', { ok: true, hash: saved.hash, summary: 'Updated' })], 'x')[0].reproductionMutation, { paperId, hash: saved.hash, summary: 'Updated' })
  check('a model claim alone never produces a write receipt', reduceTranscript([{ seq: 1, type: 'assistant/response', data: { content: [{ type: 'text', text: 'Guide saved!' }] } }], 'x').some((row) => row.reproductionMutation), false)
  check('a failed write remains visible and has no success receipt', reduceTranscript([call('w'), result('w', { ok: false, error: 'stale' })], 'x').map((row) => [row.kind, Boolean(row.reproductionMutation)]), [['tool', false], ['error', false]])
  check('an unpaired result cannot claim a guide update', reduceTranscript([result('unknown', { ok: true, hash: saved.hash })], 'x').some((row) => row.reproductionMutation), false)
  const store = new Map(), storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) }
  const key = reproductionDraftKey(library, paperId), draft = { markdown: guide, instructions: 'CPU', baseHash: saved.hash }
  writeReproductionDraft(storage, key, draft)
  check('editing drafts preserve source text and base version across reload', readReproductionDraft(storage, key), draft)
  check('drafts never cross library boundaries', readReproductionDraft(storage, reproductionDraftKey('other', paperId)), null)
  const failedStorage = { ...storage, setItem() { throw Error('quota') } }
  check('quota failure is observable rather than silent draft loss', writeReproductionDraft(failedStorage, key, { ...draft, instructions: 'Changed' }), false)
  check('latest unsaved content survives a browser storage failure in memory', readReproductionDraft(storage, key).instructions, 'Changed')
  writeReproductionDraft(storage, key, null)
  check('a saved draft can be cleared independently', readReproductionDraft(storage, key), null)

  // The Host seam is controlled here to verify lifecycle ordering, not model quality.
  globalThis.localStorage = storage
  globalThis.window = new EventTarget()
  const jobFile = path.join(temp, 'job.mjs')
  await build({ entryPoints: ['client/reproductionJob.ts'], bundle: true, platform: 'node', format: 'esm', outfile: jobFile, plugins: [{ name: 'controlled-host', setup(builder) {
    builder.onResolve({ filter: /aiSession\.js$/ }, () => ({ path: 'session', namespace: 'controlled' }))
    builder.onResolve({ filter: /\/api\.js$|^\.\/api\.js$/ }, () => ({ path: 'api', namespace: 'controlled' }))
    builder.onLoad({ filter: /.*/, namespace: 'controlled' }, ({ path: name }) => ({ contents: name === 'session' ? 'export const createAiThread = () => globalThis.__reproductionAi();' : 'export const api = globalThis.__reproductionApi;', loader: 'js' }))
  } }] })
  const controllers = [], saves = []
  let modelCalls = 0, rejectSave = false, rejectOpen = false, promptBarrier = null
  globalThis.__reproductionApi = {
    reproductionPrompt: async () => { if (promptBarrier) await promptBarrier; return { prompt: 'read-only guide', hash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), textWarning: null } },
    saveReproduction: async (id, library, body) => { if (rejectSave) throw Error('read-only disk'); saves.push({ id, library, body }); return { document: { markdown: body.markdown }, hash: 'c'.repeat(64) } },
  }
  globalThis.__reproductionAi = () => {
    let state = { status: 'ready', rows: [] }
    const listeners = new Set()
    const emit = (next) => { state = next; for (const listener of listeners) listener() }
    const controller = {
      getSnapshot: () => state, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
      openThread: async () => { if (rejectOpen) throw Error('session unavailable') },
      run: async () => { modelCalls++; emit({ status: 'running', rows: [] }); return { ok: true } },
      lastAnswer: () => state.rows.filter((row) => row.kind === 'assistant').at(-1)?.text ?? null,
      stop: async () => emit({ status: 'ready', rows: state.rows }), dispose: () => listeners.clear(), emit,
    }
    controllers.push(controller); return controller
  }
  const { generateReproduction, reproductionJobState, reproductionJobKey, stopReproduction } = await import(pathToFileURL(jobFile))
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  const ctx = {}, jobKey = reproductionJobKey('/portable-workspace', 'paper')
  const running = generateReproduction(ctx, '/portable-workspace', 'paper', 'CPU', 'zh')
  await flush()
  check('a generation starts exactly one Host request', modelCalls, 1)
  check('request acknowledgement is not treated as a saved guide', saves.length, 0)
  check('a second click during the same job does not submit another request', await generateReproduction(ctx, '/portable-workspace', 'paper', 'CPU', 'zh'), null)
  controllers.at(-1).emit({ status: 'running', rows: [{ id: 'a', kind: 'assistant', text: 'partial guide', streaming: true }] })
  check('generation publishes partial text without committing it', [reproductionJobState(ctx, jobKey).markdown, saves.length], ['partial guide', 0])
  controllers.at(-1).emit({ status: 'ready', rows: [{ id: 'a', kind: 'assistant', text: guide }] })
  await running
  check('only a completed answer is persisted with both version guards', saves[0].body, { markdown: guide, instructions: 'CPU', expectedHash: 'a'.repeat(64), generationSourceHash: 'b'.repeat(64) })
  check('completion clears its browser generation draft', storage.getItem(`paperdesk:${jobKey}:generation`), null)
  check('reopening the job state does not submit a model request', [reproductionJobState(ctx, jobKey).phase, modelCalls], ['complete', 1])
  const cancelled = generateReproduction(ctx, '/portable-workspace', 'paper', 'CPU', 'zh')
  await flush()
  const stoppedController = controllers.at(-1)
  stoppedController.emit({ status: 'running', rows: [{ id: 'p', kind: 'assistant', text: 'unfinished formula $x$', streaming: true }] })
  await stopReproduction(ctx, jobKey); await cancelled
  check('cancel preserves partial content and never saves it as complete', [reproductionJobState(ctx, jobKey).phase, reproductionJobState(ctx, jobKey).markdown, saves.length], ['stopped', 'unfinished formula $x$', 1])
  stoppedController.emit({ status: 'ready', rows: [{ id: 'late', kind: 'assistant', text: 'late completed answer' }] })
  check('late events after cancellation cannot overwrite the guide', saves.length, 1)
  const freshContext = {}
  check('refresh recovers an interrupted draft without resubmitting', [reproductionJobState(freshContext, jobKey).phase, reproductionJobState(freshContext, jobKey).markdown, modelCalls], ['stopped', 'unfinished formula $x$', 2])
  rejectSave = true
  const failedSave = generateReproduction(ctx, '/portable-workspace', 'paper', 'CPU', 'zh'); await flush()
  controllers.at(-1).emit({ status: 'ready', rows: [{ id: 'f', kind: 'assistant', text: 'complete but unsaved' }] }); await failedSave
  check('save failure is visible with complete unsaved text preserved', [reproductionJobState(ctx, jobKey).phase, reproductionJobState(ctx, jobKey).markdown, reproductionJobState(ctx, jobKey).error, saves.length], ['error', 'complete but unsaved', 'read-only disk', 1])
  rejectSave = false; rejectOpen = true
  await generateReproduction(ctx, '/portable-workspace', 'other-paper', '', 'en')
  check('Host session failure creates no additional model run', [reproductionJobState(ctx, reproductionJobKey('/portable-workspace', 'other-paper')).phase, modelCalls], ['error', 3])
  rejectOpen = false
  let unblock
  promptBarrier = new Promise((resolve) => { unblock = resolve })
  const preparing = generateReproduction(ctx, '/portable-workspace', 'pending-paper', '', 'zh')
  const pendingKey = reproductionJobKey('/portable-workspace', 'pending-paper')
  await stopReproduction(ctx, pendingKey)
  check('stop during PDF preparation responds immediately', reproductionJobState(ctx, pendingKey).phase, 'stopped')
  promptBarrier = null
  const replacement = generateReproduction(ctx, '/portable-workspace', 'pending-paper', 'new requirement', 'zh'); await flush()
  unblock(); await preparing
  check('late cancelled preparation cannot erase a newer running job', [reproductionJobState(ctx, pendingKey).phase, reproductionJobState(ctx, pendingKey).instructions], ['running', 'new requirement'])
  controllers.at(-1).emit({ status: 'ready', rows: [{ id: 'r', kind: 'assistant', text: 'replacement guide' }] }); await replacement
  check('the replacement job persists only its own answer and requirements', [saves.at(-1).body.markdown, saves.at(-1).body.instructions, modelCalls], ['replacement guide', 'new requirement', 4])
  delete globalThis.__reproductionApi; delete globalThis.__reproductionAi; delete globalThis.window; delete globalThis.localStorage
  console.log(`${count} reproduction checks passed`)
} finally {
  if (server) await new Promise((resolve) => server.close(resolve))
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  await rm(temp, { recursive: true, force: true })
}
