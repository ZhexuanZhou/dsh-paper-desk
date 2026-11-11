/**
 * Agent-facing tools. Every tool returns a plain `{ ok, error? , ... }` object:
 * an unconfigured or broken library is reported to the model instead of throwing,
 * so a session never dies because of the paper library.
 */
import { stat } from 'node:fs/promises'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { annotationStats, readAnnotations } from './annotations.js'
import { readCards } from './cards.js'
import { readRelations, relationForPaper } from './relations.js'
import type { Config } from './config.js'
import { createPaper, readMeta, updateMeta } from './library.js'
import type { AutoTagFn } from './autotag.js'
import { appendToNotes, readNotes } from './notes.js'
import { ensureText, pageText } from './pdf.js'
import { listTags, queryPapers, searchLibrary } from './search.js'
import { deviceShort, effectiveSettings } from './settings.js'
import { listConflicts, listEvicted, syncStatus } from './sync.js'
import { sha256File } from './util.js'
import type { EffectiveSettings, NoteSection, PaperMeta, PaperStatus } from './types.js'

const MAX_TEXT_CHARS = 24_000
const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

type ToolResult = Record<string, unknown> & { ok: boolean; error?: string }

function failure(error: string): ToolResult {
  return { ok: false, error }
}

function textResult(text: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text }]
}

/** Exact canonical value as model-facing text (tools must return their data,
 * not just a human summary: the render output IS what the model reads). */
function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** Resolve the configured library or return a model-friendly failure. */
function libraryOrError(settings: EffectiveSettings): { root: string } | ToolResult {
  if (settings.libraryPath.length === 0) {
    return failure(
      'PaperDesk is not configured yet: no paper library directory is set. Ask the user to open the PaperDesk panel and choose a library directory.',
    )
  }
  return { root: settings.libraryPath }
}

function isToolFailure(value: { root: string } | ToolResult): value is ToolResult {
  return 'ok' in value
}

function badId(paperId: string): ToolResult | undefined {
  return PAPER_ID_RE.test(paperId) ? undefined : failure(`invalid paperId "${paperId}"`)
}

function authorList(authors: string): string[] {
  return authors
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Minimal shape of the Host tool registry this module needs. */
export interface ToolRegistryLike {
  register(definition: ToolDefinition): () => void
}

/**
 * Register the `paper_*` tools. Returns one disposer that unregisters them all,
 * so the caller can own the registration through a single `ctx.effect`.
 */
export function registerTools(tools: ToolRegistryLike, config: Config, autoTag?: AutoTagFn): () => void {
  const settings = (): EffectiveSettings => effectiveSettings(config)
  const disposers: (() => void)[] = []
  const add = (definition: ToolDefinition): void => {
    disposers.push(tools.register(definition))
  }

  add(
    defineTool({
      name: 'paper_list',
      description:
        'List papers in the user\'s local PaperDesk library, newest first. Use status/tag filters to narrow the result. Returns id, title, authors, year, status, tags and whether notes exist.',
      parameters: {
        status: {
          type: 'string',
          enum: ['unread', 'reading', 'read', 'archived', 'all'],
          description: 'Filter by reading status (default all).',
        },
        tag: { type: 'string', description: 'Filter by an exact tag.' },
        limit: { type: 'number', description: 'Maximum number of rows (default 50, max 200).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            count: { type: 'number' },
            tags: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
            papers: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {},
              },
            },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return textResult(`PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`)
          const rows = Array.isArray(value.papers) ? value.papers : []
          const lines = rows.map((row) => {
            const paper = row as Record<string, unknown>
            const authors = Array.isArray(paper.authors) ? (paper.authors as string[]).join(', ') : ''
            const tags = Array.isArray(paper.tags) && paper.tags.length > 0 ? ` #${(paper.tags as string[]).join(' #')}` : ''
            const year = paper.year === null || paper.year === undefined ? '' : ` (${String(paper.year)})`
            return `- ${String(paper.id)} · ${String(paper.title)}${year} · ${authors} · ${String(paper.status ?? '')}${paper.hasNotes === true ? ' · has notes' : ''}${tags}`
          })
          const tags = Array.isArray(value.tags)
            ? (value.tags as { tag?: unknown }[]).map((entry) => String(entry.tag ?? '')).filter((tag) => tag.length > 0)
            : []
          const header = `PaperDesk library: ${rows.length} paper(s)${tags.length > 0 ? `; tags: ${tags.join(', ')}` : ''}.`
          return textResult([header, ...lines].join('\n'))
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const current = settings()
        const library = libraryOrError(current)
        if (isToolFailure(library)) return library
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200)
        const papers = await queryPapers(library.root, {
          status: (args.status ?? 'all') as PaperStatus | 'all',
          tag: args.tag,
          limit,
        })
        return {
          ok: true,
          count: papers.length,
          tags: await listTags(library.root),
          papers: papers.map((paper) => ({
            id: paper.id,
            title: paper.title,
            authors: paper.authors,
            year: paper.year,
            status: paper.status,
            tags: paper.tags,
            hasNotes: paper.hasNotes,
            pageCount: paper.pageCount,
          })),
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_search',
      description:
        "Search the user's PaperDesk library across titles, authors, tags, abstracts, notes and extracted PDF text. Returns matching papers with the field that matched and a context snippet.",
      parameters: {
        query: { type: 'string', required: true, description: 'Words to search for.' },
        limit: { type: 'number', description: 'Maximum hits (default 10, max 30).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            count: { type: 'number' },
            hits: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return textResult(`PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`)
          const hits = Array.isArray(value.hits) ? value.hits : []
          const lines = hits.map((hit) => {
            const row = hit as Record<string, unknown>
            return `- ${String(row.paperId)} · ${String(row.title)} · ${String(row.field)} · ${String(row.snippet ?? '')}`
          })
          return textResult([`PaperDesk search: ${hits.length} hit(s).`, ...lines].join('\n'))
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 10), 1), 30)
        const hits = await searchLibrary(library.root, args.query, limit)
        return {
          ok: true,
          count: hits.length,
          hits: hits.map((hit) => ({
            paperId: hit.paper.id,
            title: hit.paper.title,
            authors: hit.paper.authors,
            year: hit.paper.year,
            field: hit.field,
            snippet: hit.snippet,
          })),
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_info',
      description:
        'Read one paper\'s metadata and note status from PaperDesk (title, authors, year, venue, DOI, abstract, tags, page count, whether notes exist). Use it before reading text.',
      parameters: { paperId: { type: 'string', required: true, description: 'Paper id from paper_list/paper_search.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            paper: { type: 'object', additionalProperties: true, properties: {} },
            notes: { type: 'object', additionalProperties: true, properties: {} },
            annotations: { type: 'object', additionalProperties: true, properties: {} },
            cards: { type: 'object', additionalProperties: true, properties: {} },
            relations: { type: 'object', additionalProperties: true, properties: {} },
          },
        },
        render: (_args, value) =>
          textResult(
            value.ok
              ? jsonText({ paper: value.paper, notes: value.notes, annotations: value.annotations, cards: value.cards, relations: value.relations })
              : `PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`,
          ),
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const invalid = badId(args.paperId)
        if (invalid !== undefined) return invalid
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const meta = await readMeta(library.root, args.paperId)
        if (meta === null) return failure(`paper not found: ${args.paperId}`)
        const notes = await readNotes(library.root, args.paperId)
        const annotations = await readAnnotations(library.root, args.paperId).catch(() => undefined)
        const cards = await readCards(library.root, args.paperId).catch(() => undefined)
        const relations = await readRelations(library.root).catch(() => undefined)
        const edgeCount =
          relations === undefined
            ? { outgoing: 0, incoming: 0 }
            : (() => {
                const { outgoing, incoming } = relationForPaper(relations, args.paperId)
                return { outgoing: outgoing.length, incoming: incoming.length }
              })()
        return {
          ok: true,
          annotations: annotations === undefined ? { total: 0, highlights: 0, notes: 0, questions: 0 } : annotationStats(annotations),
          cards: { total: cards === undefined ? 0 : cards.items.length },
          relations: edgeCount,
          paper: {
            id: meta.id,
            title: meta.title,
            authors: meta.authors,
            year: meta.year,
            venue: meta.venue,
            doi: meta.doi,
            url: meta.url,
            abstract: meta.abstract,
            keywords: meta.keywords,
            tags: meta.tags,
            status: meta.status,
            rating: meta.rating,
            pageCount: meta.pageCount,
            addedAt: meta.addedAt,
            updatedAt: meta.updatedAt,
          },
          notes: { exists: notes.exists, hash: notes.hash, characters: notes.markdown.length },
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_text',
      description:
        'Read extracted text of one PaperDesk paper, page by page. Extraction is cached; the first call may take a few seconds. Omit pages to get pages 1-3. Always read page 1 first, then request the pages you need.',
      parameters: {
        paperId: { type: 'string', required: true, description: 'Paper id.' },
        page: { type: 'number', description: 'Single page number to read (1-based).' },
        pages: { type: 'array', items: { type: 'number' }, description: 'Explicit page numbers to read.' },
        maxChars: { type: 'number', description: `Character budget (default ${MAX_TEXT_CHARS}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            pageCount: { type: 'number' },
            lowText: { type: 'boolean' },
            truncated: { type: 'boolean' },
            pages: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return textResult(`PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`)
          const pages = Array.isArray(value.pages) ? value.pages : []
          const blocks = pages.map((entry) => {
            const page = entry as Record<string, unknown>
            return `--- page ${String(page.page)} ---\n${String(page.text ?? '')}`
          })
          const meta = `PaperDesk text: ${pages.length} page(s) of ${String(value.pageCount ?? '?')}${value.lowText === true ? ' (little extractable text; likely a scanned PDF)' : ''}${value.truncated === true ? ' (truncated by maxChars)' : ''}.`
          return textResult([meta, ...blocks].join('\n\n'))
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const invalid = badId(args.paperId)
        if (invalid !== undefined) return invalid
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const meta = await readMeta(library.root, args.paperId)
        if (meta === null) return failure(`paper not found: ${args.paperId}`)
        if (meta.pdfFile === null) return failure('this paper has no PDF attached')
        const pdfAbs = `${library.root}/papers/${meta.id}/${meta.pdfFile}`
        const sha = meta.pdfSha256 ?? (await sha256File(pdfAbs).catch(() => ''))
        let extracted
        try {
          extracted = await ensureText(library.root, meta.id, { pdfAbs, sha })
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error))
        }
        const wanted: number[] =
          args.pages !== undefined && args.pages.length > 0
            ? args.pages.map((page) => Math.trunc(page))
            : args.page !== undefined
              ? [Math.trunc(args.page)]
              : [1, 2, 3]
        const budget = Math.min(Math.max(Math.trunc(args.maxChars ?? MAX_TEXT_CHARS), 500), MAX_TEXT_CHARS)
        const out: { page: number; text: string }[] = []
        let used = 0
        let truncated = false
        for (const page of wanted) {
          const text = pageText(extracted, page)
          if (text.length === 0) continue
          if (used + text.length > budget) {
            const remaining = budget - used
            if (remaining > 0) out.push({ page, text: text.slice(0, remaining) })
            truncated = true
            break
          }
          used += text.length
          out.push({ page, text })
        }
        return {
          ok: true,
          pageCount: extracted.pageCount,
          lowText: extracted.lowText,
          truncated,
          pages: out,
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_notes_read',
      description: "Read the user's markdown notes for one PaperDesk paper, including the notes hash you must pass back when appending.",
      parameters: { paperId: { type: 'string', required: true, description: 'Paper id.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            markdown: { type: 'string' },
            hash: { type: 'string' },
            exists: { type: 'boolean' },
          },
        },
        render: (_args, value) => textResult(value.ok ? String(value.markdown ?? '') : `PaperDesk unavailable: ${String(value.error ?? '')}`),
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const invalid = badId(args.paperId)
        if (invalid !== undefined) return invalid
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const notes = await readNotes(library.root, args.paperId)
        return { ok: true, markdown: notes.markdown, hash: notes.hash, exists: notes.exists }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_note_append',
      description:
        "Append a dated bullet to one PaperDesk paper's notes. Safe against cloud-sync conflicts (never overwrites concurrent edits). Use this to persist summaries and conclusions you produced.",
      parameters: {
        paperId: { type: 'string', required: true, description: 'Paper id.' },
        text: { type: 'string', required: true, description: 'Markdown text to append (one or more lines).' },
        section: {
          type: 'string',
          enum: ['summary', 'points', 'questions', 'quotes', 'thoughts', 'conversation'],
          description: 'Canonical notes section (default thoughts).',
        },
        page: { type: 'number', description: 'Optional page anchor for a quote.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            conflict: { type: 'boolean' },
            hash: { type: 'string' },
          },
        },
        render: (_args, value) =>
          textResult(
            value.ok
              ? `Note appended (notes hash now ${String(value.hash ?? '')}${value.conflict === true ? ', a conflicting concurrent edit was preserved as a copy' : ''}).`
              : `Note not written: ${String(value.error ?? 'unknown error')}`,
          ),
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const invalid = badId(args.paperId)
        if (invalid !== undefined) return invalid
        const current = settings()
        const library = libraryOrError(current)
        if (isToolFailure(library)) return library
        const section = args.section as NoteSection['keys'] | undefined
        const result = await appendToNotes(
          library.root,
          { paperId: args.paperId, text: args.text, section, page: args.page, by: 'agent' },
          { language: current.language, device: deviceShort() },
        )
        if (!result.ok) return failure(result.conflict ? 'a concurrent edit was detected; the note was kept as a conflict copy' : 'note write failed')
        return { ok: true, conflict: result.conflict, hash: result.notes.hash }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_add',
      description:
        'Import a PDF on the user\'s machine into the PaperDesk library. Provide the absolute path. Metadata is extracted automatically (and enriched through Crossref when the paper has a DOI).',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute path of the PDF file on the Host.' },
        title: { type: 'string', description: 'Override the detected title.' },
        authors: { type: 'string', description: 'Override authors, comma separated.' },
        year: { type: 'number', description: 'Override publication year.' },
        doi: { type: 'string', description: 'Provide a DOI when detection failed.' },
        tags: { type: 'string', description: 'Comma separated tags to attach.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            id: { type: 'string' },
            title: { type: 'string' },
            duplicated: { type: 'boolean' },
          },
        },
        render: (_args, value) =>
          textResult(
            value.ok
              ? `${value.duplicated === true ? 'Already in the library' : 'Imported'}: ${String(value.title ?? '')} (id ${String(value.id ?? '')}).`
              : `Import failed: ${String(value.error ?? 'unknown error')}`,
          ),
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const current = settings()
        const library = libraryOrError(current)
        if (isToolFailure(library)) return library
        const info = await stat(args.path).catch(() => undefined)
        if (info === undefined || !info.isFile()) return failure(`file not found: ${args.path}`)
        if (!args.path.toLowerCase().endsWith('.pdf')) return failure('only PDF files can be imported')
        const meta: Partial<PaperMeta> = {}
        if (args.title !== undefined) meta.title = args.title
        if (args.authors !== undefined) meta.authors = authorList(args.authors)
        if (args.year !== undefined) meta.year = Math.trunc(args.year)
        if (args.doi !== undefined) meta.doi = args.doi
        if (args.tags !== undefined) meta.tags = authorList(args.tags)
        try {
          const created = await createPaper(library.root, {
            sourcePath: args.path,
            source: 'agent',
            meta,
            enrich: current.enrich,
            autoTag,
            language: current.language,
            device: deviceShort(),
          })
          return { ok: true, id: created.id, title: created.meta.title, duplicated: created.duplicated }
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error))
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_update',
      description: 'Update metadata, tags, reading status or rating of one PaperDesk paper. Only the fields you pass change.',
      parameters: {
        paperId: { type: 'string', required: true, description: 'Paper id.' },
        title: { type: 'string' },
        authors: { type: 'string', description: 'Comma separated author list (replaces the stored list).' },
        year: { type: 'number' },
        venue: { type: 'string' },
        doi: { type: 'string' },
        url: { type: 'string' },
        abstract: { type: 'string' },
        tags: { type: 'string', description: 'Comma separated tags (replaces the stored list).' },
        status: { type: 'string', enum: ['unread', 'reading', 'read', 'archived'] },
        rating: { type: 'number', description: '0-5 stars.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            paper: { type: 'object', additionalProperties: true, properties: {} },
          },
        },
        render: (_args, value) =>
          textResult(value.ok ? `Updated.\n${jsonText(value.paper)}` : `Update failed: ${String(value.error ?? 'unknown error')}`),
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const invalid = badId(args.paperId)
        if (invalid !== undefined) return invalid
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const patch: Partial<PaperMeta> = {}
        if (args.title !== undefined) patch.title = args.title
        if (args.authors !== undefined) patch.authors = authorList(args.authors)
        if (args.year !== undefined) patch.year = Math.trunc(args.year)
        if (args.venue !== undefined) patch.venue = args.venue
        if (args.doi !== undefined) patch.doi = args.doi
        if (args.url !== undefined) patch.url = args.url
        if (args.abstract !== undefined) patch.abstract = args.abstract
        if (args.tags !== undefined) patch.tags = authorList(args.tags)
        if (args.status !== undefined) patch.status = args.status as PaperStatus
        if (args.rating !== undefined) patch.rating = Math.min(Math.max(Math.trunc(args.rating), 0), 5)
        try {
          const meta = await updateMeta(library.root, args.paperId, patch)
          return {
            ok: true,
            paper: {
              id: meta.id,
              title: meta.title,
              authors: meta.authors,
              year: meta.year,
              status: meta.status,
              tags: meta.tags,
              rating: meta.rating,
            },
          }
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error))
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_annotations',
      description:
        "Read the reader's PDF annotations for one PaperDesk paper: highlights, underlines, notes and questions with page numbers, the selected quote and the reader's comment. Use this to see what the user already marked or asked before explaining or summarizing.",
      parameters: {
        paperId: { type: 'string', required: true, description: 'Paper id.' },
        kind: {
          type: 'string',
          enum: ['highlight', 'underline', 'note', 'question'],
          description: 'Only return annotations of this kind.',
        },
        limit: { type: 'number', description: 'Maximum rows (default 100, max 500).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            count: { type: 'number' },
            stats: { type: 'object', additionalProperties: true, properties: {} },
            annotations: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return textResult(`PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`)
          const items = Array.isArray(value.annotations) ? value.annotations : []
          const lines = items.map((entry) => {
            const item = entry as Record<string, unknown>
            const comment = typeof item.comment === 'string' && item.comment.trim().length > 0 ? ` — 批注: ${item.comment}` : ''
            return `- p.${String(item.page)} [${String(item.kind)}] “${String(item.quote ?? '').slice(0, 300)}”${comment}`
          })
          return textResult([`PaperDesk annotations: ${items.length} item(s). ${jsonText(value.stats)}`, ...lines].join('\n'))
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const invalid = badId(args.paperId)
        if (invalid !== undefined) return invalid
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const doc = await readAnnotations(library.root, args.paperId)
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 100), 1), 500)
        const filtered =
          args.kind === undefined ? doc.items : doc.items.filter((item) => item.kind === args.kind)
        return {
          ok: true,
          count: filtered.length,
          stats: annotationStats(doc),
          annotations: filtered.slice(0, limit).map((item) => ({
            id: item.id,
            page: item.page,
            kind: item.kind,
            color: item.color,
            quote: item.quote,
            comment: item.comment,
            source: item.source,
            createdAt: item.createdAt,
          })),
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_cards',
      description:
        "Read the note cards the user distilled for one PaperDesk paper (cards are created from AI answers and shown in the notes tab). Each card has a title, Markdown body, tags and page references.",
      parameters: {
        paperId: { type: 'string', required: true, description: 'Paper id.' },
        limit: { type: 'number', description: 'Maximum cards (default 50, max 200).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            count: { type: 'number' },
            cards: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return textResult(`PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`)
          const cards = Array.isArray(value.cards) ? value.cards : []
          const blocks = cards.map((entry) => {
            const card = entry as Record<string, unknown>
            const pages = Array.isArray(card.pages) && card.pages.length > 0 ? ` · p.${(card.pages as number[]).join(', p.')}` : ''
            return `## ${String(card.title)}${pages}\n${String(card.body ?? '')}`
          })
          return textResult([`PaperDesk cards: ${cards.length} card(s).`, ...blocks].join('\n\n'))
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const invalid = badId(args.paperId)
        if (invalid !== undefined) return invalid
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const doc = await readCards(library.root, args.paperId)
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200)
        return {
          ok: true,
          count: doc.items.length,
          cards: doc.items.slice(0, limit).map((card) => ({
            id: card.id,
            title: card.title,
            body: card.body,
            tags: card.tags,
            pages: card.pages,
            createdAt: card.createdAt,
          })),
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_relations',
      description:
        'Read the paper relation graph (typed edges: cites / related / method / contrast / same-topic / custom). Pass paperId to see only that paper\'s incoming and outgoing edges.',
      parameters: {
        paperId: { type: 'string', description: 'Optional: only edges touching this paper.' },
        limit: { type: 'number', description: 'Maximum edges (default 100, max 500).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            count: { type: 'number' },
            relations: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          },
        },
        render: (_args, value) => {
          if (!value.ok) return textResult(`PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`)
          const relations = Array.isArray(value.relations) ? value.relations : []
          const lines = relations.map((entry) => {
            const relation = entry as Record<string, unknown>
            return `- [${String(relation.kind)}] ${String(relation.fromTitle ?? relation.from)} ↔ ${String(relation.toTitle ?? relation.to)}${relation.label ? ` (${String(relation.label)})` : ''}${relation.note ? ` — ${String(relation.note)}` : ''}`
          })
          return textResult([`PaperDesk relations: ${relations.length} edge(s).`, ...lines].join('\n'))
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const doc = await readRelations(library.root)
        const scoped =
          args.paperId === undefined
            ? doc.items
            : (() => {
                const { outgoing, incoming } = relationForPaper(doc, args.paperId)
                return [...outgoing, ...incoming]
              })()
        const limit = Math.min(Math.max(Math.trunc(args.limit ?? 100), 1), 500)
        const titles = new Map<string, string>()
        for (const relation of scoped.slice(0, limit)) {
          for (const paperId of [relation.from, relation.to]) {
            if (titles.has(paperId)) continue
            const meta = await readMeta(library.root, paperId).catch(() => null)
            titles.set(paperId, meta === null ? paperId : meta.title)
          }
        }
        return {
          ok: true,
          count: scoped.length,
          relations: scoped.slice(0, limit).map((relation) => ({
            id: relation.id,
            from: relation.from,
            to: relation.to,
            fromTitle: titles.get(relation.from) ?? relation.from,
            toTitle: titles.get(relation.to) ?? relation.to,
            kind: relation.kind,
            label: relation.label,
            note: relation.note,
            createdAt: relation.createdAt,
          })),
        }
      },
    }),
  )

  add(
    defineTool({
      name: 'paper_sync',
      description:
        'Report PaperDesk library sync health: cloud drive provider, files changed by other devices since the last scan, notes/meta conflict copies, and PDFs not downloaded locally (iCloud placeholders).',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            error: { type: 'string' },
            status: { type: 'object', additionalProperties: true, properties: {} },
          },
        },
        render: (_args, value) =>
          textResult(value.ok ? jsonText(value.status) : `PaperDesk unavailable: ${String(value.error ?? 'unknown error')}`),
      },
      async execute(_args, exec) {
        exec.signal.throwIfAborted()
        const library = libraryOrError(settings())
        if (isToolFailure(library)) return library
        const status = await syncStatus(library.root, deviceShort())
        return {
          ok: true,
          status: {
            cloud: status.cloud,
            trackedFiles: status.trackedFiles,
            pdfCount: status.pdfCount,
            delta: {
              added: status.delta.added.length,
              changed: status.delta.changed.length,
              removed: status.delta.removed.length,
            },
            conflicts: await listConflicts(library.root),
            evicted: await listEvicted(library.root),
            lastScanAt: status.lastScanAt,
            readOnly: status.readOnly,
          },
        }
      },
    }),
  )

  return () => {
    for (const dispose of disposers) dispose()
    disposers.length = 0
  }
}
