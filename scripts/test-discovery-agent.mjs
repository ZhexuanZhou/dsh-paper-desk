import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const temp = await mkdtemp(path.join(os.tmpdir(), 'paper-discovery-'))
let count = 0
const check = (label, value, expected) => { assert.deepEqual(value, expected, label); count++; console.log(`ok ${label}`) }
const memory = new Map()
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) }
try {
  const pure = path.join(temp, 'pure.mjs')
  await build({ stdin: { contents: "export * from './client/discoveryAgent.ts'; export {reduceTranscript} from './client/aiSession.ts'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: pure })
  const { discoveryPrompt, discoveryResultTitle, normalizeDiscoveryTitle, parseWebSources, sourceImportUrl, reduceTranscript } = await import(pathToFileURL(pure))
  const source = { url: 'https://example.org/paper', title: 'A real source', snippet: 'Search snippet' }
  check('source parsing rejects script/file URLs and removes duplicate sources', parseWebSources({ sources: [source, source, {url:'javascript:alert(1)'}, {url:'file:///private/test.pdf'}, {url:'https://user:secret@example.org/'}] }), [source])
  check('malformed metadata never invents sources', parseWebSources('Sources: https://example.org'), [])
  for (const url of ['https://arxiv.org/abs/2602.01219', 'https://arxiv.org/pdf/cs/9901001v2', 'https://example.org/paper.pdf?download=1']) check(`explicit PDF/arXiv importer accepts ${url}`, sourceImportUrl(url), url)
  for (const url of ['https://arxiv.org.evil.org/abs/2602.01219', 'https://example.org/paper', 'https://arxiv.org/help', 'file:///a.pdf']) check(`landing page is not presented as directly importable: ${url}`, sourceImportUrl(url), null)
  const event = (seq, type, data) => ({ seq, type, data })
  const call = (id, name = 'web_search') => event(1, 'tool/call', { name, callId: id, arguments: JSON.stringify({ queries: ['low resource translation'] }) })
  const result = (id, extra = {}) => event(2, 'tool/result', { message: { source: { callId: id }, content: [{ type: 'text', text: 'Model-readable search result' }] }, meta: { sources: [source], truncated: false }, ...extra })
  check('paired successful web_search captures structured evidence', reduceTranscript([call('s'), result('s')], 'discovery')[0].webSources, [source])
  check('unpaired result cannot manufacture search evidence', reduceTranscript([result('unknown')], 'discovery').some(r => r.webSearch), false)
  check('other tool metadata is not web-search evidence', reduceTranscript([call('s', 'read'), result('s')], 'discovery')[0].webSearch, undefined)
  check('failed tool result does not expose evidence even with sources', reduceTranscript([call('s'), result('s', { error: { name: 'Error', code: 'unavailable' } })], 'discovery')[0].webSearch, undefined)
  check('legacy tool result with links in prose has no invented source', reduceTranscript([call('s'), result('s', { meta: undefined })], 'discovery')[0].webSources, [])
  const prompt = discoveryPrompt('小语种翻译\n重点：术语约束', 'zh')
  check('natural language input is preserved, not sent as provider syntax', prompt.includes('小语种翻译\n重点：术语约束') && prompt.includes('web_search') && prompt.includes('English academic terms'), true)
  check('discovery explicitly forbids automatic library changes', prompt.includes('Do not import') && prompt.includes('untrusted evidence'), true)
  check('topic title is generated within the existing search request', prompt.includes('start the final answer with exactly one H1') && prompt.includes('actual search results'), true)
  check('specific result heading names the search rather than the question prefix', discoveryResultTitle('# **术语约束翻译的模型与方案**\n\n正文', [source], '我想问一下翻译'), '术语约束翻译的模型与方案')
  check('code and link labels remain plain text in a result title', discoveryResultTitle('# `XLM` 与 [术语约束](https://example.org)\n\n说明', [], 'query'), 'XLM 与 术语约束')
  check('a legacy generic heading falls back to a source title', discoveryResultTitle('## 先说结论\n\n找到了相关方案。', [source], '长问题'), source.title)
  check('generic H1 headings do not hide a meaningful result source', discoveryResultTitle('# Search results\n\nBody', [source], 'query'), source.title)
  check('fenced code cannot manufacture a result title', discoveryResultTitle('```md\n# Incorrect title\n```', [source], 'query'), source.title)
  check('hostname placeholders do not become history titles', discoveryResultTitle('No heading', [{ ...source, title: 'example.org' }], '研究问题'), '研究问题')
  check('missing or failed results retain a readable question fallback', discoveryResultTitle('', [], '  用户问题\n 第二行  '), '用户问题 第二行')
  check('long titles are bounded by characters without splitting surrogate pairs', [Array.from(normalizeDiscoveryTitle('😀'.repeat(80))).length, normalizeDiscoveryTitle('😀'.repeat(80)).endsWith('…')], [64, true])

  const job = path.join(temp, 'job.mjs')
  await build({ entryPoints: ['client/discoverySearch.ts'], bundle: true, platform: 'node', format: 'esm', outfile: job, plugins: [{ name: 'controlled-session', setup(b) {
    b.onResolve({ filter: /aiSession\.js$/ }, () => ({ path: 'session', namespace: 'controlled' }))
    b.onLoad({ filter: /.*/, namespace: 'controlled' }, () => ({ contents: 'export const createAiThread = () => globalThis.__discoveryAi();', loader: 'js' }))
  } }] })
  const { discoverySearchStore } = await import(pathToFileURL(job))
  const controllers = []
  let calls = 0
  let openReject = false
  globalThis.__discoveryAi = () => {
    let state = { status: 'ready', rows: [] }
    const listeners = new Set()
    const emit = (next) => { state = next; listeners.forEach(f => f()) }
    const controller = { openThread: async () => { if (openReject) throw Error('unavailable session') }, getSnapshot: () => state,
      subscribe: f => { listeners.add(f); return () => listeners.delete(f) },
      run: async () => { calls++; emit({ status: 'running', rows: [] }); return { ok: true } },
      lastAnswer: () => state.rows.filter(r => r.kind === 'assistant').at(-1)?.text ?? null,
      stop: async () => emit({ status: 'ready', rows: state.rows }), dispose: () => listeners.clear(), emit }
    controllers.push(controller); return controller
  }
  const ctx = {}
  const store = discoverySearchStore(ctx, 'fixture')
  store.draft('小语种翻译\n可本地部署')
  check('draft survives component navigation via same workspace store', discoverySearchStore(ctx, 'fixture').getSnapshot().draft, '小语种翻译\n可本地部署')
  const first = store.start(store.getSnapshot().draft, 'zh')
  await new Promise(resolve => setImmediate(resolve))
  await store.start('duplicate', 'zh')
  check('double submission does not create another model request', calls, 1)
  controllers.at(-1).emit({ status: 'running', rows: [{ kind: 'tool', tool: '联网检索', text: 'low-resource translation', webSearch: true, webSources: [source] }, { kind: 'assistant', text: 'Partial', streaming: true }] })
  check('actual sources stream before answer completion', store.getSnapshot().searches[0].sources, [source])
  check('streaming is not a completed search', store.getSnapshot().searches[0].phase, 'running')
  controllers.at(-1).emit({ status: 'ready', rows: [{ kind: 'tool', text: '', webSearch: true, webSources: [source] }, { kind: 'assistant', text: '# 小语种术语翻译方案\n\nFinal $x>1$' }] })
  await first
  check('finished answer preserves original Markdown', [store.getSnapshot().searches[0].phase, store.getSnapshot().searches[0].markdown], ['complete', '# 小语种术语翻译方案\n\nFinal $x>1$'])
  check('completed result stores a topic title without changing the full original question', [store.getSnapshot().searches[0].title, store.getSnapshot().searches[0].query, calls], ['小语种术语翻译方案', '小语种翻译\n可本地部署', 1])
  check('browser reload restores saved sources and answer without new model call', [discoverySearchStore({}, 'fixture').getSnapshot().searches[0].sources, calls], [[source], 1])
  check('result title survives reopening', discoverySearchStore({}, 'fixture').getSnapshot().searches[0].title, '小语种术语翻译方案')
  const legacy = { ...store.getSnapshot(), searches: store.getSnapshot().searches.map(({ title, ...entry }) => ({ ...entry, markdown: '## 先说结论\n\n已有结果' })) }
  memory.set('paperdesk:discovery-search:legacy', JSON.stringify(legacy))
  check('old records acquire a result-based title without another request or deleting their query', [discoverySearchStore({}, 'legacy').getSnapshot().searches[0].title, discoverySearchStore({}, 'legacy').getSnapshot().searches[0].query, calls], [source.title, '小语种翻译\n可本地部署', 1])
  const second = store.start('diffusion language models', 'en'); await new Promise(resolve => setImmediate(resolve))
  check('new search does not reuse the previous source list', store.getSnapshot().searches[0].sources, [])
  await store.stop(); await second
  check('stop preserves an explicitly stopped result', store.getSnapshot().searches[0].phase, 'stopped')
  controllers.at(-1).emit({ status: 'ready', rows: [{ kind: 'assistant', text: 'late answer' }] })
  check('late cancellation result never replaces saved search', store.getSnapshot().searches[0].markdown, '')
  const noWeb = store.start('missing web tools', 'en'); await new Promise(resolve => setImmediate(resolve))
  controllers.at(-1).emit({ status: 'ready', rows: [{ kind: 'assistant', text: 'Remembered papers without a search' }] }); await noWeb
  check('model memory alone is not a successful web search', [store.getSnapshot().searches[0].phase, store.getSnapshot().searches[0].sources], ['error', []])
  openReject = true
  await store.start('failure', 'en')
  check('session failure is visible and retryable', [store.getSnapshot().searches[0].phase, store.getSnapshot().searches[0].error], ['error', 'unavailable session'])
  openReject = false
  for (let index = 0; index < 14; index++) {
    const run = store.start(`query ${index}`, 'en'); await new Promise(resolve => setImmediate(resolve)); await store.stop(); await run
  }
  check('history does not evict earlier searches after twelve entries', store.getSnapshot().searches.length, 18)
  const removed = store.getSnapshot().selected; store.remove(removed)
  check('user can delete a selected search without losing other history', [store.getSnapshot().searches.some(entry => entry.id === removed), store.getSnapshot().searches.length], [false, 17])
  check('a different workspace never inherits another library history', discoverySearchStore(ctx, 'other-fixture').getSnapshot().searches.length, 0)
  globalThis.localStorage.setItem = () => { throw Error('quota exceeded') }
  store.draft('still editable')
  check('storage errors are visible while draft stays editable', [store.getSnapshot().storageError, store.getSnapshot().draft], [true, 'still editable'])
  console.log(`${count} discovery Agent checks passed`)
} finally {
  delete globalThis.__discoveryAi; delete globalThis.localStorage
  await rm(temp, { recursive: true, force: true })
}
