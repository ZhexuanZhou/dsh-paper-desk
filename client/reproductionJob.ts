import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReproductionSnapshot } from '../src/types.js'
import { createAiThread } from './aiSession.js'
import type { AiThreadController } from './aiSession.js'
import { api } from './api.js'
import { browserDraftStore } from './topicDraft.js'

export type ReproductionPhase = 'idle' | 'preparing' | 'running' | 'saving' | 'complete' | 'stopped' | 'error'
export interface ReproductionJobState { phase: ReproductionPhase; markdown: string; instructions: string; error: string | null; warning: string | null; saved: ReproductionSnapshot | null; storageError: boolean }
const IDLE: ReproductionJobState = { phase: 'idle', markdown: '', instructions: '', error: null, warning: null, saved: null, storageError: false }
interface Job { state: ReproductionJobState; listeners: Set<() => void>; abort: AbortController | null; ai: AiThreadController | null; run: number }
const jobs = new WeakMap<ClientContext, Map<string, Job>>()
export function reproductionJobKey(library: string, paperId: string): string { return `reproduction:${library}:${paperId}` }
function getJob(ctx: ClientContext, key: string): Job {
  let map = jobs.get(ctx)
  if (!map) { map = new Map(); jobs.set(ctx, map) }
  let job = map.get(key)
  if (!job) {
    let state = IDLE
    try {
      const draft = JSON.parse(browserDraftStore()?.getItem(`paperdesk:${key}:generation`) ?? 'null') as Partial<ReproductionJobState> | null
      if (draft && typeof draft.markdown === 'string' && typeof draft.instructions === 'string' && draft.markdown.length <= 120000) state = { ...IDLE, phase: 'stopped', markdown: draft.markdown, instructions: draft.instructions, error: '上次生成未保存为正式说明，可查看草稿或重新生成。' }
    } catch { /* Invalid local drafts never overwrite a library document. */ }
    job = { state, listeners: new Set(), abort: null, ai: null, run: 0 }; map.set(key, job)
  }
  return job
}
export function reproductionJobState(ctx: ClientContext, key: string): ReproductionJobState { return getJob(ctx, key).state }
export function subscribeReproductionJob(ctx: ClientContext, key: string, listener: () => void): () => void { const job = getJob(ctx, key); job.listeners.add(listener); return () => { job.listeners.delete(listener) } }
function publish(job: Job, next: Partial<ReproductionJobState>) { job.state = { ...job.state, ...next }; for (const listener of job.listeners) listener() }
function persistDraft(job: Job, key: string): void {
  try {
    const store = browserDraftStore()
    if (!store) throw new Error('storage unavailable')
    if (job.state.phase === 'complete') store.removeItem(`paperdesk:${key}:generation`)
    else store.setItem(`paperdesk:${key}:generation`, JSON.stringify({ markdown: job.state.markdown, instructions: job.state.instructions }))
  } catch { publish(job, { storageError: true }) }
}

/** Request acknowledgement is not a completed answer. Wait for the actual turn. */
export async function completedAnswer(ai: AiThreadController, prompt: string, signal: AbortSignal, update: (markdown: string) => void): Promise<string> {
  signal.throwIfAborted()
  const baseline = new Set(ai.getSnapshot().rows.map((row) => row.id))
  return new Promise<string>((resolve, reject) => {
    let started = false, settled = false
    let unsubscribe = () => {}
    const finish = (answer?: string, error?: unknown) => {
      if (settled) return
      settled = true; unsubscribe(); clearTimeout(timer); signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(answer ?? '')
    }
    const abort = () => { void ai.stop(); finish(undefined, new DOMException('已停止生成。', 'AbortError')) }
    const timer = setTimeout(() => { void ai.stop(); finish(undefined, new Error('生成超时，原说明仍保留；可以查看未完成草稿后重试。')) }, 600000)
    signal.addEventListener('abort', abort, { once: true })
    unsubscribe = ai.subscribe(() => {
      if (signal.aborted || settled) return
      const state = ai.getSnapshot()
      const fresh = state.rows.filter((row) => !baseline.has(row.id))
      const markdown = fresh.filter((row) => row.kind === 'assistant').map((row) => row.text).join('\n\n')
      if (markdown) update(markdown)
      if (state.status === 'running') started = true
      if (state.status === 'error') finish(undefined, new Error(state.error || '生成失败。'))
      else if (started && state.status === 'ready' && !fresh.some((row) => row.running || row.streaming)) {
        const answer = ai.lastAnswer() || markdown
        if (!answer.trim()) finish(undefined, new Error('模型未返回复现说明，请重试。'))
        else finish(answer)
      }
    })
    if (signal.aborted) { abort(); return }
    void ai.run(prompt).then((result) => { if (!result.ok) finish(undefined, new Error(result.error || '无法开始生成。')) }, (error) => finish(undefined, error))
  })
}
export async function stopReproduction(ctx: ClientContext, key: string): Promise<void> {
  const job = getJob(ctx, key)
  if (job.state.phase === 'preparing' || job.state.phase === 'running') {
    const ai = job.ai
    job.abort?.abort()
    publish(job, { phase: 'stopped', error: '已停止生成；原说明仍保留。' }); persistDraft(job, key)
    await ai?.stop()
  }
}
export async function generateReproduction(ctx: ClientContext, workspacePath: string, paperId: string, instructions: string, language: 'zh' | 'en'): Promise<ReproductionSnapshot | null> {
  const key = reproductionJobKey(workspacePath, paperId), job = getJob(ctx, key)
  if (['preparing', 'running', 'saving'].includes(job.state.phase)) return null
  const abort = new AbortController(), ai = createAiThread(ctx)
  const run = ++job.run
  const update = (next: Partial<ReproductionJobState>) => { if (job.run === run) publish(job, next) }
  job.abort = abort; job.ai = ai
  update({ ...IDLE, phase: 'preparing', instructions })
  let checkpoint = 0
  const persist = () => {
    if (job.run === run) persistDraft(job, key)
  }
  const onPageHide = () => persist()
  window.addEventListener('pagehide', onPageHide)
  try {
    const payload = await api.reproductionPrompt(paperId, workspacePath, { intent: 'generate', instructions, language })
    abort.signal.throwIfAborted()
    update({ warning: payload.textWarning })
    await ai.openThread(`${key}:generation:${crypto.randomUUID()}`, { workspacePath, title: `${language === 'en' ? 'Reproduction guide' : '复现说明'} · ${paperId}` })
    abort.signal.throwIfAborted()
    update({ phase: 'running' })
    const answer = await completedAnswer(ai, payload.prompt, abort.signal, (markdown) => {
      update({ markdown })
      if (Date.now() - checkpoint > 750) { checkpoint = Date.now(); persist() }
    })
    abort.signal.throwIfAborted()
    update({ phase: 'saving', markdown: answer })
    const saved = await api.saveReproduction(paperId, workspacePath, { markdown: answer, instructions, expectedHash: payload.hash, generationSourceHash: payload.sourceHash })
    update({ phase: 'complete', saved, error: null })
    persist()
    return saved
  } catch (error) {
    update({ phase: abort.signal.aborted ? 'stopped' : 'error', error: error instanceof Error ? error.message : String(error) })
    persist()
    return null
  } finally {
    window.removeEventListener('pagehide', onPageHide)
    ai.dispose()
    if (job.run === run) { job.ai = null; job.abort = null }
  }
}
