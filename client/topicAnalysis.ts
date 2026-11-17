import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createAiThread } from './aiSession.js'
import { api } from './api.js'
import type { ResearchSnapshot } from '../src/types.js'

export interface TopicAnalysisState { phase: 'idle' | 'running' | 'complete' | 'error'; markdown: string; error: string | null }
const IDLE: TopicAnalysisState = { phase: 'idle', markdown: '', error: null }
interface Job { state: TopicAnalysisState; listeners: Set<() => void>; stop: () => Promise<void> }
const jobs = new WeakMap<ClientContext, Map<string, Job>>()
function map(ctx: ClientContext): Map<string, Job> {
  let value = jobs.get(ctx)
  if (!value) { value = new Map(); jobs.set(ctx, value) }
  return value
}
export function topicAnalysisState(ctx: ClientContext, key: string): TopicAnalysisState { return map(ctx).get(key)?.state ?? IDLE }
export function subscribeTopicAnalysis(ctx: ClientContext, key: string, listener: () => void): () => void {
  let job = map(ctx).get(key)
  if (!job) { job = { state: IDLE, listeners: new Set(), stop: async () => {} }; map(ctx).set(key, job) }
  job.listeners.add(listener)
  return () => { job?.listeners.delete(listener) }
}
export async function stopTopicAnalysis(ctx: ClientContext, key: string): Promise<void> { await map(ctx).get(key)?.stop() }

/** Explicit creation/reanalysis starts one job. Reopening a saved topic never resubmits it. */
export async function startTopicAnalysis(
  ctx: ClientContext, key: string, workspacePath: string, id: string, question: string, paperIds: string[],
): Promise<ResearchSnapshot | null> {
  let job = map(ctx).get(key)
  if (job?.state.phase === 'running') return null
  if (!job) { job = { state: IDLE, listeners: new Set(), stop: async () => {} }; map(ctx).set(key, job) }
  const current = job
  const publish = (state: TopicAnalysisState) => { current.state = state; for (const listener of current.listeners) listener() }
  const ai = createAiThread(ctx)
  let cancelled = false
  let finish: (() => void) | undefined
  let unsubscribe = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  publish({ phase: 'running', markdown: '', error: null })
  current.stop = async () => { cancelled = true; await ai.stop(); publish({ phase: 'error', markdown: current.state.markdown, error: '解读已停止，可重新开始。' }); finish?.() }
  try {
    const payload = await api.topicPrompt(id, question, paperIds, false, 'analysis')
    if (cancelled) return null
    await ai.openThread(`topic-analysis:${id}:${Date.now()}`, { workspacePath, title: `专题解读 · ${question.slice(0, 48)}` })
    if (cancelled) return null
    const baseline = new Set(ai.getSnapshot().rows.map((row) => row.id))
    await new Promise<void>((resolve, reject) => {
      finish = resolve
      let running = false
      unsubscribe = ai.subscribe(() => {
        const state = ai.getSnapshot()
        const fresh = state.rows.filter((row) => !baseline.has(row.id))
        const text = fresh.filter((row) => row.kind === 'assistant').map((row) => row.text).join('\n\n')
        if (text) publish({ phase: 'running', markdown: text, error: null })
        if (state.status === 'running') running = true
        if (state.status === 'error') { reject(new Error(state.error || '专题解读失败。')); return }
        if (running && state.status === 'ready' && !fresh.some((row) => row.streaming || row.running)) {
          if (!text.trim()) reject(new Error('模型未返回解读内容，请重试。'))
          else { publish({ phase: 'running', markdown: ai.lastAnswer() || text, error: null }); resolve() }
        }
      })
      timer = setTimeout(() => { void ai.stop(); reject(new Error('专题解读超时，可重试；不会自动重复调用模型。')) }, 600000)
      void ai.run(`${payload.prompt}\n\n请围绕预设研究问题生成专题解读：先回答各个问题，再比较证据、差异与资料缺口。区分论文结论、推断和建议，标明论文与页码。给出可行方案、适用条件和优先验证步骤。只输出报告正文，由应用保存；不要调用任何写入工具，也不要把研究问题重述成等待用户继续提问的说明。`).then((result) => { if (!result.ok) reject(new Error(result.error || '无法开始解读。')) }, reject)
    })
    if (cancelled || current.state.phase === 'error') return null
    const saved = await api.saveTopicAnalysis(id, payload.inputHash, paperIds, current.state.markdown, payload.analysisHash)
    publish({ phase: 'complete', markdown: current.state.markdown, error: null })
    return saved
  } catch (error) {
    publish({ phase: 'error', markdown: current.state.markdown, error: error instanceof Error ? error.message : String(error) })
    return null
  } finally {
    unsubscribe()
    if (timer) clearTimeout(timer)
    ai.dispose()
    current.stop = async () => {}
  }
}
