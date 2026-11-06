# PaperDesk in-panel AI assistant (design + contract)

Goal: the reader's 总结 / 方法精读 / 审阅 / 相关工作 / 提问 buttons must run the agent
**inside the PaperDesk panel**. No navigation to another session, no copy-paste.
The panel streams the answer next to the PDF, keeps the conversation per paper, and
lets the user jump to cited pages, ask follow-ups, stop, and save the result to notes.

## 1. UX

The reader's right drawer becomes tabbed:

```
┌ 阅读器 ─────────────────────────────────┬ 抽屉 (300–360px) ──────────────┐
│ … PDF …                                 │ [批注 2] [AI 解读]             │
│                                         │ ┌ AI 解读 ───────────────────┐ │
│                                         │ │ 总结 方法精读 审阅 相关工作 提问 │ │
│                                         │ │                            │ │
│                                         │ │ 你：请总结…                 │ │
│                                         │ │ Agent：## 一句话结论 …      │ │
│                                         │ │   · 正在读取 paper_text      │ │
│                                         │ │   [p.3] [p.12] 引用页        │ │
│                                         │ │ [停止]                     │ │
│                                         │ │ ┌ 继续提问… ──── [发送] ┐   │ │
│                                         │ └────────────────────────────┘ │
└─────────────────────────────────────────┴────────────────────────────────┘
```

* Header row 1 gains an **「AI 解读」** toggle next to 批注 N. Opening either tab
  opens the same drawer.
* Clicking a task button: switches the drawer to the AI tab, shows the task as a
  pending user bubble, streams the answer. The existing assist buttons stay in
  header row 3.
* Conversation is **per paper and persistent**: one agent session per paper,
  reattached after reload (session id cached locally); the panel renders its
  transcript from the session's event window. The session is titled
  `AI · <paper title>` so the sidebar entry is understandable if the user finds it.
* Follow-up input sends into the same session (context retained). 停止 cancels the
  running turn (`session.cancel()`).
* Assistant markdown is rendered; page references (`p.12`, `第 12 页`, `pp.3-4`)
  become clickable chips under the message that jump the viewer to that page.
* Footer actions: 保存到笔记 (appends the answer to the paper's notes via the
  existing note-append API), 复制, and 在完整会话中继续 (escape hatch: opens the
  same session with the shell conversation UI).
* Failure: an error row inside the panel + a 重试 button; never navigate away.

## 2. Implementation contract

### 2.1 `client/aiSession.ts` (owner: ai-bridge)

Pure data/controller module; no JSX. Exits only with structural casts because the
installed client-runtime types lag the shell (same approach as `client/agent.ts`).

```ts
export type AiRowKind = 'user' | 'assistant' | 'reasoning' | 'tool' | 'error' | 'status'

export interface AiRow {
  /** Stable key (event seq + kind + index). */
  id: string
  kind: AiRowKind
  /** Markdown for assistant, plain text otherwise. */
  text: string
  /** Tool name for `tool` rows (already friendly-mapped). */
  tool?: string
  /** Tool row is still executing. */
  running?: boolean
  /** Assistant text is still streaming. */
  streaming?: boolean
}

export interface AiThreadState {
  status: 'idle' | 'attaching' | 'ready' | 'running' | 'error'
  paperId: string | null
  sessionId: string | null
  rows: AiRow[]
  error: string | null
}

export interface AiThreadOptions {
  /** Workspace path (the library root). */
  workspacePath: string
  /** Used for the session title and initial rename. */
  paperTitle: string
}

export interface AiThreadController {
  /** Switch to a paper; reattaches the cached session or prepares a new one. */
  openPaper(paperId: string, options: AiThreadOptions): Promise<void>
  /** Send one prompt into this paper's session (creates nothing if attached). */
  run(prompt: string): Promise<{ ok: boolean; error?: string }>
  stop(): Promise<void>
  /** Full conversation text of the last assistant answer (for 保存到笔记). */
  lastAnswer(): string | null
  getSnapshot(): AiThreadState
  subscribe(listener: () => void): () => void
  /** Release the retained session + subscriptions (paper switch/unmount). */
  dispose(): void
}

export function createAiThread(ctx: ClientContext): AiThreadController

/** Pure reducer, exported for tests: entries -> rows. */
export function reduceTranscript(entries: readonly unknown[], paperId: string): AiRow[]
```

Behaviour:

* **Session resolution**: `sessions = ctx.get('sessions')`, `uiWorkspace = ctx.get('uiWorkspace')`.
  Cached id from `localStorage['paperdesk:ai-session:' + paperId]`; verify with
  `sessions.binding(id)`; if absent, resolve the paper workspace (reuse the helper
  `ensurePaperWorkspace` exported from `client/agent.ts`) and
  `uiWorkspace.connectWorkspace(workspaceId)`; persist the id. Rename the session to
  `AI · <paperTitle>` (only when it has no user messages yet or title is empty).
* **Attach**: `sessions.retain(sessionId, { source: 'controllerOperation' })`;
  `await ref.ready`; read `ref.binding`:
  - `binding.eventSource.getSnapshot().entries` → `reduceTranscript`
  - subscribe to `eventSource` and to `binding.session` (running flag) → publish via
    the controller's listener set; coalesce publishes with `queueMicrotask`.
  - release the reference in `dispose()`.
* **Send**: `binding.session.beginSubmission({ mode:'queue', text: prompt, attachments: [] })`
  then `binding.session.prompt([{ type:'text', text: prompt }], 'queue', undefined, submission?.requestId)`;
  treat `{ ok:false }` as failure with the remote message.
* **Stop**: `binding.session.cancel()`.
* Guard every optional service; on missing session services return
  `{ ok:false, error:'…' }` and set `status:'error'` (the UI shows the message).

### 2.2 Transcript reducer (event vocabulary)

Entries are `{ type: 'event' | 'transient', event }` where `event` has
`{ seq, time, type, data }`. Ignore unknown types/shapes. Map:

| event type | row |
|---|---|
| `user/message` | `user` row, text = text blocks of `data.content`; skip context-injection messages (`data.source?.kind` not `'user'`-visible or text starting with a hidden marker) |
| `assistant/live-chunk` | accumulate `assistant` rows per `${turn}:${step}:${chunk.index}` when `chunk.type==='text-delta'` and text non-empty; `reasoning-delta` → `reasoning` rows (collapsed in UI) |
| `assistant/message` | replace that turn/step's streamed rows with settled `text` blocks of `data.message.content` (and `reasoning` blocks) |
| `tool/call` | `tool` row, `tool = friendlyToolName(data.name)`, `running=true` |
| `tool/result` | pair by `data.message?.source?.callId` → set `running=false`; failure (`data.error !== undefined`) → error row text `data.error` |
| `turn/end` | mark all `streaming/running` rows settled; `data.reason` failure → `error` row |
| `assistant/attempt` | failure stream → `error` row (optional) |
| anything else | ignore |

Friendly tool names (zh): `paper_info`→查看论文元数据, `paper_text`→读取正文,
`paper_search`→搜索论文库, `paper_list`→浏览论文库, `paper_annotations`→读取批注,
`paper_note_append`→写入笔记, `paper_add`→导入论文, `paper_update`→更新元数据,
`paper_sync`→检查同步, `web_search`→联网检索, `web_fetch`→抓取网页,
`read`/`grep`/`glob`→读取本地文件, default → the raw name.

### 2.3 `client/AiPanel.tsx` (owner: client-ui)

```ts
export interface AiPanelProps {
  ai: AiThreadController
  busyTask: AssistTask | null
  labels: { … }                    // all strings from i18n (passed by ReaderView)
  onRunTask: (task: AssistTask, extra?: string) => void | Promise<void>
  onAsk: (question: string) => void | Promise<void>
  onStop: () => void | Promise<void>
  onSaveToNotes: (text: string) => void | Promise<void>
  onCopy: (text: string) => void | Promise<void>
  onOpenInSession: () => void | Promise<void>
  onJumpPage: (page: number) => void
}
export function AiPanel(props: AiPanelProps): ReactElement
```

* Task chips at the top (reuse the existing assist labels); click → `onRunTask`
  (the coordinator in App also records the pending task).
* Message list from `useSyncExternalStore` over `ai.getSnapshot()`; auto-scroll to
  bottom while streaming (respect user scroll-up: stop auto-follow when the user
  scrolls up, show "跳到最新" pill).
* Assistant rows render markdown (`client/markdown.tsx`); strip raw HTML there
  already. Streaming rows get a caret.
* Tool rows are one muted line with a spinner while running; reasoning rows are a
  collapsed `<details>`.
* Error rows show the message + 重试 button (re-runs the last prompt).
* Footer: input (Enter sends, Shift+Enter newline), 停止 while running, 保存到笔记,
  复制, 在完整会话中继续; disabled states while `status ∈ {attaching, running}`.
* Page citations: after the last assistant row, collect distinct page numbers from
  the whole assistant text with `/\bp{1,2}\.\s?(\d{1,3})/g` and `/第\s?(\d{1,3})\s?页/g`,
  render up to 8 chips 「p.N」 that call `onJumpPage`.
* Empty state when no rows: short hint 「选择上面的任务，让 Agent 在这里精读这篇论文」.

### 2.4 Integration (owner: client-ui)

`client/ReaderView.tsx`:
* drawer state becomes `{ open: boolean; tab: 'annotations' | 'ai' }`; header row 1
  shows 「批注 N」 + a new 「AI 解读」 toggle; drawer header has two tabs; both open
  the drawer.
* task buttons / question popover: `setDrawer({open:true, tab:'ai'})` then the
  existing `onAssist(...)` / `onAskAboutSelection(...)` flow (no navigation).
* `focusPage` / `onJumpPage` reuse the viewer's focus mechanism (already
  `focusTarget`).

`client/App.tsx`:
* `const ai = useMemo(() => createAiThread(ctx), [ctx])`; `useEffect` on
  `[selectedId, status?.settings.libraryPath]` → `ai.openPaper(...)` when both are
  available; `useEffect(() => () => ai.dispose(), [ai])`.
* `launchAssist`: `api.assist(...)` then `ai.run(payload.prompt)` (keep busy state
  keyed on the task); toast only on failure with the server/agent message; no
  `startPaperSession` call.
* `handleAskAboutSelection`: persist the question annotation (already implemented),
  then `launchAssist('quote', undefined, context)` with
  `{quote, page, question, rects}`.
* New `handleOpenAiInSession`: `ai.lastAnswer()` is irrelevant; use
  `startPaperSession` with an assembled payload only when the user explicitly
  clicks 在完整会话中继续 — fetch `api.assist(paperId,'custom')`? Simpler: navigate to
  the existing session: `uiWorkspace.openSession(ai.getSnapshot().sessionId)` then
  `layout.selectPanel(null)`.
* `handleSaveAiToNotes(text)`: `api.appendNote(paperId, { section: 'summary', text,
  by: 'user' })` → toast.

`client/agent.ts`: extract the workspace resolution into
`export async function ensurePaperWorkspace(ctx, path): Promise<string>` and keep
`startPaperSession` (still used by 在完整会话中继续 / escape hatch).

### 2.5 Prompt adjustments (`src/prompt.ts`, Lead)

Assist prompts gain one line (both languages): the answer is rendered inside the
PaperDesk panel, so use Markdown, cite pages as `p.N`, keep tool chatter out of the
final answer, and put the conclusion first.

## 3. Ownership

| owner | files |
|---|---|
| ai-bridge | `client/aiSession.ts` |
| client-ui | `client/AiPanel.tsx`, `client/ReaderView.tsx`, `client/App.tsx`, `client/i18n.ts`, `client/styles.ts`, `client/agent.ts` |
| lead | `DESIGN-AI.md`, `src/prompt.ts`, build/install/verification |

## 4. Verification

1. `tsc` both projects + `pnpm run build`.
2. Headless Chrome (authenticated via the desktop cookie):
   - open paper → click 总结 → drawer opens on AI tab → user bubble appears →
     assistant text streams (`正在读取…` tool row + markdown answer) → no main-panel
     navigation, `Chat` tab of the shell conversation unchanged.
   - follow-up question → answer appends to the same thread.
   - 停止 cancels; 保存到笔记 appends to `notes.md`; page chips jump.
   - reload page → reopen paper → thread reattached and rendered.
3. Clean up any test session / notes appended during verification.
