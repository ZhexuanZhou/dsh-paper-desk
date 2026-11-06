/**
 * In-panel AI thread controller (DESIGN-AI.md §2.1–§2.2, DESIGN-FEATURES §6.1).
 *
 * One agent session per thread (`<paperId>` for a paper's AI tab, or an
 * arbitrary key such as `compare:<id1>,<id2>`), retained through the shell's
 * session controller and reduced into a small display transcript. The module is
 * pure data: no JSX, no API client, no React. Every optional runtime service is
 * resolved with `ctx.get(...)` and typed structurally because the installed
 * client-runtime types lag the shipped shell (same approach as `client/agent.ts`).
 *
 * Public surface:
 *   createAiThread(ctx)      — external-store controller (openThread/openPaper/…)
 *   reduceTranscript(...)    — pure event → AiRow[] reducer (exported for tests)
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ensurePaperWorkspace } from './agent.js'

export type AiRowKind = 'user' | 'assistant' | 'reasoning' | 'tool' | 'error' | 'status'

export interface AiRow {
  /** Stable key (event seq + kind + index). */
  id: string
  kind: AiRowKind
  /** Markdown for assistant, plain text otherwise. */
  text: string
  /** Friendly tool label for `tool` rows. */
  tool?: string
  /** Tool row is still executing. */
  running?: boolean
  /** Assistant text is still streaming. */
  streaming?: boolean
}

export interface AiThreadState {
  status: 'idle' | 'attaching' | 'ready' | 'running' | 'error'
  /** The open thread key: a paper id, `compare:<id1>,<id2>`, …, or null. */
  threadKey: string | null
  /** Convenience mirror of `threadKey` when it is a paper id, else null. */
  paperId: string | null
  sessionId: string | null
  rows: AiRow[]
  error: string | null
}

export interface AiThreadOptions {
  /** Workspace path (the library root). */
  workspacePath: string
  /**
   * Session title, used verbatim. `openPaper` builds `AI · <paperTitle>`;
   * direct `openThread` callers (comparisons) pass their own label.
   */
  title?: string
  /** Legacy per-paper title, wrapped as `AI · <paperTitle>` when `title` is absent. */
  paperTitle?: string
}

export interface AiThreadController {
  /** Open an arbitrary thread key and attach its retained session. */
  openThread(threadKey: string, options: AiThreadOptions): Promise<void>
  /** Open a paper's thread with the `AI · <paperTitle>` session name. */
  openPaper(paperId: string, options: AiThreadOptions): Promise<void>
  run(prompt: string): Promise<{ ok: boolean; error?: string }>
  stop(): Promise<void>
  /** Full text of the last assistant answer (for 保存到笔记). */
  lastAnswer(): string | null
  getSnapshot(): AiThreadState
  subscribe(listener: () => void): () => void
  dispose(): void
}

/* ── structural runtime views ─────────────────────────────────────────── */

interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionSnapshotLike {
  running?: boolean
}

interface SubmissionLike {
  requestId?: unknown
  abandon?(): void
}

interface SessionFaceLike {
  sessionId?: string
  getSnapshot?(): SessionSnapshotLike
  subscribe?(listener: () => void): () => void
  beginSubmission?(input: {
    mode: 'queue' | 'steer'
    text: string
    attachments: readonly unknown[]
  }): unknown
  prompt?(
    content: readonly unknown[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
    requestId?: unknown,
  ): Promise<unknown>
  cancel?(): Promise<unknown>
  rename?(title: string): Promise<unknown>
}

interface SessionBindingLike {
  sessionId?: string
  session?: SessionFaceLike
  eventSource?: SnapshotSource<unknown>
}

interface SessionReferenceLike {
  sessionId?: string
  binding?: SessionBindingLike
  ready?: PromiseLike<unknown>
  release?(): void
  dispose?(): void
}

interface SessionSummaryLike {
  title?: string
  displayTitle?: string
}

interface SessionsServiceLike {
  retain?(
    target: string,
    options: { source: 'controllerOperation'; signal?: AbortSignal },
  ): SessionReferenceLike | PromiseLike<SessionReferenceLike>
  binding?(id: string): SessionBindingLike | undefined
  list?: SnapshotSource<unknown>
}

interface UiWorkspaceLike {
  connectWorkspace?(workspaceId: string, options?: Record<string, unknown>): Promise<unknown>
  openSession?(target: string): void
}

interface Attachment {
  reference: SessionReferenceLike | null
  session: SessionFaceLike
  eventSource: SnapshotSource<unknown> | null
  threadKey: string
  sessionId: string
  unsubs: Array<() => void>
}

const CACHE_PREFIX = 'paperdesk:ai-thread:'
/** Pre-multi-thread key: read once and migrated to {@link CACHE_PREFIX}. */
const LEGACY_CACHE_PREFIX = 'paperdesk:ai-session:'

/** Friendly zh labels for the tools the PaperDesk agent can call. */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  paper_info: '查看论文元数据',
  paper_text: '读取正文',
  paper_search: '搜索论文库',
  paper_list: '浏览论文库',
  paper_annotations: '读取批注',
  paper_notes_read: '读取笔记',
  paper_note_append: '写入笔记',
  paper_add: '导入论文',
  paper_update: '更新元数据',
  paper_sync: '检查同步',
  web_search: '联网检索',
  web_fetch: '抓取网页',
  read: '读取本地文件',
  grep: '读取本地文件',
  glob: '读取本地文件',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  const record = asRecord(error)
  if (record !== null) {
    const message = record.message
    if (typeof message === 'string') return message.trim()
  }
  return ''
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/* ── transcript reducer helpers ───────────────────────────────────────── */

/** One event envelope, whether wrapped in a history entry or passed raw. */
function eventOf(entry: unknown): Record<string, unknown> | null {
  const record = asRecord(entry)
  if (record === null) return null
  const wrapped = asRecord(record.event)
  if (wrapped !== null) return wrapped
  if (typeof record.type === 'string' && (record.seq !== undefined || record.data !== undefined)) return record
  return null
}

function seqOf(event: Record<string, unknown>, fallback: number): number {
  const seq = event.seq
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : fallback
}

function partOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value !== '' ? value : '?'
}

/** Text blocks of one content array (non-text blocks skipped). */
function textBlocks(content: unknown, separator: string): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const candidate = asRecord(block)
    if (candidate === null) continue
    if (candidate.type !== 'text') continue
    const text = candidate.text
    if (typeof text === 'string' && text !== '') parts.push(text)
  }
  return parts.join(separator)
}

/** Plain text of a tool-result message under both logged content shapes. */
function toolResultText(message: Record<string, unknown> | null): string {
  if (message === null) return ''
  const content = message.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const candidate = asRecord(block)
    if (candidate === null) continue
    if (candidate.type === 'text' && typeof candidate.text === 'string' && candidate.text !== '') {
      parts.push(candidate.text)
      continue
    }
    if (candidate.type === 'tool-result' && Array.isArray(candidate.content)) {
      const nested = textBlocks(candidate.content, '\n')
      if (nested !== '') parts.push(nested)
    }
  }
  return parts.join('\n').trim()
}

/**
 * Failure message of a `turn/end` reason, an assistant attempt's finish chunk,
 * or a tool error. `{kind:'error'|'aborted', error|failure: {message}}` and a
 * bare LlmFailure ({message, code}) are both accepted; non-error outcomes
 * (completed/aborted/max-tokens) return undefined.
 */
function failureText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text !== '' ? text : undefined
  }
  const record = asRecord(value)
  if (record === null) return undefined
  const kind = record.kind
  if (typeof kind === 'string' && kind !== 'error') return undefined
  for (const key of ['error', 'failure'] as const) {
    const details = asRecord(record[key])
    const message = details?.message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  const message = record.message
  return typeof message === 'string' && message.trim() !== '' ? message : undefined
}

function describeError(value: unknown): string {
  const text = failureText(value)
  if (text !== undefined) return text
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined || serialized === '{}' ? 'The tool call failed.' : serialized
  } catch {
    return 'The tool call failed.'
  }
}

/** The failure carried by an `assistant/attempt` durable stream, if any. */
function attemptFailure(stream: unknown): string | undefined {
  if (!Array.isArray(stream)) return undefined
  for (const record of stream) {
    const candidate = asRecord(record)
    if (candidate === null || candidate.type !== 'chunk') continue
    const chunk = asRecord(candidate.chunk)
    if (chunk === null || chunk.type !== 'finish') continue
    const text = failureText(chunk.reason)
    if (text !== undefined) return text
  }
  return undefined
}

/** User messages hidden from the panel: injected context, not typed input. */
function isInjectedUserMessage(data: Record<string, unknown>): boolean {
  const source = asRecord(data.source)
  if (source === null) return false
  const kind = source.kind
  return typeof kind === 'string' && kind !== 'user'
}

function toolLabel(name: string): string {
  const label = TOOL_LABELS[name]
  return label !== undefined ? label : name
}

/** One-line argument summary shown after a tool row's friendly name. */
function toolDetail(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try {
    const parsed = asRecord(JSON.parse(raw))
    if (parsed !== null) {
      for (const key of ['query', 'path', 'file_path', 'pattern', 'url', 'prompt', 'command']) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim() !== '') return truncate(value, 80)
      }
      const pages = parsed.pages
      if (Array.isArray(pages)) {
        const numbers = pages.filter((page): page is number => typeof page === 'number' && Number.isFinite(page))
        if (numbers.length > 0) return numbers.map((page) => `p.${page}`).join(', ')
      }
      const page = parsed.page
      if (typeof page === 'number' && Number.isFinite(page)) return `p.${page}`
    }
  } catch {
    // Arguments are model-generated text; never let a parse failure escape.
  }
  return undefined
}

/**
 * Pure reducer: session event window → display rows (DESIGN-AI §2.2).
 * Defensive against malformed entries: unknown shapes are ignored and the
 * function never throws.
 *
 * @param entries - `SessionEventLikeEntry[]` (`{type:'event'|'transient', event}`).
 * @param paperId - owning paper (kept for API symmetry; rows are thread-local).
 * @returns rows in durable log order, streaming last.
 */
export function reduceTranscript(entries: readonly unknown[], paperId: string): AiRow[] {
  // The reducer is paper-agnostic: one window belongs to one paper already.
  void paperId
  const rows: AiRow[] = []
  /** `${turn}:${step}:${block}:${kind}` → index of its accumulating stream row. */
  const streamRows = new Map<string, number>()
  /** tool callId → index of its tool row (result pairing). */
  const callRows = new Map<string, number>()
  /** Turns that already rendered a failure row (attempt error == turn/end error). */
  const errorTurns = new Set<number>()
  let counter = 0

  const makeRow = (kind: AiRowKind, text: string, seq: number, extra?: {
    tool?: string
    running?: boolean
    streaming?: boolean
  }): AiRow => {
    const row: AiRow = { id: `${seq}:${kind}:${counter++}`, kind, text }
    if (extra !== undefined) {
      if (extra.tool !== undefined) row.tool = extra.tool
      if (extra.running !== undefined) row.running = extra.running
      if (extra.streaming !== undefined) row.streaming = extra.streaming
    }
    return row
  }

  const pushRow = (kind: AiRowKind, text: string, seq: number, extra?: {
    tool?: string
    running?: boolean
    streaming?: boolean
  }): number => {
    rows.push(makeRow(kind, text, seq, extra))
    return rows.length - 1
  }

  const shiftMaps = (from: number, delta: number): void => {
    if (delta === 0) return
    for (const map of [callRows, streamRows]) {
      for (const [key, value] of [...map.entries()]) {
        if (value >= from) map.set(key, value + delta)
      }
    }
  }

  const removeRowAt = (index: number): void => {
    if (index < 0 || index >= rows.length) return
    rows.splice(index, 1)
    for (const map of [callRows, streamRows]) {
      for (const [key, value] of [...map.entries()]) {
        if (value === index) map.delete(key)
        else if (value > index) map.set(key, value - 1)
      }
    }
  }

  const insertRowsAt = (index: number, items: readonly AiRow[]): void => {
    if (items.length === 0) return
    rows.splice(index, 0, ...items)
    shiftMaps(index, items.length)
  }

  try {
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const event = eventOf(entries[entryIndex])
      if (event === null) continue
      const type = event.type
      if (typeof type !== 'string') continue
      const seq = seqOf(event, entryIndex)
      const data = asRecord(event.data)
      if (data === null) continue

      switch (type) {
        case 'user/message': {
          if (isInjectedUserMessage(data)) break
          const text = textBlocks(data.content, '\n\n')
          if (text === '') break
          pushRow('user', text, seq)
          break
        }

        case 'assistant/live-chunk': {
          const chunk = asRecord(data.chunk)
          if (chunk === null) break
          const chunkType = chunk.type
          const kind: AiRowKind | null =
            chunkType === 'text-delta' ? 'assistant' : chunkType === 'reasoning-delta' ? 'reasoning' : null
          const text = chunk.text
          if (kind === null || typeof text !== 'string' || text === '') break
          const key = `${partOf(data.turn)}:${partOf(data.step)}:${partOf(chunk.index)}:${kind}`
          const existing = streamRows.get(key)
          if (existing !== undefined) {
            const row = rows[existing]
            if (row !== undefined && row.streaming === true) rows[existing] = { ...row, text: row.text + text }
          } else {
            streamRows.set(key, pushRow(kind, text, seq, { streaming: true }))
          }
          break
        }

        case 'assistant/message': {
          const turnKey = partOf(data.turn)
          const stepKey = partOf(data.step)
          const prefix = `${turnKey}:${stepKey}:`
          const streamed: number[] = []
          for (const [key, index] of streamRows) {
            if (key.startsWith(prefix)) streamed.push(index)
          }
          for (const key of [...streamRows.keys()]) {
            if (key.startsWith(prefix)) streamRows.delete(key)
          }
          streamed.sort((left, right) => left - right)
          const insertAt = streamed.length > 0 ? (streamed[0] as number) : rows.length
          for (let cursor = streamed.length - 1; cursor >= 0; cursor -= 1) {
            removeRowAt(streamed[cursor] as number)
          }
          const message = asRecord(data.message)
          const content = message !== null && Array.isArray(message.content) ? message.content : []
          const settled: AiRow[] = []
          for (const block of content) {
            const candidate = asRecord(block)
            if (candidate === null) continue
            const text = candidate.text
            if (typeof text !== 'string' || text === '') continue
            if (candidate.type === 'reasoning') settled.push(makeRow('reasoning', text, seq))
            else if (candidate.type === 'text') settled.push(makeRow('assistant', text, seq))
          }
          insertRowsAt(insertAt, settled)
          break
        }

        case 'tool/call': {
          const name = typeof data.name === 'string' && data.name !== '' ? data.name : 'tool'
          const callId = typeof data.callId === 'string' && data.callId !== '' ? data.callId : undefined
          const detail = toolDetail(data.arguments)
          const index = pushRow('tool', detail !== undefined ? detail : '', seq, {
            tool: toolLabel(name),
            running: true,
          })
          if (callId !== undefined) callRows.set(callId, index)
          break
        }

        case 'tool/result': {
          const message = asRecord(data.message)
          const source = message !== null ? asRecord(message.source) : null
          const callId =
            source !== null && typeof source.callId === 'string'
              ? source.callId
              : typeof data.callId === 'string'
                ? data.callId
                : undefined
          const failed = data.error !== undefined || message?.isError === true
          if (callId !== undefined) {
            const index = callRows.get(callId)
            if (index !== undefined) {
              const row = rows[index]
              if (row !== undefined && row.kind === 'tool') rows[index] = { ...row, running: false }
              callRows.delete(callId)
            } else if (failed) {
              // Result without a visible call row: keep the failure discoverable.
              pushRow('tool', '', seq, { tool: 'tool', running: false })
            }
          }
          if (failed) {
            const detail = data.error !== undefined ? describeError(data.error) : toolResultText(message)
            const text = detail.trim() !== '' ? detail : 'The tool call failed.'
            pushRow('error', truncate(text, 600), seq)
          }
          break
        }

        case 'assistant/attempt': {
          const turn = data.turn
          const turnNumber = typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
          if (turnNumber !== undefined && errorTurns.has(turnNumber)) break
          const failure = attemptFailure(data.stream)
          if (failure === undefined) break
          if (turnNumber !== undefined) errorTurns.add(turnNumber)
          pushRow('error', truncate(failure, 600), seq)
          break
        }

        case 'turn/end': {
          const turn = data.turn
          const turnNumber = typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
          for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index]
            if (row === undefined) continue
            if (row.streaming === true) rows[index] = { ...row, streaming: false }
            if (row.running === true) rows[index] = { ...row, running: false }
          }
          const failure = failureText(data.reason)
          if (failure === undefined) break
          if (turnNumber !== undefined && errorTurns.has(turnNumber)) break
          if (turnNumber !== undefined) errorTurns.add(turnNumber)
          pushRow('error', truncate(failure, 600), seq)
          break
        }

        default:
          // Unknown event families are ignored on purpose.
          break
      }
    }
  } catch {
    // A malformed window must never break the panel; render what was reduced.
  }

  return rows
}

/* ── service resolution ───────────────────────────────────────────────── */

function getService(ctx: ClientContext, key: string): Record<string, unknown> | null {
  try {
    return asRecord(ctx.get(key))
  } catch {
    return null
  }
}

function getSessionsService(ctx: ClientContext): SessionsServiceLike | undefined {
  const record = getService(ctx, 'sessions')
  return record === null ? undefined : (record as unknown as SessionsServiceLike)
}

function getUiWorkspace(ctx: ClientContext): UiWorkspaceLike | undefined {
  const record = getService(ctx, 'uiWorkspace')
  return record === null ? undefined : (record as unknown as UiWorkspaceLike)
}

function asReference(value: unknown): SessionReferenceLike | null {
  const record = asRecord(value)
  if (record === null) return null
  return record as unknown as SessionReferenceLike
}

function asBinding(value: unknown): SessionBindingLike | null {
  const record = asRecord(value)
  if (record === null) return null
  if (asRecord(record.session) === null) return null
  return record as unknown as SessionBindingLike
}

function releaseReference(reference: SessionReferenceLike | null): void {
  if (reference === null) return
  try {
    if (typeof reference.release === 'function') reference.release()
    else if (typeof reference.dispose === 'function') reference.dispose()
  } catch {
    // Release is best-effort; the runtime owns final teardown.
  }
}

function readEntries(current: Attachment): readonly unknown[] {
  if (current.eventSource === null) return []
  try {
    const window = asRecord(current.eventSource.getSnapshot())
    const entries = window?.entries
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

function readRunning(session: SessionFaceLike): boolean {
  try {
    const snapshot = asRecord(session.getSnapshot?.())
    return snapshot?.running === true
  } catch {
    return false
  }
}

function readSessionTitle(ctx: ClientContext, sessionId: string): string | null {
  const sessions = getSessionsService(ctx)
  const list = sessions?.list
  if (list === undefined || typeof list.getSnapshot !== 'function') return null
  try {
    const snapshot = asRecord(list.getSnapshot())
    const byId = asRecord(snapshot?.byId)
    const summary = asRecord(byId?.[sessionId])
    const title = summary?.title
    if (typeof title === 'string' && title !== '') return title
    const display = summary?.displayTitle
    return typeof display === 'string' && display !== '' ? display : null
  } catch {
    return null
  }
}

function hasVisibleUserMessage(entries: readonly unknown[]): boolean {
  for (const entry of entries) {
    const event = eventOf(entry)
    if (event === null || event.type !== 'user/message') continue
    const data = asRecord(event.data)
    if (data === null || isInjectedUserMessage(data)) continue
    if (textBlocks(data.content, '\n\n') !== '') return true
  }
  return false
}

function lastSeqOf(entries: readonly unknown[]): number {
  let last = -1
  for (const entry of entries) {
    const event = eventOf(entry)
    if (event === null) continue
    const seq = event.seq
    if (typeof seq === 'number' && Number.isFinite(seq) && seq > last) last = seq
  }
  return last
}

function completedTurnAfter(entries: readonly unknown[], startSeq: number): boolean {
  for (const entry of entries) {
    const event = eventOf(entry)
    if (event === null || event.type !== 'turn/end') continue
    const seq = event.seq
    if (typeof seq === 'number' && Number.isFinite(seq) && seq > startSeq) return true
  }
  return false
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readCachedSessionId(threadKey: string): string | null {
  const store = storage()
  if (store === null) return null
  try {
    const current = store.getItem(CACHE_PREFIX + threadKey)
    if (typeof current === 'string' && current !== '') return current
    // Migration: single-paper installs cached the session under the old key.
    const legacy = store.getItem(LEGACY_CACHE_PREFIX + threadKey)
    if (typeof legacy !== 'string' || legacy === '') return null
    try {
      store.setItem(CACHE_PREFIX + threadKey, legacy)
      store.removeItem(LEGACY_CACHE_PREFIX + threadKey)
    } catch {
      // A failed migration write still leaves the legacy entry readable.
    }
    return legacy
  } catch {
    return null
  }
}

function writeCachedSessionId(threadKey: string, sessionId: string): void {
  const store = storage()
  if (store === null) return
  try {
    store.setItem(CACHE_PREFIX + threadKey, sessionId)
    try {
      store.removeItem(LEGACY_CACHE_PREFIX + threadKey)
    } catch {
      // Only the legacy entry cleanup failed; the new key is authoritative.
    }
  } catch {
    // Quota/private-mode failures must not break the panel.
  }
}

function sessionTitleFor(paperTitle: string, paperId: string): string {
  const base = paperTitle.trim() !== '' ? paperTitle.trim() : paperId
  return `AI · ${base}`
}

/** Real paper ids match the Host's validation regex; compare keys do not. */
const PAPER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** `paperId` compatibility mirror: only a genuine paper thread yields a value. */
function paperIdForThread(threadKey: string | null): string | null {
  return threadKey !== null && PAPER_KEY_RE.test(threadKey) ? threadKey : null
}

/** Resolve the session title for a direct `openThread` call. */
function threadTitleFor(threadKey: string, options: AiThreadOptions): string {
  const explicit = typeof options?.title === 'string' ? options.title.trim() : ''
  if (explicit !== '') return explicit
  const legacy = typeof options?.paperTitle === 'string' ? options.paperTitle.trim() : ''
  if (legacy !== '') return sessionTitleFor(legacy, threadKey)
  return threadKey
}

function remoteMessage(value: unknown): string {
  if (typeof value === 'string' && value !== '') return value
  const record = asRecord(value)
  if (record === null) return ''
  for (const key of ['message', 'detail'] as const) {
    const message = record[key]
    if (typeof message === 'string' && message !== '') return message
  }
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined || serialized === '{}' ? '' : serialized
  } catch {
    return ''
  }
}

function createIdleState(): AiThreadState {
  return { status: 'idle', threadKey: null, paperId: null, sessionId: null, rows: [], error: null }
}

function rowsEqual(left: readonly AiRow[], right: readonly AiRow[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) return false
    if (
      a.id !== b.id ||
      a.kind !== b.kind ||
      a.text !== b.text ||
      a.tool !== b.tool ||
      a.running !== b.running ||
      a.streaming !== b.streaming
    ) {
      return false
    }
  }
  return true
}

/* ── controller ───────────────────────────────────────────────────────── */

/**
 * Create the in-panel AI thread controller. One instance owns at most one
 * retained shell session; `openThread` reattaches per thread and `dispose`
 * releases it. All services are optional: when absent the controller reports
 * a readable `status:'error'` instead of throwing.
 */
export function createAiThread(ctx: ClientContext): AiThreadController {
  let state: AiThreadState = createIdleState()
  const listeners = new Set<() => void>()

  let attachment: Attachment | null = null
  let currentThreadKey: string | null = null
  let currentWorkspacePath = ''
  let fatalError: string | null = null
  let localErrorRows: AiRow[] = []
  let localErrorSeq = 0
  let pendingOpen: Promise<void> | null = null
  let openToken = 0
  let pendingSubmit = false
  let hasRunStarted = false
  let submitStartSeq = -1
  let flushScheduled = false

  const enqueue = typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (callback: () => void): void => {
        void Promise.resolve().then(callback)
      }

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A listener failure must not stop the others.
      }
    }
  }

  const commit = (next: AiThreadState): void => {
    const merged: AiThreadState = rowsEqual(next.rows, state.rows) ? { ...next, rows: state.rows } : next
    if (
      merged.status === state.status &&
      merged.threadKey === state.threadKey &&
      merged.paperId === state.paperId &&
      merged.sessionId === state.sessionId &&
      merged.error === state.error &&
      merged.rows === state.rows
    ) {
      return
    }
    state = merged
    notify()
  }

  const detach = (): void => {
    const current = attachment
    attachment = null
    if (current === null) return
    for (const unsubscribe of current.unsubs) {
      try {
        unsubscribe()
      } catch {
        // Unsubscribe is best-effort during teardown.
      }
    }
    releaseReference(current.reference)
  }

  const refreshNow = (): void => {
    const current = attachment
    if (current === null) return
    const entries = readEntries(current)
    const running = readRunning(current.session)
    if (running) {
      hasRunStarted = true
      pendingSubmit = false
    } else if (hasRunStarted) {
      hasRunStarted = false
      pendingSubmit = false
    } else if (pendingSubmit && completedTurnAfter(entries, submitStartSeq)) {
      pendingSubmit = false
    }

    let status: AiThreadState['status']
    if (fatalError !== null) status = 'error'
    else if (running || pendingSubmit) status = 'running'
    else status = 'ready'

    const reduced = reduceTranscript(entries, current.threadKey)
    const rows = localErrorRows.length === 0 ? reduced : [...reduced, ...localErrorRows]
    commit({
      status,
      threadKey: current.threadKey,
      paperId: paperIdForThread(current.threadKey),
      sessionId: current.sessionId,
      rows,
      error: fatalError,
    })
  }

  const scheduleFlush = (): void => {
    if (flushScheduled) return
    flushScheduled = true
    enqueue(() => {
      flushScheduled = false
      refreshNow()
    })
  }

  const addLocalError = (message: string): void => {
    localErrorSeq += 1
    localErrorRows = [
      ...localErrorRows,
      { id: `local:error:${localErrorSeq}`, kind: 'error', text: truncate(message, 600) },
    ]
    refreshNow()
  }

  const failAttach = (token: number, message: string): void => {
    if (token !== openToken) return
    detach()
    fatalError = message
    pendingSubmit = false
    hasRunStarted = false
    localErrorRows = []
    commit({
      status: 'error',
      threadKey: currentThreadKey,
      paperId: paperIdForThread(currentThreadKey),
      sessionId: null,
      rows: [],
      error: message,
    })
  }

  const retainSession = async (
    sessions: SessionsServiceLike,
    sessionId: string,
  ): Promise<SessionReferenceLike | null> => {
    const retain = sessions.retain
    if (typeof retain !== 'function') return null
    return asReference(await Promise.resolve(retain.call(sessions, sessionId, { source: 'controllerOperation' })))
  }

  const readyBinding = async (reference: SessionReferenceLike | null): Promise<SessionBindingLike | null> => {
    if (reference === null) return null
    if (reference.ready !== undefined) {
      try {
        await reference.ready
      } catch {
        return null
      }
    }
    return asBinding(reference.binding)
  }

  const syncTitle = async (current: Attachment, title: string): Promise<void> => {
    const rename = current.session.rename
    if (typeof rename !== 'function') return
    const desired = title.trim()
    if (desired === '') return
    try {
      const entries = readEntries(current)
      const hasUser = hasVisibleUserMessage(entries)
      const existing = readSessionTitle(ctx, current.sessionId)
      // Only rename a still-blank session (or one without any durable title).
      if (hasUser && existing !== null && existing !== '') return
      if (existing === desired) return
      await rename.call(current.session, desired)
    } catch {
      // Renaming is a convenience; the panel works with the host default title.
    }
  }

  const attachThread = async (
    token: number,
    threadKey: string,
    workspacePath: string,
    title: string,
  ): Promise<void> => {
    if (workspacePath.trim() === '') {
      failAttach(token, 'The library path is unavailable, so the AI session cannot be opened.')
      return
    }
    const sessions = getSessionsService(ctx)
    if (sessions === undefined) {
      failAttach(token, 'The session service is unavailable in this client.')
      return
    }

    let reference: SessionReferenceLike | null = null
    let binding: SessionBindingLike | null = null

    const cached = readCachedSessionId(threadKey)
    if (cached !== null) {
      if (typeof sessions.retain === 'function') {
        try {
          reference = await retainSession(sessions, cached)
          if (token !== openToken) {
            releaseReference(reference)
            return
          }
          binding = await readyBinding(reference)
          if (binding === null) {
            releaseReference(reference)
            reference = null
          }
        } catch {
          releaseReference(reference)
          reference = null
          binding = null
        }
      } else {
        binding = asBinding(sessions.binding?.(cached))
      }
    }

    if (binding === null) {
      releaseReference(reference)
      reference = null
      const uiWorkspace = getUiWorkspace(ctx)
      if (uiWorkspace === undefined || typeof uiWorkspace.connectWorkspace !== 'function') {
        failAttach(token, 'The session composer is unavailable in this client.')
        return
      }

      let workspaceId: string
      try {
        workspaceId = await ensurePaperWorkspace(ctx, workspacePath)
      } catch (error) {
        failAttach(token, `The AI workspace could not be resolved: ${errorMessage(error) || 'unknown error'}`)
        return
      }
      if (token !== openToken) return

      let connected: unknown
      try {
        connected = await uiWorkspace.connectWorkspace.call(uiWorkspace, workspaceId)
      } catch (error) {
        failAttach(token, `The AI session could not be opened: ${errorMessage(error) || 'unknown error'}`)
        return
      }
      if (token !== openToken) return
      if (typeof connected !== 'string' || connected === '') {
        failAttach(token, 'The session composer returned no session id.')
        return
      }

      if (typeof sessions.retain === 'function') {
        try {
          reference = await retainSession(sessions, connected)
          if (token !== openToken) {
            releaseReference(reference)
            return
          }
          binding = await readyBinding(reference)
        } catch {
          releaseReference(reference)
          reference = null
          binding = null
        }
        if (binding === null) {
          releaseReference(reference)
          failAttach(token, 'The AI session could not be opened. Try again in a moment.')
          return
        }
      } else {
        binding = asBinding(sessions.binding?.(connected))
        if (binding === null) {
          failAttach(token, 'The session service cannot retain sessions in this client.')
          return
        }
      }
      writeCachedSessionId(threadKey, connected)
    }

    if (token !== openToken) {
      releaseReference(reference)
      return
    }

    const session = binding.session
    if (session === undefined || typeof session.getSnapshot !== 'function') {
      releaseReference(reference)
      failAttach(token, 'The session is not ready yet. Try again in a moment.')
      return
    }

    const eventSource =
      binding.eventSource !== undefined && typeof binding.eventSource.subscribe === 'function'
        ? binding.eventSource
        : null
    const sessionId =
      typeof binding.sessionId === 'string' && binding.sessionId !== ''
        ? binding.sessionId
        : typeof session.sessionId === 'string' && session.sessionId !== ''
          ? session.sessionId
          : (cached ?? '')

    const unsubs: Array<() => void> = []
    if (eventSource !== null) {
      try {
        unsubs.push(eventSource.subscribe(() => scheduleFlush()))
      } catch {
        // Without a live source the panel still shows the initial window.
      }
    }
    if (typeof session.subscribe === 'function') {
      try {
        unsubs.push(session.subscribe(() => scheduleFlush()))
      } catch {
        // A missing runtime subscription is survivable (status stays ready).
      }
    }

    attachment = {
      reference,
      session,
      eventSource,
      threadKey,
      sessionId,
      unsubs,
    }
    fatalError = null
    pendingSubmit = false
    hasRunStarted = false
    writeCachedSessionId(threadKey, sessionId)
    refreshNow()
    void syncTitle(attachment, title)
  }

  const openThread = async (threadKey: string, options: AiThreadOptions): Promise<void> => {
    if (typeof threadKey !== 'string' || threadKey === '') {
      const invalidToken = openToken + 1
      openToken = invalidToken
      detach()
      currentThreadKey = null
      currentWorkspacePath = ''
      failAttach(invalidToken, 'No AI thread was provided.')
      return
    }
    const workspacePath = typeof options?.workspacePath === 'string' ? options.workspacePath : ''
    const title = threadTitleFor(threadKey, options)

    // A same-key call while the attach is still in flight must not restart it.
    if (attachment === null && currentThreadKey === threadKey && pendingOpen !== null) {
      const inFlight = pendingOpen
      currentWorkspacePath = workspacePath
      try {
        await inFlight
      } catch {
        // attachThread reports failures through state; nothing to rethrow here.
      }
      if (attachment !== null && currentThreadKey === threadKey) void syncTitle(attachment, title)
      return
    }

    // Same thread: no reattach; refresh the workspace/title only.
    if (attachment !== null && currentThreadKey === threadKey) {
      currentWorkspacePath = workspacePath
      void syncTitle(attachment, title)
      return
    }

    const token = openToken + 1
    openToken = token
    detach()
    fatalError = null
    localErrorRows = []
    localErrorSeq = 0
    pendingSubmit = false
    hasRunStarted = false
    submitStartSeq = -1
    currentThreadKey = threadKey
    currentWorkspacePath = workspacePath

    commit({
      status: 'attaching',
      threadKey,
      paperId: paperIdForThread(threadKey),
      sessionId: null,
      rows: [],
      error: null,
    })

    const work = attachThread(token, threadKey, workspacePath, title)
    pendingOpen = work
    try {
      await work
    } finally {
      if (pendingOpen === work) pendingOpen = null
    }
  }

  /** Thin per-paper wrapper: keeps the historical `AI · <paperTitle>` session name. */
  const openPaper = async (paperId: string, options: AiThreadOptions): Promise<void> => {
    const rawTitle = typeof options?.paperTitle === 'string' ? options.paperTitle : ''
    const title = sessionTitleFor(rawTitle.trim() !== '' ? rawTitle : paperId, paperId)
    await openThread(paperId, { ...options, title })
  }

  const run = async (prompt: string): Promise<{ ok: boolean; error?: string }> => {
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (text === '') return { ok: false, error: 'The prompt is empty.' }

    if (attachment === null && pendingOpen !== null) {
      try {
        await pendingOpen
      } catch {
        // attachThread resolves failures into state; ignore here.
      }
    }
    const current = attachment
    if (current === null) {
      return {
        ok: false,
        error: fatalError !== null ? fatalError : 'No AI session is attached to this thread yet.',
      }
    }

    const send = current.session.prompt
    if (typeof send !== 'function') {
      return { ok: false, error: 'The session face cannot accept prompts in this client.' }
    }

    localErrorRows = []
    localErrorSeq = 0
    pendingSubmit = true
    hasRunStarted = false
    submitStartSeq = lastSeqOf(readEntries(current))
    refreshNow()

    let submission: SubmissionLike | undefined
    const begin = current.session.beginSubmission
    if (typeof begin === 'function') {
      try {
        const raw = begin.call(current.session, { mode: 'queue', text, attachments: [] })
        const record = asRecord(raw)
        if (record !== null) {
          const abandon = record.abandon
          submission = {
            requestId: record.requestId,
            ...(typeof abandon === 'function'
              ? {
                  abandon: (): void => {
                    try {
                      ;(abandon as () => void).call(record)
                    } catch {
                      // Retirement is best-effort.
                    }
                  },
                }
              : {}),
          }
        }
      } catch {
        // The prompt path below still reports a real send failure.
      }
    }

    try {
      const result: unknown = await send.call(
        current.session,
        [{ type: 'text', text }],
        'queue',
        undefined,
        submission?.requestId,
      )
      const record = asRecord(result)
      if (record !== null && record.ok === false) {
        throw new Error(remoteMessage(record.error) || 'The session rejected the prompt.')
      }
      return { ok: true }
    } catch (error) {
      try {
        submission?.abandon?.()
      } catch {
        // Retirement is best-effort.
      }
      pendingSubmit = false
      hasRunStarted = false
      const message = errorMessage(error) || 'The prompt could not be sent.'
      addLocalError(message)
      return { ok: false, error: message }
    }
  }

  const stop = async (): Promise<void> => {
    const current = attachment
    const cancel = current?.session.cancel
    if (current === null || typeof cancel !== 'function') return
    try {
      await cancel.call(current.session)
    } catch {
      // Stopping is best-effort; the turn/end event still settles the rows.
    }
  }

  const lastAnswer = (): string | null => {
    const rows = state.rows
    let end = -1
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row !== undefined && row.kind === 'assistant') {
        end = index
        break
      }
    }
    if (end < 0) return null
    let start = end
    while (start > 0) {
      const previous = rows[start - 1]
      if (previous === undefined || previous.kind !== 'assistant') break
      start -= 1
    }
    const text = rows
      .slice(start, end + 1)
      .map((row) => row.text)
      .filter((part) => part.trim() !== '')
      .join('\n\n')
      .trim()
    return text === '' ? null : text
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const dispose = (): void => {
    openToken += 1
    detach()
    pendingOpen = null
    fatalError = null
    localErrorRows = []
    localErrorSeq = 0
    pendingSubmit = false
    hasRunStarted = false
    submitStartSeq = -1
    currentThreadKey = null
    currentWorkspacePath = ''
    listeners.clear()
    state = createIdleState()
  }

  return {
    openThread,
    openPaper,
    run,
    stop,
    lastAnswer,
    getSnapshot: () => state,
    subscribe,
    dispose,
  }
}
