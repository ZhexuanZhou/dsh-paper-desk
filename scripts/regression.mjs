/** Focused contract checks. Runs only against a temporary library. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { queryPapers, searchLibrary } from '../lib/search.js'
import { discoveryScope, markDiscoveryAnalyzed } from '../lib/discovery.js'
import { readResearch, saveTopic, topicPrompt, saveSubscription, updateResearch } from '../lib/research.js'
import { arxivIdentity, parseArxivFeed } from '../lib/feed.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-regression-'))
let checks = 0
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name)
  checks++
  console.log(`ok ${name}`)
}
try {
  const meta = (id, title) => ({
    schemaVersion: 1,
    id,
    title,
    authors: ['Researcher'],
    year: 2026,
    venue: 'Test',
    doi: '',
    url: '',
    abstract: 'abstract-unique-signal',
    keywords: [],
    tags: [],
    status: 'unread',
    rating: 0,
    addedAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    pdfFile: null,
    pdfSha256: null,
    pageCount: 2,
    source: 'import',
    sourceUrl: '',
  })
  const a = meta('old-a', 'Retrieval termination evidence')
  for (const paper of [a, meta('old-b', 'Diffusion language models')]) {
    await mkdir(path.join(root, 'papers', paper.id), { recursive: true })
    await writeFile(path.join(root, 'papers', paper.id, 'meta.json'), JSON.stringify(paper))
  }
  await writeFile(path.join(root, 'papers', a.id, 'notes.md'), 'research-note-unique-marker')
  await writeFile(
    path.join(root, 'papers', a.id, 'text.json'),
    JSON.stringify({
      schemaVersion: 1,
      sourceSha256: 'sample',
      pageCount: 2,
      lowText: false,
      extractedAt: '2026-11-12',
      pages: [{ page: 1, text: 'body-unique-marker' }],
    }),
  )
  for (const query of [
    'abstract-unique-signal',
    'research-note-unique-marker',
    'body-unique-marker',
    'Researcher',
  ]) {
    check(
      `UI and tool match: ${query}`,
      (await queryPapers(root, { q: query })).map((row) => row.id).sort(),
      (await searchLibrary(root, query)).map((hit) => hit.paper.id).sort(),
    )
  }
  check('no false search hits', (await queryPapers(root, { q: 'unknown-needle' })).length, 0)
  check(
    'status filter remains effective',
    (await queryPapers(root, { q: 'abstract-unique-signal', status: 'read' })).length,
    0,
  )

  await markDiscoveryAnalyzed(root, [a], [a.id])
  const b = meta('new-b', 'Retrieval extensions'),
    c = meta('new-c', 'Retrieval agents')
  const relations = { schemaVersion: 1, updatedAt: '', items: [] }
  check(
    'two new unlinked papers include old candidates',
    (await discoveryScope(root, [a, b, c], relations)).scopeIds.includes(a.id),
    true,
  )
  check(
    'single new paper includes old candidates',
    (await discoveryScope(root, [a, b], relations)).scopeIds.includes(a.id),
    true,
  )
  const batch = Array.from({ length: 45 }, (_, i) => meta(`new-${i}`, `Retrieval ${i}`))
  const batchScope = await discoveryScope(root, [a, ...batch], relations)
  check('batch retains old candidate budget', batchScope.scopeIds.includes(a.id), true)
  check('batch scope stays bounded', batchScope.scopeIds.length, 40)
  check(
    'only transmitted new papers are marked eligible',
    batchScope.newIds.every((id) => batchScope.scopeIds.includes(id)),
    true,
  )

  const empty = await readResearch(root)
  const saved = await saveTopic(root, {
    title: 'Stopping conditions',
    question: 'What evidence supports termination?',
    notes: 'human-note',
    paperIds: [a.id],
    baseHash: empty.hash,
  })
  check('topic persisted without copying papers', (await readResearch(root)).document.topics[0].paperIds, [
    a.id,
  ])
  await assert.rejects(
    () => saveTopic(root, { title: 'stale', question: '?', notes: '', paperIds: [], baseHash: empty.hash }),
    { status: 409 },
  )
  checks++
  const prompt = await topicPrompt(root, saved.document.topics[0].id, 'Compare the evidence')
  check('topic prompt includes selected notes', prompt.includes('research-note-unique-marker'), true)
  check('topic prompt excludes unselected paper', prompt.includes('Diffusion language models'), false)
  await assert.rejects(
    () =>
      saveTopic(root, {
        title: 'bad',
        question: '?',
        notes: '',
        paperIds: ['../escape'],
        baseHash: saved.hash,
      }),
    { status: 400 },
  )
  checks++
  const subscribed = await saveSubscription(root, { query: 'retrieval', baseHash: saved.hash })
  check('saved search persists', (await readResearch(root)).document.subscriptions.length, 1)
  await assert.rejects(() => saveSubscription(root, { query: 'retrieval', baseHash: subscribed.hash }), {
    status: 409,
  })
  checks++
  const id = subscribed.document.subscriptions[0].id
  const marked = await updateResearch(root, subscribed.hash, (doc) => {
    doc.subscriptions.find((sub) => sub.id === id).lastChecked = '2026-11-12T00:00:00Z'
  })
  check('read checkpoint persists', marked.document.subscriptions[0].lastChecked, '2026-11-12T00:00:00Z')

  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2606.12345v2</id><title>Retrieval &amp; Evidence</title><summary>One &lt; two</summary><author><name>Author A</name></author><published>2026-11-11T00:00:00Z</published></entry><entry><id>http://arxiv.org/abs/2606.12345v1</id><title>Retrieval &amp; Evidence</title></entry></feed>`
  const found = parseArxivFeed(xml, [{ ...a, sourceUrl: 'https://arxiv.org/abs/2606.12345v1' }])
  check('Atom variants deduplicate', found.length, 1)
  check('Atom preserves authors/entities', found[0].authors, ['Author A'])
  check('library arXiv version matches', found[0].existingPaperId, a.id)
  const sameTitle = parseArxivFeed(xml, [{ ...a, title: 'Retrieval & Evidence', doi: '10.1000/different' }])[0]
  check('same title is not an authoritative duplicate', sameTitle.existingPaperId, null)
  check('same title remains visible as a candidate', sameTitle.possibleDuplicateId, a.id)
  check('non-arXiv URL is not an arXiv identity', arxivIdentity('https://example.org/2606.12345'), null)
  check(
    'legacy arXiv identifiers work',
    arxivIdentity('https://arxiv.org/pdf/hep-th/9901001v2.pdf'),
    'hep-th/9901001',
  )
  assert.throws(() => parseArxivFeed('<!DOCTYPE feed [<!ENTITY a SYSTEM "file:///secret">]><feed/>', []))
  checks++
  assert.throws(() => parseArxivFeed('<html>not atom</html>', []))
  checks++

  // Exercise the actual thread controller's host submission boundary.
  const out = path.join(root, 'ai.mjs')
  await build({
    entryPoints: ['client/aiSession.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
  })
  const { createAiThread } = await import(pathToFileURL(out))
  const storage = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout,
    clearTimeout,
  }
  globalThis.localStorage = window.localStorage
  let submitted
  const session = {
    sessionId: 'test-session',
    getSnapshot: () => ({ running: false }),
    subscribe: () => () => {},
    rename: async () => {},
    beginSubmission: () => ({ requestId: 'test-request' }),
    prompt: async (content) => {
      submitted = content
      return { ok: true }
    },
  }
  const services = {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace', path: root }] }) } },
    uiWorkspace: { connectWorkspace: async () => 'test-session' },
    sessions: {
      retain: async () => ({ binding: { sessionId: 'test-session', session }, release: () => {} }),
    },
  }
  const ai = createAiThread({ get: (name) => services[name] })
  await ai.openThread('paper:test', { workspacePath: root, title: 'Test' })
  const image = { type: 'image', mediaType: 'image/jpeg', data: '/9j/AA==', name: 'paper-page-2.jpg' }
  check('multimodal submission accepted', (await ai.run('Explain p.2', [image])).ok, true)
  check('image travels as canonical content, not text', submitted, [
    image,
    { type: 'text', text: 'Explain p.2' },
  ])
  await ai.run('Text only')
  check('ordinary questions do not attach images', submitted, [{ type: 'text', text: 'Text only' }])
  ai.dispose()

  // pdf.js 6 owns destruction on its loading task, not its document proxy.
  const imageModule = path.join(root, 'page-images.mjs')
  await build({
    entryPoints: ['client/pageImages.ts'], bundle: true, format: 'esm', platform: 'node', outfile: imageModule,
    plugins: [{ name: 'pdfjs-contract', setup(plugin) {
      plugin.onResolve({ filter: /\/pdfjs\.js$/ }, () => ({ path: 'pdfjs-contract', namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const loadPdfjs = async () => globalThis.__pdfFixture; export const pdfjsAsset = (path) => path;' }))
    } }],
  })
  let destroyed = 0
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => 'data:image/jpeg;base64,AQ==' }) }
  const documentProxy = { numPages: 2, getPage: async () => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve() }) }) }
  globalThis.__pdfFixture = { getDocument: () => ({ promise: Promise.resolve(documentProxy), destroy: async () => { destroyed++ } }) }
  const { renderPageImages } = await import(pathToFileURL(imageModule))
  check('page images render without document.destroy', (await renderPageImages('/fixture.pdf', [1]))[0].name, 'paper-page-1.jpg')
  check('successful image rendering cleans loading task', destroyed, 1)
  await assert.rejects(() => renderPageImages('/fixture.pdf', [3]), /超出论文范围/)
  check('invalid PDF page still cleans loading task', destroyed, 2)
  globalThis.__pdfFixture = { getDocument: () => ({ promise: Promise.reject(new Error('Unreadable PDF')), destroy: async () => { destroyed++ } }) }
  await assert.rejects(() => renderPageImages('/fixture.pdf', [1]), /Unreadable PDF/)
  check('failed PDF loading cleans loading task', destroyed, 3)
  console.log(`${checks} focused regression checks passed`)
} finally {
  await rm(root, { recursive: true, force: true })
}
