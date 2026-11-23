import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createAiThread } from './aiSession.js'
import { discoveryPrompt, discoveryResultTitle, normalizeDiscoveryTitle, parseWebSources, type WebSource } from './discoveryAgent.js'

export interface DiscoverySearch {
  id: string; query: string; title: string; createdAt: string
  phase: 'running' | 'complete' | 'stopped' | 'error'
  markdown: string; sources: WebSource[]; steps: string[]; searched: boolean; error: string | null
}
export interface DiscoverySearchState { draft: string; selected: string | null; searches: DiscoverySearch[]; storageError: boolean }
const stores = new WeakMap<ClientContext, Map<string, ReturnType<typeof makeStore>>>()

function makeStore(ctx: ClientContext, workspacePath: string) {
  const key = `paperdesk:discovery-search:${workspacePath}`
  let state: DiscoverySearchState = { draft: '', selected: null, searches: [], storageError: false }
  const listeners = new Set<() => void>()
  let cancel: (() => Promise<void>) | undefined
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (raw && typeof raw === 'object') {
      const saved = raw as Partial<DiscoverySearchState>
      const searches = Array.isArray(saved.searches) ? saved.searches.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.query === 'string' && typeof entry.createdAt === 'string').map((entry): DiscoverySearch => {
        const markdown = typeof entry.markdown === 'string' ? entry.markdown.slice(0, 100000) : ''
        const sources = parseWebSources({ sources: entry.sources })
        const title = typeof entry.title === 'string' && entry.title.trim() ? normalizeDiscoveryTitle(entry.title)
          : entry.phase === 'complete' ? discoveryResultTitle(markdown, sources, entry.query) : ''
        return {
          id: entry.id, query: entry.query.slice(0, 4000), title, createdAt: entry.createdAt,
          phase: entry.phase === 'complete' ? 'complete' : entry.phase === 'error' ? 'error' : 'stopped',
          markdown, sources, steps: [], searched: entry.searched === true,
          error: typeof entry.error === 'string' ? entry.error : null,
        }
      }) : []
      state = { ...state, searches, selected: searches.some((entry) => entry.id === saved.selected) ? saved.selected! : searches[0]?.id ?? null,
        draft: typeof saved.draft === 'string' ? saved.draft.slice(0, 4000) : '' }
    }
  } catch { state = { ...state, storageError: true } }
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const persistState = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined }
    try { localStorage.setItem(key, JSON.stringify(state)) }
    catch { state = { ...state, storageError: true }; listeners.forEach((listener) => listener()) }
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', persistState)
  const publish = (next: DiscoverySearchState, persist = true) => {
    state = next
    if (persist) persistState()
    else if (!saveTimer) saveTimer = setTimeout(persistState, 750)
    listeners.forEach((listener) => listener())
  }
  const update = (id: string, patch: Partial<DiscoverySearch>, persist = false) => publish({ ...state, searches: state.searches.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) }, persist)
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    draft(value: string) { publish({ ...state, draft: value.slice(0, 4000) }) },
    select(id: string) { publish({ ...state, selected: id }) },
    remove(id: string) {
      if (state.searches.some((entry) => entry.id === id && entry.phase === 'running')) return
      const searches = state.searches.filter((entry) => entry.id !== id)
      publish({ ...state, searches, selected: state.selected === id ? searches[0]?.id ?? null : state.selected })
    },
    clear() { if (!state.searches.some((entry) => entry.phase === 'running')) publish({ ...state, searches: [], selected: null }) },
    async stop() { await cancel?.() },
    async start(query: string, language: 'zh' | 'en') {
      if (!query.trim() || state.searches.some((entry) => entry.phase === 'running')) return
      const id = crypto.randomUUID()
      const record: DiscoverySearch = { id, query: query.trim().slice(0, 4000), title: '', createdAt: new Date().toISOString(), phase: 'running', markdown: '', sources: [], steps: [], searched: false, error: null }
      publish({ ...state, selected: id, searches: [record, ...state.searches] })
      const ai = createAiThread(ctx)
      let stopped = false
      let finish: (() => void) | undefined
      let unsub = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const stop = async () => {
        stopped = true
        update(id, { phase: 'stopped' }, true)
        finish?.()
        await ai.stop()
      }
      cancel = stop
      try {
        await ai.openThread(`discovery:${id}`, { workspacePath, title: `文献发现 · ${record.query.slice(0, 48)}` })
        if (stopped) return
        await new Promise<void>((resolve, reject) => {
          finish = resolve
          let running = false
          unsub = ai.subscribe(() => {
            if (stopped) return
            const snapshot = ai.getSnapshot()
            const rows = snapshot.rows
            const sources = parseWebSources({ sources: rows.flatMap((row) => row.webSources ?? []) })
            const searched = rows.some((row) => row.webSearch)
            const markdown = rows.filter((row) => row.kind === 'assistant').map((row) => row.text).join('\n\n')
            const steps = rows.filter((row) => row.kind === 'tool' || row.kind === 'error').map((row) => `${row.tool ?? ''}${row.tool ? ' · ' : ''}${row.text}`)
            update(id, { markdown, sources, searched, steps })
            if (snapshot.status === 'running') running = true
            if (snapshot.status === 'error') { reject(new Error(snapshot.error || 'Agent search failed')); return }
            if (running && snapshot.status === 'ready' && !rows.some((row) => row.streaming || row.running)) {
              update(id, { markdown: ai.lastAnswer() || markdown })
              resolve()
            }
          })
          timer = setTimeout(() => { void ai.stop(); reject(new Error(language === 'zh' ? '检索超时，请重试。' : 'Search timed out. Please retry.')) }, 600000)
          void ai.run(discoveryPrompt(record.query, language)).then((result) => { if (!result.ok) reject(new Error(result.error || 'Cannot start Agent search')) }, reject)
        })
        if (!stopped) {
          const completed = state.searches.find((entry) => entry.id === id)
          update(id, { phase: completed?.searched ? 'complete' : 'error',
            title: completed?.searched ? discoveryResultTitle(completed.markdown, completed.sources, completed.query) : '' }, true)
        }
      } catch (error) {
        if (!stopped) update(id, { phase: 'error', error: error instanceof Error ? error.message : String(error) }, true)
      } finally {
        unsub()
        if (timer) clearTimeout(timer)
        ai.dispose()
        if (cancel === stop) cancel = undefined
      }
    },
  }
}

/** Navigation keeps the active search alive; page reload keeps its last saved result. */
export function discoverySearchStore(ctx: ClientContext, workspacePath: string) {
  let map = stores.get(ctx)
  if (!map) { map = new Map(); stores.set(ctx, map) }
  let store = map.get(workspacePath)
  if (!store) { store = makeStore(ctx, workspacePath); map.set(workspacePath, store) }
  return store
}
