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
import { arxivIdentity, parseArxivFeed, parseOpenAlexFeed } from '../lib/feed.js'
import { createDiscoveryTransport, retryAfterTime } from '../lib/discoveryTransport.js'

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

  const oaWork = {
    id: 'https://openalex.org/W123456', display_name: 'Diffusion language models',
    publication_date: '2026-10-01', doi: 'https://doi.org/10.48550/arxiv.2606.12345',
    primary_location: { landing_page_url: 'http://arxiv.org/abs/2606.12345v2', source: { display_name: 'arXiv' } },
    authorships: [{ author: { display_name: 'Author A' } }],
    abstract_inverted_index: { models: [2], Diffusion: [0], language: [1] },
  }
  const oa = parseOpenAlexFeed(JSON.stringify({ results: [oaWork, oaWork] }), [{ ...a, sourceUrl: 'https://arxiv.org/abs/2606.12345v1' }])
  check('OpenAlex reconstructs ordered abstract', oa[0].abstract, 'Diffusion language models')
  check('OpenAlex identifies existing arXiv versions', oa[0].existingPaperId, a.id)
  check('OpenAlex canonical PDF comes from arXiv identity', oa[0].pdfUrl, 'https://arxiv.org/pdf/2606.12345')
  check('OpenAlex arXiv DOI works without locations', parseOpenAlexFeed(JSON.stringify({ results: [{ ...oaWork, primary_location: null }] }), [])[0].pdfUrl, 'https://arxiv.org/pdf/2606.12345')
  check('OpenAlex results declare source and deduplicate IDs', [oa.length, oa[0].provider], [1, 'openalex'])
  const noPdf = parseOpenAlexFeed(JSON.stringify({ results: [{ ...oaWork, doi: 'https://doi.org/10.1000/example', primary_location: { landing_page_url: 'javascript:alert(1)' } }] }), [{ ...a, doi: '10.1000/example' }])[0]
  check('OpenAlex missing PDFs remain unavailable', noPdf.pdfUrl, null)
  check('OpenAlex DOI identifies library papers', noPdf.existingPaperId, a.id)
  check('OpenAlex rejects executable landing URLs', noPdf.url, oaWork.id)
  const oaTitle = parseOpenAlexFeed(JSON.stringify({ results: [oaWork] }), [{ ...a, title: oaWork.display_name }])[0]
  check('OpenAlex title alone is a warning', [oaTitle.existingPaperId, oaTitle.possibleDuplicateId], [null, a.id])

  let sourceDoc = await readResearch(root)
  // Existing schema-1 subscriptions without provider continue to mean arXiv.
  await writeFile(path.join(root, '.paperdesk/research.json'), JSON.stringify({ ...sourceDoc.document, subscriptions: [{ id: 'sub-legacy', query: 'legacy query', lastChecked: null }] }))
  sourceDoc = await readResearch(root)
  await assert.rejects(saveSubscription(root, { query: 'legacy query', baseHash: sourceDoc.hash }), /已订阅/)
  checks++
  sourceDoc = await saveSubscription(root, { query: 'legacy query', provider: 'openalex', baseHash: sourceDoc.hash })
  check('subscriptions distinguish providers and preserve legacy rows', sourceDoc.document.subscriptions.map((item) => item.provider ?? 'arxiv'), ['arxiv', 'openalex'])
  await assert.rejects(saveSubscription(root, { query: 'query', provider: 'unknown', baseHash: sourceDoc.hash }), /无效/)
  checks++

  let clock = 10_000
  let active = 0, maxActive = 0
  const timings = []
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  const network = createDiscoveryTransport({
    now: () => clock, sleep: async (ms) => { clock += ms }, validate: (_, text) => JSON.parse(text),
    fetch: async (url) => {
      active++; maxActive = Math.max(maxActive, active)
      const timing = { start: clock, end: 0, url: String(url) }; timings.push(timing)
      if (timings.length === 1) await firstGate
      clock += 500; timing.end = clock; active--
      return new Response('{}')
    },
  })
  const requests = [network.get('arxiv', 'one'), network.get('arxiv', 'one'), network.get('arxiv', 'two')]
  await Promise.resolve()
  releaseFirst()
  const answers = await Promise.all(requests)
  check('discovery single connection and coalesced duplicate requests', [maxActive, timings.length], [1, 2])
  check('arXiv gap begins after prior response completes', timings[1].start - timings[0].end, 3100)
  const cached = await network.get('arxiv', 'one')
  check('successful cache avoids network and preserves fetch time', [timings.length, cached.cacheHit, cached.fetchedAt], [2, true, answers[0].fetchedAt])
  await network.get('openalex', 'one')
  check('provider cache and endpoints stay separate', [timings.length, new URL(timings[2].url).hostname], [3, 'api.openalex.org'])

  let rateCalls = 0
  const cooling = createDiscoveryTransport({
    now: () => clock, sleep: async (ms) => { clock += ms }, validate: (_, text) => JSON.parse(text),
    fetch: async (url) => {
      if (new URL(url).hostname === 'api.openalex.org') return new Response('{}')
      rateCalls++
      return rateCalls === 1 ? new Response('Rate exceeded.', { status: 429 }) : new Response('{}')
    },
  })
  let limitedUntil = 0
  await assert.rejects(cooling.get('arxiv', 'new'), (error) => {
    limitedUntil = error.retryAt
    return error.status === 429 && error.code === 'DISCOVERY_RATE_LIMITED' && error.retryAt === clock + 60_000
  }); checks++
  await assert.rejects(cooling.get('arxiv', 'different query'), /限制请求/); checks++
  check('cooldown blocks new arXiv calls across queries', rateCalls, 1)
  await cooling.get('openalex', 'new')
  check('arXiv cooldown does not block chosen OpenAlex source', rateCalls, 1)
  clock = limitedUntil
  await cooling.get('arxiv', 'new')
  check('requests recover after cooldown', rateCalls, 2)
  check('Retry-After seconds honored', retryAfterTime('120', clock), clock + 120_000)
  check('Retry-After HTTP date honored', retryAfterTime(new Date(clock + 240_000).toUTCString(), clock), Math.floor((clock + 240_000) / 1000) * 1000)
  check('invalid Retry-After uses bounded default', retryAfterTime('invalid', clock), clock + 60_000)
  let malformedCalls = 0
  const malformed = createDiscoveryTransport({ now: () => clock, sleep: async (ms) => { clock += ms }, validate: (_, text) => JSON.parse(text), fetch: async () => { malformedCalls++; return new Response('not JSON') } })
  await assert.rejects(malformed.get('openalex', 'bad'), /请求失败/)
  await assert.rejects(malformed.get('openalex', 'bad'), /请求失败/)
  check('malformed responses never poison success cache', malformedCalls, 2)

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

  const markdownModule = path.join(root, 'markdown.mjs')
  await build({ entryPoints: ['client/markdown.tsx'], bundle: true, format: 'esm', platform: 'node', outfile: markdownModule })
  const { noteOutline, renderMarkdownSectioned } = await import(pathToFileURL(markdownModule))
  const note = '# Title\n\n## Summary\nA paragraph.\n\n```md\n## Not a section\n```\n\n> ## Quoted heading\n\n## Summary\nSecond section.\n'
  check('note outline excludes code and quoted headings', noteOutline(note).map((item) => item.label), ['Summary', 'Summary'])
  check('duplicate note headings keep distinct editor positions', noteOutline(note).map((item) => item.offset), [note.indexOf('## Summary'), note.lastIndexOf('## Summary')])
  check('outline also supports setext level-two headings', noteOutline('Section\n-------\nBody').map((item) => item.label), ['Section'])
  check('sectioned preview preserves both note sections', (renderMarkdownSectioned(note).match(/<h2>Summary<\/h2>/g) ?? []).length, 2)

  const longNote = '# Notes\n\n## Summary\n\n- Answer\n  - Nested evidence\n\n## Questions\n\n- Follow-up\n\n## My take\nDone'
  check('outline and preview agree after loose nested lists', noteOutline(longNote).map((item) => item.label), ['Summary', 'Questions', 'My take'])
  check('outline preserves source offsets after section splitting', noteOutline(longNote).map((item) => item.offset), ['Summary', 'Questions', 'My take'].map((label) => longNote.indexOf(`## ${label}`)))
  check('long fences protect embedded section-like lines', noteOutline('## First\n\n````md\n```\n## In code\n````\n\n## Last').map((item) => item.label), ['First', 'Last'])

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
