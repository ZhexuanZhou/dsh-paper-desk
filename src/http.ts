/**
 * PaperDesk workbench HTTP half: the JSON API under /api/paper-desk used by the
 * browser panel (and only that). Every filesystem access is confined to the
 * configured library root by the modules below; ids are validated here.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.js'
import {
  addAnnotation,
  readAnnotations,
  removeAnnotation,
  updateAnnotation,
} from './annotations.js'
import { readPdfjsAsset } from './assets.js'
import { addCard, readCards, removeCard, updateCard } from './cards.js'
import { addChat, deleteChat, readChats, updateChat } from './chats.js'
import {
  deleteComparison,
  listComparisons,
  readComparison,
  saveComparison,
} from './comparisons.js'
import { discoveryScope, markDiscoveryAnalyzed } from './discovery.js'
import { addRelation, readRelations, removeRelation, updateRelation } from './relations.js'
import { syncCitationEdges } from './references.js'
import {
  bibtexOf,
  createPaper,
  deletePaper,
  getPaper,
  importInbox,
  readMeta,
  stats,
  updateMeta,
} from './library.js'
import { crossrefByDoi, crossrefSearch } from './metadata.js'
import { appendToNotes, readNotes, writeNotes } from './notes.js'
import { importPaperFromUrl } from './urlImport.js'
import { readResearch, saveTopic, topicPrompt, saveSubscription, updateResearch } from './research.js'
import { discoverPapers, arxivIdentity } from './feed.js'
import { createLlmTagger } from './tagging.js'
import { synthesizeCard, type SynthesizedCard } from './cardsynth.js'
import { synthesizeNotes } from './notesynth.js'
import type { AutoTagFn } from './autotag.js'
import type { CardContextTurn } from './types.js'
import { ensureText } from './pdf.js'
import { assistPayload, comparePrompt, discoverRelationsPrompt } from './prompt.js'
import { listTags, queryPapers, searchLibrary } from './search.js'
import {
  deviceShort,
  effectiveSettings,
  isDirectory,
  loadSettings,
  saveSettings,
  validateSettingsInput,
  type SettingsFile,
} from './settings.js'
import { computeDelta, detectCloud, downloadEvicted, resolveConflict, syncStatus } from './sync.js'
import { readPackageJson, sha256File } from './util.js'
import type {
  AnnotationPatch,
  EffectiveSettings,
  NewNoteCard,
  NewRelation,
  PaperComparison,
  RelationKind,
  EnrichResult,
  NewAnnotation,
  NoteSection,
  PaperMeta,
  PaperStatus,
  StatusPayload,
} from './types.js'

const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const JSON_BODY_CAP = 1024 * 1024

type Req = {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
  on(event: 'data', cb: (chunk: Buffer) => void): unknown
  on(event: 'end', cb: () => void): unknown
  on(event: 'error', cb: (error: Error) => void): unknown
}

type Res = {
  writeHead(code: number, headers: Record<string, string>): unknown
  end(body: string | Uint8Array): unknown
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(res: Res, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function requirePdfId(raw: string | null): string {
  const id = (raw ?? '').trim()
  if (!PAPER_ID_RE.test(id)) throw new HttpError(400, 'invalid or missing paper id')
  return id
}

function queryParams(url: URL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) out[key] = value
  return out
}

/** Read a JSON request body with a hard cap. */
async function readJsonBody(req: Req, cap = JSON_BODY_CAP): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > cap) {
        reject(new HttpError(413, `request body too large (max ${cap} bytes)`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve())
    req.on('error', (error: Error) => reject(error))
  })
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'request body must be a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid JSON body')
  }
}

/**
 * Stream an uploaded PDF to disk (no in-memory buffering, no byte cap, so a
 * multi-GB file cannot exhaust the Host heap). Returns the absolute temp path.
 */
async function receiveUpload(req: Req, dirAbs: string, fileName: string): Promise<string> {
  await mkdir(dirAbs, { recursive: true })
  const dest = path.join(dirAbs, fileName)
  const out = createWriteStream(dest)
  const withFlow = req as Req & { pause?: () => void; resume?: () => void }
  let total = 0
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      out.destroy()
      reject(error)
    }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (!out.write(chunk)) {
        withFlow.pause?.()
        out.once('drain', () => withFlow.resume?.())
      }
    })
    req.on('end', () => {
      if (settled) return
      out.end(() => {
        settled = true
        resolve()
      })
    })
    req.on('error', (error: Error) => fail(error))
    out.on('error', (error: Error) => fail(error))
  })
  if (total === 0) {
    await rm(dest, { force: true }).catch(() => undefined)
    throw new HttpError(400, 'empty upload')
  }
  return dest
}

function headerValue(req: Req, name: string): string | undefined {
  const raw = req.headers?.[name.toLowerCase()]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === undefined ? undefined : value
}

function requireConfigured(config: Config): EffectiveSettings {
  const settings = effectiveSettings(config)
  if (settings.libraryPath.length === 0) {
    throw new HttpError(
      400,
      '论文库尚未配置：请打开「论文库 PaperDesk」面板，在设置里选择一个论文库目录后再试。',
    )
  }
  if (!isDirectory(settings.libraryPath)) {
    throw new HttpError(409, `论文库目录不存在：${settings.libraryPath}（可能被移动，或网盘尚未同步到本机）`)
  }
  return settings
}

function cloudOf(settings: EffectiveSettings) {
  return detectCloud(settings.libraryPath.length > 0 ? settings.libraryPath : '')
}

async function buildStatus(config: Config): Promise<StatusPayload> {
  const settings = effectiveSettings(config)
  const pkg = readPackageJson()
  const libraryExists = settings.libraryPath.length > 0 && isDirectory(settings.libraryPath)
  let problem: string | undefined
  if (settings.libraryPath.length > 0 && !libraryExists) {
    problem = `论文库目录不存在：${settings.libraryPath}`
  } else if (settings.libraryPath.length === 0) {
    problem = '尚未选择论文库目录'
  }
  const counts =
    libraryExists
      ? await stats(settings.libraryPath).catch(() => ({
          papers: 0,
          unread: 0,
          reading: 0,
          read: 0,
          withNotes: 0,
          pdfsMissing: 0,
        }))
      : { papers: 0, unread: 0, reading: 0, read: 0, withNotes: 0, pdfsMissing: 0 }
  return {
    ok: true,
    plugin: 'dsh-paper-desk',
    version: pkg?.version ?? '0.0.0',
    configured: settings.libraryPath.length > 0 && libraryExists,
    libraryExists,
    settings,
    cloud: cloudOf(settings),
    counts,
    problem,
  }
}

/** Open the library or one paper in the OS file manager. */
async function revealPath(target: string): Promise<{ ok: boolean; message?: string }> {
  const platform = process.platform
  const [command, args] =
    platform === 'darwin'
      ? ['open', ['-R', target]]
      : platform === 'win32'
        ? ['explorer', ['/select,', target]]
        : ['xdg-open', [path.dirname(target)]]
  return await new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true })
      child.on('error', (error: Error) => resolve({ ok: false, message: error.message }))
      child.on('spawn', () => resolve({ ok: true }))
      child.unref()
    } catch (error) {
      resolve({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  })
}

async function textExtraction(
  settings: EffectiveSettings,
  paperId: string,
  force: boolean,
): Promise<{ pageCount: number; lowText: boolean; pages: { page: number; text: string }[] }> {
  const meta = await readMeta(settings.libraryPath, paperId)
  if (meta === null) throw new HttpError(404, `paper not found: ${paperId}`)
  if (meta.pdfFile === null) throw new HttpError(404, 'this paper has no PDF attached')
  const pdfAbs = path.join(settings.libraryPath, 'papers', paperId, meta.pdfFile)
  const info = await stat(pdfAbs).catch(() => undefined)
  if (info === undefined || !info.isFile()) {
    throw new HttpError(404, 'PDF file is missing (it may still need to download from the cloud drive)')
  }
  const sha = meta.pdfSha256 ?? (await sha256File(pdfAbs))
  const text = await ensureText(settings.libraryPath, paperId, { pdfAbs, sha, force })
  return { pageCount: text.pageCount, lowText: text.lowText, pages: text.pages }
}

/** Token-overlap similarity used to reject weak bibliographic Crossref matches. */
function titleSimilarity(a: string, b: string): number {
  const tokens = (value: string): Set<string> =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff ]+/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 1),
    )
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  // Require overlap in BOTH directions: a short candidate ("Embedded language")
  // must not score 1.0 against a long title just because it is a subset.
  const precision = shared / right.size
  const recall = shared / left.size
  return Math.min(precision, recall)
}

/** Enrich empty metadata fields from Crossref (DOI first, then title search). */
async function enrichPaper(settings: EffectiveSettings, paperId: string): Promise<{ meta: PaperMeta; enrich: EnrichResult }> {
  const meta = await readMeta(settings.libraryPath, paperId)
  if (meta === null) throw new HttpError(404, `paper not found: ${paperId}`)
  const byDoi = meta.doi.length > 0
  const record = byDoi
    ? await crossrefByDoi(meta.doi)
    : await crossrefSearch(
        [meta.title, meta.authors.slice(0, 3).join(' ')].filter((part) => part.length > 0).join(' '),
      )
  if (record === null) {
    return { meta, enrich: { ok: false, changed: [], source: 'none', message: 'Crossref 没有找到匹配的条目（可能未联网或该论文没有 DOI）' } }
  }
  // A bibliographic search can confidently match the wrong paper; require the
  // candidate title to actually resemble ours. DOI lookups are authoritative.
  if (!byDoi) {
    const similarity = titleSimilarity(meta.title, record.title ?? '')
    if (similarity < 0.6) {
      return {
        meta,
        enrich: {
          ok: false,
          changed: [],
          source: 'bibliographic',
          message: `Crossref 返回的候选标题与当前论文不匹配（相似度 ${(similarity * 100).toFixed(0)}%），已忽略：${record.title ?? ''}`,
        },
      }
    }
  }

  const patch: Partial<PaperMeta> = {}
  const changed: string[] = []
  if (record.title !== undefined && record.title.length > 0 && (meta.title.length === 0 || meta.title.length < 12 || meta.title.startsWith('untitled'))) {
    patch.title = record.title
    changed.push('title')
  }
  if (record.authors !== undefined && record.authors.length > 0 && meta.authors.length === 0) {
    patch.authors = record.authors
    changed.push('authors')
  }
  if (record.year !== undefined && record.year !== null && meta.year === null) {
    patch.year = record.year
    changed.push('year')
  }
  if (record.venue !== undefined && record.venue.length > 0 && meta.venue.length === 0) {
    patch.venue = record.venue
    changed.push('venue')
  }
  if (record.doi !== undefined && record.doi.length > 0 && meta.doi.length === 0) {
    patch.doi = record.doi
    changed.push('doi')
  }
  if (record.url !== undefined && record.url.length > 0 && meta.url.length === 0) {
    patch.url = record.url
    changed.push('url')
  }
  if (record.abstract !== undefined && record.abstract.length > 0 && meta.abstract.length === 0) {
    patch.abstract = record.abstract
    changed.push('abstract')
  }
  const updated = changed.length > 0 ? await updateMeta(settings.libraryPath, paperId, patch) : meta
  return {
    meta: updated,
    enrich: { ok: true, changed, source: meta.doi.length > 0 ? 'doi' : 'bibliographic' },
  }
}

type CardSynthFn = (turns: readonly CardContextTurn[]) => Promise<SynthesizedCard>
type NotesSynthFn = (cards: Awaited<ReturnType<typeof readCards>>['items']) => Promise<string>

async function handle(
  req: Req,
  res: Res,
  config: Config,
  autoTag?: AutoTagFn,
  cardSynth?: CardSynthFn,
  notesSynth?: NotesSynthFn,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = (req.method ?? 'GET').toUpperCase()
    const segments = url.pathname.split('/').filter((part) => part.length > 0)
    if (segments[0] !== 'api' || segments[1] !== 'paper-desk') {
      json(res, 404, { error: 'not-found' })
      return
    }
    const rest = segments.slice(2)
    const q = queryParams(url)
    const route = rest.join('/')

    // Routes that work even before a library is configured.
    if (route === 'status') {
      if (method !== 'GET') return methodNotAllowed(res)
      json(res, 200, await buildStatus(config))
      return
    }
    if (route === 'settings') {
      if (method === 'GET') {
        const effective = effectiveSettings(config)
        json(res, 200, { file: effective.settingsFile, effective, loaded: loadSettingsForUi() })
        return
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const invalid = validateSettingsInput(body)
        if (invalid !== null) throw new HttpError(400, invalid)
        const update: SettingsFile = {}
        if (body['libraryPath'] !== undefined) {
          const raw = String(body['libraryPath']).trim()
          if (raw.length > 0) {
            // Accept `~/...` from the UI's default-directory shortcut.
            const expanded = raw.replace(/^~(?=$|[\\/])/, os.homedir())
            const resolved = path.resolve(expanded)
            if (!isDirectory(resolved)) {
              try {
                // The first-run flow targets a not-yet-existing directory.
                await mkdir(resolved, { recursive: true })
              } catch (error) {
                throw new HttpError(400, `无法创建目录 ${resolved}：${error instanceof Error ? error.message : String(error)}`)
              }
            }
            update.libraryPath = resolved
          } else {
            update.libraryPath = ''
          }
        }
        if (body['language'] !== undefined) update.language = body['language'] as 'zh' | 'en'
        if (body['enrich'] !== undefined) update.enrich = Boolean(body['enrich'])
        if (body['autoImportInbox'] !== undefined) update.autoImportInbox = Boolean(body['autoImportInbox'])
        if (body['citationSync'] !== undefined) update.citationSync = Boolean(body['citationSync'])
        if (body['maxPdfBytes'] !== undefined) update.maxPdfBytes = Number(body['maxPdfBytes'])
        saveSettings(update)
        const effective = effectiveSettings(config)
        if (effective.libraryPath.length > 0 && isDirectory(effective.libraryPath)) {
          const { ensureLayout } = await import('./library.js')
          await ensureLayout(effective.libraryPath).catch(() => undefined)
        }
        json(res, 200, { file: effective.settingsFile, effective, loaded: loadSettingsForUi() })
        return
      }
      return methodNotAllowed(res)
    }

    // Bundled pdf.js assets (the in-app viewer loads them from here). These are
    // read-only package files and work even before a library is configured.
    if (route.startsWith('pdfjs/')) {
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res)
      const asset = await readPdfjsAsset(route.slice('pdfjs/'.length))
      if (asset === null) throw new HttpError(404, 'pdfjs asset not found')
      res.writeHead(200, {
        'content-type': asset.contentType,
        'cache-control': 'public, max-age=86400',
      })
      res.end(asset.bytes)
      return
    }

    const settings = requireConfigured(config)
    const root = settings.libraryPath

    if (route === 'research') {
      if (method === 'GET') return json(res, 200, await readResearch(root))
      if (method === 'POST') return json(res, 200, await saveTopic(root, await readJsonBody(req)))
      if (method === 'DELETE') {
        const body = await readJsonBody(req)
        return json(res, 200, await updateResearch(root, body.baseHash, (doc) => {
          if (!doc.topics.some((item) => item.id === body.id)) throw new HttpError(404, '专题不存在')
          doc.topics = doc.topics.filter((item) => item.id !== body.id)
        }))
      }
      return methodNotAllowed(res)
    }
    if (route === 'research/prompt' && method === 'POST') {
      const body = await readJsonBody(req)
      if (typeof body.id !== 'string' || typeof body.question !== 'string') throw new HttpError(400, '缺少专题或问题')
      return json(res, 200, { prompt: await topicPrompt(root, body.id, body.question) })
    }
    if (route === 'research/subscriptions') {
      const body = await readJsonBody(req)
      if (method === 'POST') return json(res, 200, await saveSubscription(root, body))
      if (method === 'DELETE') return json(res, 200, await updateResearch(root, body.baseHash, (doc) => {
        doc.subscriptions = doc.subscriptions.filter((item) => item.id !== body.id)
      }))
      return methodNotAllowed(res)
    }
    if (route === 'research/discover' && method === 'GET') {
      const rows = await queryPapers(root, { limit: 1000 })
      const papers = (await Promise.all(rows.map((paper) => readMeta(root, paper.id)))).filter((paper): paper is PaperMeta => paper !== null)
      const query = q['q'] ?? ''
      const items = await discoverPapers(query, papers)
      return json(res, 200, { items, checkedAt: new Date().toISOString() })
    }
    if (route === 'research/subscriptions/check' && method === 'POST') {
      const body = await readJsonBody(req)
      return json(res, 200, await updateResearch(root, body.baseHash, (doc) => {
        const subscription = doc.subscriptions.find((item) => item.id === body.id)
        if (!subscription || typeof body.checkedAt !== 'string' || !Number.isFinite(Date.parse(body.checkedAt))) throw new HttpError(400, '无效的订阅检查时间')
        subscription.lastChecked = body.checkedAt
      }))
    }

    if (route === 'papers') {
      if (method === 'GET') {
        const limit = Math.min(Math.max(Number.parseInt(q['limit'] ?? '0', 10) || 200, 1), 1000)
        const status = (q['status'] ?? 'all') as PaperStatus | 'all'
        const [papers, tags] = await Promise.all([
          queryPapers(root, {
            q: q['q'],
            tag: q['tag'],
            status,
            sort: (q['sort'] ?? 'added') as 'added' | 'title' | 'year' | 'updated',
            limit,
          }),
          listTags(root),
        ])
        json(res, 200, { count: papers.length, papers, tags })
        return
      }
      if (method === 'POST') {
        const enrich = q['enrich'] !== '0'
        const importPath = (q['path'] ?? '').trim()
        if (importPath.length > 0) {
          const absolute = path.resolve(importPath)
          const info = await stat(absolute).catch(() => undefined)
          if (info === undefined || !info.isFile()) throw new HttpError(404, `file not found: ${absolute}`)
          if (!absolute.toLowerCase().endsWith('.pdf')) throw new HttpError(400, 'only PDF files can be imported')
          const created = await createPaper(root, {
            sourcePath: absolute,
            source: 'import',
            enrich,
            autoTag,
            language: settings.language,
            device: deviceShort(),
          })
          json(res, 200, { id: created.id, meta: created.meta, duplicated: created.duplicated })
          return
        }
        const rawName = headerValue(req, 'x-file-name') ?? ''
        let fileName = 'paper.pdf'
        try {
          fileName = decodeURIComponent(rawName)
        } catch {
          fileName = rawName
        }
        if (fileName.length === 0) fileName = 'paper.pdf'
        if (!fileName.toLowerCase().endsWith('.pdf')) fileName = `${fileName}.pdf`
        const safeFileName = path.basename(fileName).replace(/[\\/]/g, '_') || 'paper.pdf'
        const stagingDirAbs = path.join(root, '.paperdesk', 'cache', `upload-${randomUUID()}`)
        const uploadedAbs = await receiveUpload(req, stagingDirAbs, safeFileName)
        try {
          const created = await createPaper(root, {
            sourcePath: uploadedAbs,
            fileName: safeFileName,
            source: 'import',
            enrich,
            autoTag,
            language: settings.language,
            device: deviceShort(),
          })
          json(res, 200, { id: created.id, meta: created.meta, duplicated: created.duplicated })
        } finally {
          await rm(stagingDirAbs, { recursive: true, force: true }).catch(() => undefined)
        }
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'papers/url') {
      if (method !== 'POST') return methodNotAllowed(res)
      const body = await readJsonBody(req)
      const identity = typeof body['url'] === 'string' ? arxivIdentity(body['url']) : null
      if (identity) {
        for (const row of await queryPapers(root, { limit: 1000 })) {
          const meta = await readMeta(root, row.id)
          if (meta && (arxivIdentity(meta.sourceUrl) === identity || arxivIdentity(meta.url) === identity)) {
            return json(res, 200, { id: meta.id, meta, duplicated: true })
          }
        }
      }
      const rawUrl = typeof body['url'] === 'string' ? body['url'] : ''
      try {
        const created = await importPaperFromUrl(root, rawUrl, {
          language: settings.language,
          device: deviceShort(),
          enrich: settings.enrich,
          autoTag,
        })
        json(res, 200, created)
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : '链接导入失败')
      }
      return
    }

    if (route === 'paper') {
      const id = requirePdfId(q['id'] ?? null)
      if (method === 'GET') {
        const detail = await getPaper(root, id)
        if (detail === null) throw new HttpError(404, `paper not found: ${id}`)
        json(res, 200, detail)
        return
      }
      if (method === 'PATCH') {
        const body = await readJsonBody(req)
        const patch = pickMetaPatch(body)
        if (Object.keys(patch).length === 0) throw new HttpError(400, 'no editable field provided')
        const meta = await updateMeta(root, id, patch)
        json(res, 200, { meta })
        return
      }
      if (method === 'DELETE') {
        const result = await deletePaper(root, id)
        json(res, 200, result)
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'notes') {
      const id = requirePdfId(q['id'] ?? null)
      if (method === 'GET') {
        json(res, 200, await readNotes(root, id))
        return
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req)
        const markdown = typeof body['markdown'] === 'string' ? body['markdown'] : ''
        const baseHash = typeof body['baseHash'] === 'string' && body['baseHash'].length > 0 ? body['baseHash'] : undefined
        const result = await writeNotes(root, id, markdown, { baseHash, device: deviceShort() })
        json(res, result.conflict ? 409 : 200, result)
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'notes/append') {
      if (method !== 'POST') return methodNotAllowed(res)
      const id = requirePdfId(q['id'] ?? null)
      const body = await readJsonBody(req)
      const text = typeof body['text'] === 'string' ? body['text'] : ''
      if (text.trim().length === 0) throw new HttpError(400, 'text is required')
      const sectionRaw = typeof body['section'] === 'string' ? body['section'] : undefined
      const section = isNoteSection(sectionRaw) ? sectionRaw : undefined
      const page = typeof body['page'] === 'number' && Number.isFinite(body['page']) ? Math.trunc(body['page']) : undefined
      const by = body['by'] === 'agent' ? 'agent' : 'user'
      const result = await appendToNotes(
        root,
        { paperId: id, text, section, page, by },
        { language: settings.language, device: deviceShort() },
      )
      json(res, result.conflict ? 409 : 200, result)
      return
    }

    if (route === 'annotations') {
      const id = requirePdfId(q['id'] ?? null)
      if (method === 'GET') {
        json(res, 200, await readAnnotations(root, id))
        return
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        json(res, 200, await addAnnotation(root, id, body as unknown as NewAnnotation))
        return
      }
      if (method === 'PATCH') {
        const annotationId = (q['annotationId'] ?? '').trim()
        if (annotationId.length === 0) throw new HttpError(400, 'annotationId is required')
        const body = await readJsonBody(req)
        json(res, 200, await updateAnnotation(root, id, annotationId, body as unknown as AnnotationPatch))
        return
      }
      if (method === 'DELETE') {
        const annotationId = (q['annotationId'] ?? '').trim()
        if (annotationId.length === 0) throw new HttpError(400, 'annotationId is required')
        json(res, 200, await removeAnnotation(root, id, annotationId))
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'chats') {
      const id = requirePdfId(q['id'] ?? null)
      if (method === 'GET') {
        json(res, 200, await readChats(root, id))
        return
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        json(res, 200, await addChat(root, id, body as unknown as { title?: string }))
        return
      }
      if (method === 'PATCH') {
        const chatId = (q['chatId'] ?? '').trim()
        if (chatId.length === 0) throw new HttpError(400, 'chatId is required')
        const body = await readJsonBody(req)
        json(
          res,
          200,
          await updateChat(root, id, chatId, body as unknown as { title?: string; messages?: import('./types.js').ChatMessage[] }),
        )
        return
      }
      if (method === 'DELETE') {
        const chatId = (q['chatId'] ?? '').trim()
        if (chatId.length === 0) throw new HttpError(400, 'chatId is required')
        json(res, 200, await deleteChat(root, id, chatId))
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'cards/synthesize') {
      if (method !== 'POST') return methodNotAllowed(res)
      if (cardSynth === undefined) throw new HttpError(503, 'card synthesis is unavailable')
      const body = await readJsonBody(req)
      const rawTurns = body['turns']
      if (!Array.isArray(rawTurns) || rawTurns.length === 0) throw new HttpError(400, 'turns are required')
      const turns: CardContextTurn[] = []
      for (const value of rawTurns.slice(0, 12)) {
        if (value === null || typeof value !== 'object') continue
        const record = value as Record<string, unknown>
        const role = record['role'] === 'user' ? 'user' : record['role'] === 'assistant' ? 'assistant' : null
        const text = typeof record['text'] === 'string' ? record['text'].trim() : ''
        if (role === null || text === '') continue
        turns.push({ role, text: text.slice(0, 4000), ...(typeof record['id'] === 'string' ? { id: record['id'] } : {}) })
      }
      if (turns.length === 0) throw new HttpError(400, 'no valid turns')
      json(res, 200, await cardSynth(turns))
      return
    }

    if (route === 'cards/summary') {
      if (method !== 'POST') return methodNotAllowed(res)
      if (notesSynth === undefined) throw new HttpError(503, 'card summary is unavailable')
      const id = requirePdfId(q['id'] ?? null)
      const doc = await readCards(root, id)
      json(res, 200, { text: await notesSynth(doc.items) })
      return
    }

    if (route === 'cards') {
      const id = requirePdfId(q['id'] ?? null)
      if (method === 'GET') {
        json(res, 200, await readCards(root, id))
        return
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        json(res, 200, await addCard(root, id, body as unknown as NewNoteCard))
        return
      }
      if (method === 'PATCH') {
        const cardId = (q['cardId'] ?? '').trim()
        if (cardId.length === 0) throw new HttpError(400, 'cardId is required')
        const body = await readJsonBody(req)
        json(
          res,
          200,
          await updateCard(root, id, cardId, body as unknown as Partial<Pick<NewNoteCard, 'title' | 'body' | 'tags' | 'pages'>>),
        )
        return
      }
      if (method === 'DELETE') {
        const cardId = (q['cardId'] ?? '').trim()
        if (cardId.length === 0) throw new HttpError(400, 'cardId is required')
        json(res, 200, await removeCard(root, id, cardId))
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'relations') {
      if (method === 'GET') {
        json(res, 200, await readRelations(root))
        return
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        json(res, 200, await addRelation(root, body as unknown as NewRelation))
        return
      }
      if (method === 'PATCH') {
        const relationId = (q['relationId'] ?? '').trim()
        if (relationId.length === 0) throw new HttpError(400, 'relationId is required')
        const body = await readJsonBody(req)
        json(
          res,
          200,
          await updateRelation(root, relationId, body as unknown as { kind?: RelationKind; label?: string; note?: string }),
        )
        return
      }
      if (method === 'DELETE') {
        const relationId = (q['relationId'] ?? '').trim()
        if (relationId.length === 0) throw new HttpError(400, 'relationId is required')
        json(res, 200, await removeRelation(root, relationId))
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'relations/citations') {
      if (method !== 'POST') return methodNotAllowed(res)
      const body = await readJsonBody(req)
      const rawIds = Array.isArray(body['ids']) ? body['ids'] : undefined
      let ids: string[] | undefined
      if (rawIds !== undefined) {
        ids = []
        for (const value of rawIds) {
          if (typeof value !== 'string') throw new HttpError(400, 'ids must be strings')
          const id = requirePdfId(value)
          if (!ids.includes(id)) ids.push(id)
        }
        if (ids.length === 0) throw new HttpError(400, 'ids must not be empty')
        if (ids.length > 20) throw new HttpError(400, 'at most 20 papers per scan')
      }
      json(res, 200, await syncCitationEdges(root, ids))
      return
    }
    if (route === 'relations/discovery-scope') {
      if (method !== 'GET') return methodNotAllowed(res)
      const { listPaperIds } = await import('./library.js')
      const papers = []
      for (const paperId of await listPaperIds(root)) {
        const meta = await readMeta(root, paperId)
        if (meta !== null) papers.push(meta)
      }
      json(res, 200, await discoveryScope(root, papers, await readRelations(root)))
      return
    }

    if (route === 'relations/discovery-mark') {
      if (method !== 'POST') return methodNotAllowed(res)
      const body = await readJsonBody(req)
      const rawIds = Array.isArray(body['ids']) ? body['ids'] : []
      if (rawIds.length === 0) throw new HttpError(400, 'ids must not be empty')
      const want = new Set<string>()
      for (const value of rawIds) {
        if (typeof value !== 'string') throw new HttpError(400, 'ids must be strings')
        want.add(requirePdfId(value))
      }
      const { listPaperIds } = await import('./library.js')
      const papers = []
      for (const paperId of await listPaperIds(root)) {
        const meta = await readMeta(root, paperId)
        if (meta !== null) papers.push(meta)
      }
      const ids = papers.map((paper) => paper.id).filter((id) => want.has(id))
      json(res, 200, await markDiscoveryAnalyzed(root, papers, ids))
      return
    }


    if (route === 'graph') {
      if (method !== 'GET') return methodNotAllowed(res)
      const [papers, relations] = await Promise.all([queryPapers(root, { limit: 1000 }), readRelations(root)])
      json(res, 200, { papers, relations })
      return
    }

    if (route === 'comparisons') {
      if (method === 'GET') {
        const id = (q['id'] ?? '').trim()
        if (id.length > 0) {
          const comparison = await readComparison(root, id)
          if (comparison === null) throw new HttpError(404, `comparison not found: ${id}`)
          json(res, 200, comparison)
          return
        }
        json(res, 200, { comparisons: await listComparisons(root) })
        return
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const title = typeof body['title'] === 'string' ? body['title'] : ''
        const markdown = typeof body['markdown'] === 'string' ? body['markdown'] : ''
        const rawIds = Array.isArray(body['paperIds']) ? body['paperIds'] : []
        const paperIds = rawIds.filter((value): value is string => typeof value === 'string')
        const comparison: PaperComparison = await saveComparison(root, { title, paperIds, markdown })
        json(res, 200, comparison)
        return
      }
      if (method === 'DELETE') {
        const id = (q['id'] ?? '').trim()
        if (id.length === 0) throw new HttpError(400, 'id is required')
        await deleteComparison(root, id)
        json(res, 200, { ok: true })
        return
      }
      return methodNotAllowed(res)
    }

    if (route === 'enrich') {
      if (method !== 'POST') return methodNotAllowed(res)
      const id = requirePdfId(q['id'] ?? null)
      json(res, 200, await enrichPaper(settings, id))
      return
    }

    if (route === 'text') {
      if (method !== 'POST') return methodNotAllowed(res)
      const id = requirePdfId(q['id'] ?? null)
      const force = q['force'] === '1'
      json(res, 200, { text: await textExtraction(settings, id, force) })
      return
    }

    if (route === 'file') {
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res)
      const id = requirePdfId(q['id'] ?? null)
      const meta = await readMeta(root, id)
      if (meta === null) throw new HttpError(404, `paper not found: ${id}`)
      if (meta.pdfFile === null) throw new HttpError(404, 'this paper has no PDF attached')
      const pdfAbs = path.join(root, 'papers', id, meta.pdfFile)
      const bytes = await readFile(pdfAbs).catch(() => undefined)
      if (bytes === undefined) {
        throw new HttpError(404, 'PDF file is missing locally (it may still need to download from the cloud drive)')
      }
      const etag = meta.pdfSha256 !== null && meta.pdfSha256 !== ''
        ? `"${meta.pdfSha256}"`
        : `W/${bytes.length}-${bytes.length}`
      const reqHeaders = req.headers ?? {}
      if (reqHeaders['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'cache-control': 'private, max-age=3600' })
        res.end('')
        return
      }
      const headers: Record<string, string> = {
        'content-type': 'application/pdf',
        'content-disposition': 'inline',
        'accept-ranges': 'bytes',
        etag,
        'cache-control': 'private, max-age=3600',
      }
      const rangeHeader = reqHeaders['range']
      let start = 0
      let end = bytes.length - 1
      let status = 200
      if (typeof rangeHeader === 'string') {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
        if (match === null) {
          res.writeHead(416, { 'content-range': `bytes */${bytes.length}` })
          res.end('')
          return
        }
        const rawStart = match[1] === '' ? Number.NaN : Number.parseInt(match[1] ?? '', 10)
        const rawEnd = match[2] === '' ? Number.NaN : Number.parseInt(match[2] ?? '', 10)
        if (Number.isFinite(rawStart)) start = rawStart
        if (Number.isFinite(rawEnd)) end = rawEnd
        if (!Number.isFinite(rawStart) && Number.isFinite(rawEnd)) {
          start = Math.max(0, bytes.length - end)
          end = bytes.length - 1
        }
        if (start < 0 || end < start || start >= bytes.length) {
          res.writeHead(416, { 'content-range': `bytes */${bytes.length}` })
          res.end('')
          return
        }
        end = Math.min(end, bytes.length - 1)
        status = 206
        headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`
      }
      headers['content-length'] = String(end - start + 1)
      res.writeHead(status, headers)
      if (method === 'HEAD') {
        res.end('')
        return
      }
      res.end(bytes.subarray(start, end + 1))
      return
    }

    if (route === 'search') {
      if (method !== 'GET') return methodNotAllowed(res)
      const query = (q['q'] ?? '').trim()
      if (query.length === 0) throw new HttpError(400, 'q is required')
      const limit = Math.min(Math.max(Number.parseInt(q['limit'] ?? '0', 10) || 40, 1), 60)
      const hits = await searchLibrary(root, query, limit)
      json(res, 200, { count: hits.length, hits })
      return
    }

    if (route === 'sync') {
      if (method !== 'GET') return methodNotAllowed(res)
      json(res, 200, await syncStatus(root, deviceShort()))
      return
    }

    if (route === 'sync/scan') {
      if (method !== 'POST') return methodNotAllowed(res)
      const result = await computeDelta(root)
      json(res, 200, { delta: result.delta, lastScanAt: result.scannedAt })
      return
    }

    if (route === 'sync/conflicts') {
      if (method !== 'POST') return methodNotAllowed(res)
      const body = await readJsonBody(req)
      const relPath = typeof body['relPath'] === 'string' ? body['relPath'] : ''
      const action = body['action']
      if (relPath.length === 0) throw new HttpError(400, 'relPath is required')
      if (action !== 'use-conflict' && action !== 'discard-conflict') {
        throw new HttpError(400, 'action must be use-conflict or discard-conflict')
      }
      const result = await resolveConflict(root, relPath, action)
      json(res, 200, { ...result, sync: await syncStatus(root, deviceShort()) })
      return
    }

    if (route === 'sync/download') {
      if (method !== 'POST') return methodNotAllowed(res)
      const body = await readJsonBody(req)
      const relPath = typeof body['relPath'] === 'string' ? body['relPath'] : ''
      if (relPath.length === 0) throw new HttpError(400, 'relPath is required')
      json(res, 200, await downloadEvicted(root, relPath))
      return
    }

    if (route === 'inbox') {
      if (method !== 'POST') return methodNotAllowed(res)
      const imported = await importInbox(root, settings.language, autoTag)
      const papers = await queryPapers(root, { limit: 200 })
      json(res, 200, { imported, papers })
      return
    }

    if (route === 'bibtex') {
      if (method !== 'GET') return methodNotAllowed(res)
      const ids = (q['ids'] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      const text = await bibtexOf(root, ids.length > 0 ? ids : undefined)
      res.writeHead(200, { 'content-type': 'text/x-bibtex; charset=utf-8', 'cache-control': 'no-store' })
      res.end(text)
      return
    }

    if (route === 'assist') {
      if (method !== 'POST') return methodNotAllowed(res)
      const body = await readJsonBody(req)
      const task = body['task']
      if (!isAssistTask(task)) throw new HttpError(400, 'invalid assist task')
      if (task === 'discover') {
        const { listPaperIds } = await import('./library.js')
        const rawRequested = Array.isArray(body['paperIds']) ? body['paperIds'] : []
        let ids: string[] = []
        if (rawRequested.length > 0) {
          for (const value of rawRequested) {
            if (typeof value !== 'string') throw new HttpError(400, 'paperIds must be strings')
            const id = requirePdfId(value)
            if (!ids.includes(id)) ids.push(id)
          }
          if (ids.length > 40) throw new HttpError(400, 'discovery scope supports at most 40 papers')
        } else {
          ids = (await listPaperIds(root)).slice(0, 80)
        }
        const papers = []
        for (const discoverId of ids) {
          const meta = await readMeta(root, discoverId)
          if (meta === null) {
            if (rawRequested.length > 0) throw new HttpError(404, `paper not found: ${discoverId}`)
            continue
          }
          papers.push(meta)
        }
        if (papers.length < 2) throw new HttpError(400, 'discovery needs at least 2 papers')
        const graph = await readRelations(root)
        json(
          res,
          200,
          discoverRelationsPrompt(papers, graph, settings, rawRequested.length > 0 ? ids : undefined),
        )
        return
      }
      if (task === 'compare') {
        const rawIds = Array.isArray(body['paperIds']) ? body['paperIds'] : []
        const ids: string[] = []
        for (const value of rawIds) {
          if (typeof value !== 'string') continue
          const next = requirePdfId(value)
          if (!ids.includes(next)) ids.push(next)
        }
        if (ids.length < 2 || ids.length > 6) throw new HttpError(400, 'compare needs 2..6 distinct paper ids')
        if (ids.length > 6) throw new HttpError(400, 'compare supports at most 6 papers')
        const metas = []
        for (const compareId of ids) {
          const compareMeta = await readMeta(root, compareId)
          if (compareMeta === null) throw new HttpError(404, `paper not found: ${compareId}`)
          metas.push(compareMeta)
        }
        json(res, 200, comparePrompt(metas, settings))
        return
      }
      const paperId = requirePdfId(typeof body['paperId'] === 'string' ? body['paperId'] : null)
      const meta = await readMeta(root, paperId)
      if (meta === null) throw new HttpError(404, `paper not found: ${paperId}`)
      const notes = await readNotes(root, paperId)
      const annotations = await readAnnotations(root, paperId).catch(() => undefined)
      const extra = typeof body['extra'] === 'string' ? body['extra'] : undefined
      const quote = typeof body['quote'] === 'string' ? body['quote'] : undefined
      const page = typeof body['page'] === 'number' && Number.isFinite(body['page']) ? Math.trunc(body['page']) : undefined
      const question = typeof body['question'] === 'string' ? body['question'] : undefined
      json(res, 200, assistPayload({ paperId, task, extra, quote, page, question }, meta, notes, settings, annotations))
      return
    }

    if (route === 'reveal') {
      if (method !== 'POST') return methodNotAllowed(res)
      const body = await readJsonBody(req)
      const id = typeof body['id'] === 'string' ? body['id'] : ''
      const target = id.length > 0 ? path.join(root, 'papers', requirePdfId(id)) : root
      const info = await stat(target).catch(() => undefined)
      if (info === undefined) throw new HttpError(404, `path not found: ${target}`)
      json(res, 200, await revealPath(target))
      return
    }

    json(res, 404, { error: 'not-found', path: url.pathname })
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.message })
      return
    }
    // Domain modules tag their own failures with `status` (400 validation,
    // 404 missing, 409 conflict) instead of importing the HTTP error type.
    const tagged = typeof error === 'object' && error !== null && 'status' in error ? (error as { status: unknown }).status : undefined
    if (typeof tagged === 'number' && Number.isInteger(tagged) && tagged >= 400 && tagged <= 599) {
      json(res, tagged, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    json(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function methodNotAllowed(res: Res): void {
  json(res, 405, { error: 'method not allowed' })
}

function isAssistTask(value: unknown): value is 'summary' | 'method' | 'critique' | 'related' | 'questions' | 'quote' | 'compare' | 'discover' | 'custom' {
  return (
    value === 'summary' ||
    value === 'method' ||
    value === 'critique' ||
    value === 'related' ||
    value === 'questions' ||
    value === 'quote' ||
    value === 'compare' ||
    value === 'discover' ||
    value === 'custom'
  )
}

function isNoteSection(value: string | undefined): value is NoteSection['keys'] {
  return (
    value === 'summary' ||
    value === 'points' ||
    value === 'questions' ||
    value === 'quotes' ||
    value === 'thoughts' ||
    value === 'conversation'
  )
}

/** Whitelist the fields a client may patch on meta.json. */
function pickMetaPatch(body: Record<string, unknown>): Partial<PaperMeta> {
  const patch: Partial<PaperMeta> = {}
  const text = (key: string): string | undefined =>
    typeof body[key] === 'string' ? (body[key] as string) : undefined
  const title = text('title')
  if (title !== undefined && title.trim().length > 0) patch.title = title.trim()
  if (Array.isArray(body['authors'])) {
    patch.authors = (body['authors'] as unknown[]).filter((value): value is string => typeof value === 'string')
  } else if (typeof body['authors'] === 'string') {
    patch.authors = (body['authors'] as string)
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }
  if (typeof body['year'] === 'number' && Number.isFinite(body['year'])) {
    patch.year = Math.trunc(body['year'] as number)
  } else if (body['year'] === null) {
    patch.year = null
  }
  for (const key of ['venue', 'doi', 'url', 'abstract'] as const) {
    const value = text(key)
    if (value !== undefined) patch[key] = value
  }
  if (Array.isArray(body['tags'])) {
    patch.tags = (body['tags'] as unknown[]).filter((value): value is string => typeof value === 'string')
  } else if (typeof body['tags'] === 'string') {
    patch.tags = (body['tags'] as string)
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }
  if (Array.isArray(body['keywords'])) {
    patch.keywords = (body['keywords'] as unknown[]).filter((value): value is string => typeof value === 'string')
  }
  if (body['status'] === 'unread' || body['status'] === 'reading' || body['status'] === 'read' || body['status'] === 'archived') {
    patch.status = body['status']
  }
  if (typeof body['rating'] === 'number' && Number.isFinite(body['rating'])) {
    patch.rating = Math.min(Math.max(Math.trunc(body['rating'] as number), 0), 5)
  }
  return patch
}

/** Settings overrides only (for the settings panel's diagnostics). */
function loadSettingsForUi(): Record<string, unknown> {
  return loadSettings() as unknown as Record<string, unknown>
}

/** The browser panel's data routes, registered under /api/paper-desk. */
export function buildRoutes(
  config: Config,
  autoTag?: AutoTagFn,
  cardSynth?: CardSynthFn,
  notesSynth?: NotesSynthFn,
): WebRoute[] {
  return [
    {
      kind: 'prefix',
      path: '/api/paper-desk',
      handler: (req, res) => handle(req, res, config, autoTag, cardSynth, notesSynth),
    },
  ]
}

export const name = 'paper-desk-workbench'

/** Requires the web server; in headless deployments the row simply stays pending. */
export const inject = ['webServer']

export function apply(ctx: Context, config: Config): void {
  const autoTag = createLlmTagger(ctx, config)
  const cardSynth: CardSynthFn = (turns) => synthesizeCard(ctx, config, turns)
  const notesSynth: NotesSynthFn = (cards) => synthesizeNotes(ctx, config, cards)
  ctx.effect(() => {
    const disposers = buildRoutes(config, autoTag, cardSynth, notesSynth).map((route) => ctx.webServer.register(route))
    return () => disposers.forEach((dispose) => dispose())
  })
}

/** Object-form plugin handle for ctx.plugin() mounting from the main plugin. */
export const plugin = {
  name,
  inject,
  apply,
}
