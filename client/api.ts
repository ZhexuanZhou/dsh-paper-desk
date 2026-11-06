/**
 * Typed client for the PaperDesk HTTP API (`/api/paper-desk/*`).
 * The only module in the browser half that performs fetch calls.
 */
import type {
  AnnotationDocument,
  AnnotationPatch,
  AssistPayload,
  AssistRequest,
  AssistTask,
  CardsDocument,
  ComparisonSummary,
  NewNoteCard,
  NewRelation,
  NoteCard,
  PaperComparison,
  PaperRelation,
  RelationKind,
  RelationsDocument,
  CloudInfo,
  EffectiveSettings,
  ExtractedText,
  NoteAppendInput,
  NewAnnotation,
  NotesDocument,
  NotesWriteResult,
  PaperDetail,
  PaperMeta,
  PaperStatus,
  PaperSummary,
  ScanDelta,
  SearchHit,
  StatusPayload,
  SyncStatus,
} from '../src/types.js'

const BASE = '/api/paper-desk'

/** Every non-2xx response becomes this error with the server payload attached. */
export class ApiError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, message: string, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

/** Settings file shape accepted by `POST /settings`. */
export interface SettingsPatch {
  libraryPath?: string
  language?: 'zh' | 'en'
  enrich?: boolean
  autoImportInbox?: boolean
  maxPdfBytes?: number
}

/** `GET/POST /settings` payload. */
export interface SettingsPayload {
  /** Absolute path of `settings.json`. */
  file: string
  effective: EffectiveSettings
  /** Values actually present in the settings file (overrides only). */
  loaded: SettingsPatch
}

export interface PapersQuery {
  q?: string
  tag?: string
  status?: PaperStatus | 'all'
  sort?: 'added' | 'title' | 'year' | 'updated'
  limit?: number
}

export interface PapersPayload {
  count: number
  papers: PaperSummary[]
}

export interface ImportResult {
  id: string
  meta: PaperMeta
  duplicated: boolean
}

export interface ConflictResolution {
  ok: boolean
  message?: string
  sync: SyncStatus
}

export interface InboxResult {
  imported: string[]
  papers: PaperSummary[]
}

export interface RevealResult {
  ok: boolean
  message?: string
}

async function readError(res: Response): Promise<ApiError> {
  let payload: unknown
  let message = `${res.status} ${res.statusText}`
  try {
    payload = await res.json()
    if (payload !== null && typeof payload === 'object' && 'error' in payload) {
      const value = (payload as { error: unknown }).error
      if (typeof value === 'string' && value.length > 0) message = value
    }
  } catch {
    // Non-JSON error body: keep the status line.
  }
  return new ApiError(res.status, message, payload)
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body !== undefined && typeof init.body === 'string'
        ? { 'content-type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) throw await readError(res)
  return (await res.json()) as T
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text.length > 0 ? `?${text}` : ''
}

export const api = {
  /** Panel status: configuration, counts, cloud provider. */
  status(): Promise<StatusPayload> {
    return requestJson<StatusPayload>('/status')
  },

  settings(): Promise<SettingsPayload> {
    return requestJson<SettingsPayload>('/settings')
  },

  saveSettings(patch: SettingsPatch): Promise<SettingsPayload> {
    return requestJson<SettingsPayload>('/settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    })
  },

  papers(params: PapersQuery = {}): Promise<PapersPayload> {
    return requestJson<PapersPayload>(
      `/papers${query({
        q: params.q,
        tag: params.tag,
        status: params.status === 'all' ? undefined : params.status,
        sort: params.sort,
        limit: params.limit,
      })}`,
    )
  },

  paper(id: string): Promise<PaperDetail> {
    return requestJson<PaperDetail>(`/paper${query({ id })}`)
  },

  patchPaper(id: string, patch: Partial<PaperMeta>): Promise<{ meta: PaperMeta }> {
    return requestJson<{ meta: PaperMeta }>(`/paper${query({ id })}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },

  deletePaper(id: string): Promise<{ trashed: string }> {
    return requestJson<{ trashed: string }>(`/paper${query({ id })}`, { method: 'DELETE' })
  },

  /** Import an uploaded PDF (drag & drop / file input). */
  async importUpload(file: File, enrich?: boolean): Promise<ImportResult> {
    const res = await fetch(`${BASE}/papers${query({ enrich: enrich === false ? '0' : '1' })}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'x-file-name': encodeURIComponent(file.name),
        accept: 'application/json',
      },
      body: await file.arrayBuffer(),
    })
    if (!res.ok) throw await readError(res)
    return (await res.json()) as ImportResult
  },

  /** Import a PDF already on the Host (absolute path). */
  importPath(path: string, enrich?: boolean): Promise<ImportResult> {
    return requestJson<ImportResult>(
      `/papers${query({ path, enrich: enrich === false ? '0' : '1' })}`,
      { method: 'POST' },
    )
  },

  notes(id: string): Promise<NotesDocument> {
    return requestJson<NotesDocument>(`/notes${query({ id })}`)
  },

  saveNotes(id: string, markdown: string, baseHash?: string): Promise<NotesWriteResult> {
    return requestJson<NotesWriteResult>(`/notes${query({ id })}`, {
      method: 'PUT',
      body: JSON.stringify({ markdown, baseHash }),
    })
  },

  appendNote(
    id: string,
    input: { section?: NoteAppendInput['section']; text: string; page?: number; by?: 'agent' | 'user' },
  ): Promise<NotesWriteResult> {
    return requestJson<NotesWriteResult>(`/notes/append${query({ id })}`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  enrich(id: string): Promise<{ meta: PaperMeta; enrich: { ok: boolean; changed: string[]; source: string; message?: string } }> {
    return requestJson(`/enrich${query({ id })}`, { method: 'POST' })
  },

  text(id: string, force?: boolean): Promise<{ text: ExtractedText }> {
    return requestJson<{ text: ExtractedText }>(
      `/text${query({ id, force: force === true ? '1' : undefined })}`,
      { method: 'POST' },
    )
  },

  search(q: string, limit?: number): Promise<{ count: number; hits: SearchHit[] }> {
    return requestJson<{ count: number; hits: SearchHit[] }>(`/search${query({ q, limit })}`)
  },

  sync(): Promise<SyncStatus> {
    return requestJson<SyncStatus>('/sync')
  },

  scan(): Promise<{ delta: ScanDelta; lastScanAt: string | null }> {
    return requestJson<{ delta: ScanDelta; lastScanAt: string | null }>('/sync/scan', { method: 'POST' })
  },

  resolveConflict(relPath: string, action: 'use-conflict' | 'discard-conflict'): Promise<ConflictResolution> {
    return requestJson<ConflictResolution>('/sync/conflicts', {
      method: 'POST',
      body: JSON.stringify({ relPath, action }),
    })
  },

  downloadEvicted(relPath: string): Promise<{ ok: boolean; message?: string }> {
    return requestJson<{ ok: boolean; message?: string }>('/sync/download', {
      method: 'POST',
      body: JSON.stringify({ relPath }),
    })
  },

  importInbox(): Promise<InboxResult> {
    return requestJson<InboxResult>('/inbox', { method: 'POST' })
  },

  bibtex(ids?: string[]): Promise<string> {
    const suffix = ids !== undefined && ids.length > 0 ? query({ ids: ids.join(',') }) : ''
    return fetch(`${BASE}/bibtex${suffix}`).then(async (res) => {
      if (!res.ok) throw await readError(res)
      return res.text()
    })
  },

  assist(
    paperId: string,
    task: AssistTask,
    extra?: string,
    context?: { quote?: string; page?: number; question?: string },
  ): Promise<AssistPayload> {
    const body: AssistRequest = {
      paperId,
      task,
      extra,
      quote: context?.quote,
      page: context?.page,
      question: context?.question,
    }
    return requestJson<AssistPayload>('/assist', { method: 'POST', body: JSON.stringify(body) })
  },

  /* ── PDF annotations ───────────────────────────────────────────────── */

  annotations(id: string): Promise<AnnotationDocument> {
    return requestJson<AnnotationDocument>(`/annotations${query({ id })}`)
  },

  addAnnotation(id: string, input: NewAnnotation): Promise<AnnotationDocument> {
    return requestJson<AnnotationDocument>(`/annotations${query({ id })}`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  updateAnnotation(id: string, annotationId: string, patch: AnnotationPatch): Promise<AnnotationDocument> {
    return requestJson<AnnotationDocument>(`/annotations${query({ id, annotationId })}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },

  deleteAnnotation(id: string, annotationId: string): Promise<AnnotationDocument> {
    return requestJson<AnnotationDocument>(`/annotations${query({ id, annotationId })}`, {
      method: 'DELETE',
    })
  },

  /* ── note cards ────────────────────────────────────────────────────── */

  cards(id: string): Promise<CardsDocument> {
    return requestJson<CardsDocument>(`/cards${query({ id })}`)
  },

  addCard(id: string, input: NewNoteCard): Promise<CardsDocument> {
    return requestJson<CardsDocument>(`/cards${query({ id })}`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  updateCard(
    id: string,
    cardId: string,
    patch: Partial<Pick<NoteCard, 'title' | 'body' | 'tags' | 'pages'>>,
  ): Promise<CardsDocument> {
    return requestJson<CardsDocument>(`/cards${query({ id, cardId })}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },

  deleteCard(id: string, cardId: string): Promise<CardsDocument> {
    return requestJson<CardsDocument>(`/cards${query({ id, cardId })}`, { method: 'DELETE' })
  },

  /* ── paper relation graph ──────────────────────────────────────────── */

  relations(): Promise<RelationsDocument> {
    return requestJson<RelationsDocument>('/relations')
  },

  addRelation(input: NewRelation): Promise<RelationsDocument> {
    return requestJson<RelationsDocument>('/relations', { method: 'POST', body: JSON.stringify(input) })
  },

  updateRelation(
    relationId: string,
    patch: { kind?: RelationKind; label?: string; note?: string },
  ): Promise<RelationsDocument> {
    return requestJson<RelationsDocument>(`/relations${query({ relationId })}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },

  deleteRelation(relationId: string): Promise<RelationsDocument> {
    return requestJson<RelationsDocument>(`/relations${query({ relationId })}`, { method: 'DELETE' })
  },

  /** Every stored relation (the graph endpoint is the same document). */
  graph(): Promise<{ papers: unknown; relations: RelationsDocument }> {
    return requestJson<{ papers: unknown; relations: RelationsDocument }>('/graph')
  },

  /* ── saved comparisons ─────────────────────────────────────────────── */

  comparisons(): Promise<{ comparisons: ComparisonSummary[] }> {
    return requestJson<{ comparisons: ComparisonSummary[] }>('/comparisons')
  },

  comparison(id: string): Promise<PaperComparison> {
    return requestJson<PaperComparison>(`/comparisons${query({ id })}`)
  },

  saveComparison(input: { title: string; paperIds: string[]; markdown: string }): Promise<PaperComparison> {
    return requestJson<PaperComparison>('/comparisons', { method: 'POST', body: JSON.stringify(input) })
  },

  deleteComparison(id: string): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(`/comparisons${query({ id })}`, { method: 'DELETE' })
  },

  /** Prompt for comparing papers (then run it in an AI thread). */
  compareAssist(paperIds: string[]): Promise<AssistPayload> {
    const body: AssistRequest = { paperId: paperIds[0] ?? '', task: 'compare', paperIds }
    return requestJson<AssistPayload>('/assist', { method: 'POST', body: JSON.stringify(body) })
  },

  /** URL of a bundled pdf.js asset (base PDF.js build, cmaps, fonts, CSS). */
  pdfjsUrl(relPath: string): string {
    const clean = relPath.replace(/^\/+/, '')
    return `${BASE}/pdfjs/${clean}`
  },

  reveal(id: string): Promise<RevealResult> {
    return requestJson<RevealResult>('/reveal', { method: 'POST', body: JSON.stringify({ id }) })
  },

  /** Inline URL for the PDF viewer iframe. */
  pdfUrl(id: string): string {
    return `${BASE}/file${query({ id })}`
  },

  /** `GET /status` cloud info without the rest (sync badge helper). */
  async cloud(): Promise<CloudInfo> {
    const status = await this.status()
    return status.cloud
  },
}

export type Api = typeof api
