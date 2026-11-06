/**
 * Host-facing browser helpers that are not part of the PaperDesk HTTP API:
 * opening native pickers, revealing paths and handing an agent-assist prompt
 * to a workspace session. Every optional Harness service is resolved with
 * `ctx.get(...)` and guarded, so the panel keeps working in reduced profiles.
 *
 * One-click assist: prefer the real submission path
 * `connectWorkspace → openSession → sessions.using(beginSubmission + prompt)`,
 * which actually sends the prompt into the session; fall back to the
 * prefill-only `uiWorkspace.startSession({prompt, whenDraftExists:'append'})`.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { AssistPayload } from '../src/types.js'

/** How the prepared prompt reached the session. */
export interface StartPaperSessionResult {
  /** `sent`: submitted into the session; `prefilled`: only placed in the composer. */
  mode: 'sent' | 'prefilled'
}

/** Structural view of the optional `uiWorkspace` service. */
export interface PaperDeskUiWorkspace {
  pickDirectory?(): Promise<string | null>
  startSession?(
    workspaceId: string,
    options?: { prompt?: string; whenDraftExists?: 'append' | 'replace' },
  ): unknown
  connectWorkspace?(workspaceId: string, options?: { agentPreset?: string }): Promise<string>
  openSession?(sessionId: string): unknown
}

/** Structural view of the optional `workspaces` service. */
interface WorkspacesService {
  list?: unknown
  create?(input: { path: string }): Promise<unknown>
  pickDirectory?(): Promise<string | null>
  listDirectory?(path?: string): Promise<unknown>
  openPath?(path: string): Promise<unknown>
}

/** One workspace row; the shell uses `workspaceId`, older faces use `id`. */
interface WorkspaceLike {
  workspaceId: string
  path?: string
}

/** The session surface subset the one-click assist uses. */
interface SessionFaceLike {
  beginSubmission?(input: {
    mode: 'queue' | 'steer'
    text: string
    attachments: readonly unknown[]
  }): { requestId?: unknown; abandon?(): void }
  prompt?(
    content: readonly unknown[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
    requestId?: unknown,
  ): Promise<unknown>
}

interface SessionBindingLike {
  session?: SessionFaceLike
}

interface SessionReferenceLike {
  binding?: SessionBindingLike
}

interface SessionsService {
  using?<T>(
    target: string,
    options: { source: 'controllerOperation' },
    operation: (reference: SessionReferenceLike) => T | Promise<T>,
  ): Promise<T>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** Read the optional `uiWorkspace` service without requiring it. */
export function getUiWorkspace(ctx: ClientContext): PaperDeskUiWorkspace | undefined {
  const value: unknown = ctx.get('uiWorkspace')
  const record = asRecord(value)
  if (record === null) return undefined
  return record as unknown as PaperDeskUiWorkspace
}

function getWorkspacesService(ctx: ClientContext): WorkspacesService | undefined {
  const value: unknown = ctx.get('workspaces')
  const record = asRecord(value)
  if (record === null) return undefined
  return record as unknown as WorkspacesService
}

function getSessionsService(ctx: ClientContext): SessionsService | undefined {
  const value: unknown = ctx.get('sessions')
  const record = asRecord(value)
  if (record === null) return undefined
  return record as unknown as SessionsService
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Snapshot the workspace list from whichever store shape the runtime exposes. */
function snapshotWorkspaces(service: WorkspacesService): WorkspaceLike[] {
  let snapshot: unknown = service.list
  if (typeof service.list === 'function') {
    try {
      snapshot = (service.list as () => unknown)()
    } catch {
      snapshot = undefined
    }
  }
  const record = asRecord(snapshot)
  if (record !== null && typeof record.getSnapshot === 'function') {
    try {
      snapshot = (record.getSnapshot as () => unknown)()
    } catch {
      snapshot = undefined
    }
  }
  const state = asRecord(snapshot)
  const items = state?.items
  if (!Array.isArray(items)) return []
  const workspaces: WorkspaceLike[] = []
  for (const item of items) {
    const entry = asRecord(item)
    if (entry === null) continue
    const rawId = entry.workspaceId ?? entry.id
    if (typeof rawId !== 'string' || rawId === '') continue
    const path = typeof entry.path === 'string' ? entry.path : undefined
    workspaces.push(path === undefined ? { workspaceId: rawId } : { workspaceId: rawId, path })
  }
  return workspaces
}

function workspaceIdOf(value: unknown): string | null {
  const record = asRecord(value)
  if (record === null) return null
  const id = record.workspaceId ?? record.id
  return typeof id === 'string' && id !== '' ? id : null
}

/**
 * Open the host's native directory picker (uiWorkspace first, workspaces as a
 * fallback). Returns `null` when the user cancelled; throws a readable Error
 * when no picker service exists.
 */
export async function pickLibraryDirectory(ctx: ClientContext): Promise<string | null> {
  const uiWorkspace = getUiWorkspace(ctx)
  if (uiWorkspace !== undefined && typeof uiWorkspace.pickDirectory === 'function') {
    const picked = await uiWorkspace.pickDirectory()
    return typeof picked === 'string' && picked.trim() !== '' ? picked : null
  }
  const workspaces = getWorkspacesService(ctx)
  if (workspaces !== undefined && typeof workspaces.pickDirectory === 'function') {
    const picked = await workspaces.pickDirectory()
    return typeof picked === 'string' && picked.trim() !== '' ? picked : null
  }
  throw new Error('The directory picker is unavailable in this client.')
}

/** Absolute home directory of the Host, when the workspace service exposes it. */
export async function hostHome(ctx: ClientContext): Promise<string | null> {
  const workspaces = getWorkspacesService(ctx)
  if (workspaces === undefined || typeof workspaces.listDirectory !== 'function') return null
  try {
    const listing = asRecord(await workspaces.listDirectory())
    if (listing === null) return null
    for (const key of ['path', 'dirPath', 'directory', 'root'] as const) {
      const value = listing[key]
      if (typeof value === 'string' && value !== '') return value
    }
  } catch {
    // Home discovery is best-effort only.
  }
  return null
}

/**
 * Default library location offered on first run: `<home>/Documents/PaperDesk`.
 * Falls back to the `~/Documents/PaperDesk` spelling when the host home is
 * unknown (the Host side resolves it).
 */
export async function defaultLibraryPath(ctx: ClientContext): Promise<string> {
  const home = await hostHome(ctx)
  if (home === null || home === '') return '~/Documents/PaperDesk'
  const separator = home.includes('\\') && !home.includes('/') ? '\\' : '/'
  const trimmed = home.replace(/[\\/]+$/, '')
  return `${trimmed}${separator}Documents${separator}PaperDesk`
}

/** Reveal a host path in the OS file manager; returns false when unavailable. */
export async function openHostPath(ctx: ClientContext, path: string): Promise<boolean> {
  const workspaces = getWorkspacesService(ctx)
  if (workspaces === undefined || typeof workspaces.openPath !== 'function') return false
  try {
    await workspaces.openPath(path)
    return true
  } catch {
    return false
  }
}

/** Leave the panel and show the main conversation column (best-effort). */
function revealConversation(ctx: ClientContext): void {
  try {
    const layout = asRecord(ctx.get('layout'))
    const selectPanel = layout?.selectPanel
    if (typeof selectPanel === 'function') {
      ;(selectPanel as (panel: null) => unknown).call(layout, null)
    }
  } catch {
    // The layout service is optional; staying on the panel is fine.
  }
}

/**
 * Submit the prompt into the session that `connectWorkspace` resolved.
 * Returns true when a submission went through; false when the required faces
 * are absent (caller falls back to prefill); throws when the send itself failed.
 */
async function submitPrompt(
  uiWorkspace: PaperDeskUiWorkspace,
  sessions: SessionsService | undefined,
  workspaceId: string,
  prompt: string,
): Promise<boolean> {
  const connectWorkspace = uiWorkspace.connectWorkspace
  const using = sessions?.using
  if (typeof connectWorkspace !== 'function' || typeof using !== 'function') return false

  const sessionId = await connectWorkspace.call(uiWorkspace, workspaceId)
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new Error('The session composer returned no session id.')
  }

  const sent = await using.call(
    sessions,
    sessionId,
    { source: 'controllerOperation' },
    async (reference): Promise<boolean> => {
      const session = reference?.binding?.session
      if (
        session === undefined ||
        typeof session.beginSubmission !== 'function' ||
        typeof session.prompt !== 'function'
      ) {
        throw new Error('The session face cannot accept prompts in this client.')
      }

      const submission = session.beginSubmission({
        mode: 'queue',
        text: prompt,
        attachments: [],
      })
      try {
        const result = await session.prompt([{ type: 'text', text: prompt }], 'queue', undefined, submission?.requestId)
        const record = asRecord(result)
        if (record !== null && record.ok === false) {
          const error = asRecord(record.error)
          const message = typeof error?.message === 'string' ? error.message : ''
          throw new Error(message !== '' ? message : 'The session rejected the prompt.')
        }
        return true
      } catch (error) {
        try {
          submission?.abandon?.()
        } catch {
          // Retirement is best-effort.
        }
        throw error
      }
    },
  )

  if (sent === true && typeof uiWorkspace.openSession === 'function') {
    try {
      uiWorkspace.openSession(sessionId)
    } catch {
      // Navigation is best-effort; the prompt is already queued.
    }
  }
  return sent === true
}


/**
 * Resolve (or create) the workspace whose path is the library root. Shared by
 * the in-panel AI thread and the full-conversation escape hatch.
 */
export async function ensurePaperWorkspace(ctx: ClientContext, workspacePath: string): Promise<string> {
  const wanted = normalizePath(workspacePath)
  const workspaces = getWorkspacesService(ctx)
  if (workspaces === undefined) throw new Error('The workspace service is unavailable in this client.')
  const existing = snapshotWorkspaces(workspaces).find(
    (workspace) => typeof workspace.path === 'string' && normalizePath(workspace.path) === wanted,
  )
  if (existing !== undefined) return existing.workspaceId
  if (typeof workspaces.create !== 'function') throw new Error('The workspace service cannot create workspaces.')
  const created = await workspaces.create({ path: workspacePath })
  const id = workspaceIdOf(created)
  if (id === null) throw new Error('The workspace service returned no workspace id.')
  return id
}

/**
 * Reveal an existing session in the shell's conversation column — the
 * "在完整会话中继续" escape hatch of the in-panel AI drawer. Returns false
 * (without throwing) when the shell's session composer is unavailable.
 */
export function openSessionInShell(ctx: ClientContext, sessionId: string): boolean {
  const uiWorkspace = getUiWorkspace(ctx)
  if (uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') return false
  try {
    uiWorkspace.openSession(sessionId)
    revealConversation(ctx)
    return true
  } catch {
    return false
  }
}

/**
 * Find or create the workspace whose path is the library root, then hand the
 * assist prompt to a session. DESIGN-VIEWER §4: send it for one-click assist,
 * falling back to composer prefill when the session submission path is not
 * available. Returns how the prompt reached the session so the caller can pick
 * the right toast.
 */
export async function startPaperSession(
  ctx: ClientContext,
  assist: AssistPayload,
): Promise<StartPaperSessionResult> {
  const workspacePath = typeof assist.workspacePath === 'string' ? assist.workspacePath.trim() : ''
  if (workspacePath === '') throw new Error('The assist payload has no workspace path.')
  if (typeof assist.prompt !== 'string' || assist.prompt.trim() === '') {
    throw new Error('The assist payload has no prompt.')
  }

  const workspaceId = await ensurePaperWorkspace(ctx, workspacePath)

  const uiWorkspace = getUiWorkspace(ctx)
  if (uiWorkspace === undefined) {
    throw new Error('The session composer is unavailable in this client.')
  }

  let sendError: unknown
  try {
    const submitted = await submitPrompt(uiWorkspace, getSessionsService(ctx), workspaceId, assist.prompt)
    if (submitted) {
      revealConversation(ctx)
      return { mode: 'sent' }
    }
  } catch (error) {
    sendError = error
  }

  if (typeof uiWorkspace.startSession === 'function') {
    await uiWorkspace.startSession(workspaceId, { prompt: assist.prompt, whenDraftExists: 'append' })
    revealConversation(ctx)
    return { mode: 'prefilled' }
  }

  if (sendError instanceof Error) throw sendError
  throw new Error('The session composer cannot start sessions in this client.')
}
