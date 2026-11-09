/**
 * Markdown notes for PaperDesk (DESIGN §2.2 / §3.7).
 *
 * `notes.md` is plain markdown without frontmatter, assembled from six canonical
 * sections whose headings depend on the configured language. All writes are
 * atomic and carry an optimistic-concurrency `baseHash`: a concurrent edit from
 * another device becomes a conflict copy instead of a lost update.
 */

import { readFile, rm } from 'node:fs/promises'
import type { Language } from './config.js'
import { deviceShort } from './settings.js'
import { writeConflictCopy } from './sync.js'
import type {
  NoteAppendInput,
  NoteSection,
  NotesDocument,
  NotesWriteResult,
  PaperMeta,
} from './types.js'
import { atomicWrite, fileInfo, posixJoin, safeJoin, sha256 } from './util.js'

const PAPERS_DIR = 'papers'
const NOTES_FILE = 'notes.md'
const PAPER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Canonical note sections with their localized level-2 headings. */
export const NOTE_SECTIONS: { keys: NoteSection['keys']; zh: string; en: string }[] = [
  { keys: 'summary', zh: '## 摘要', en: '## Summary' },
  { keys: 'points', zh: '## 要点', en: '## Key points' },
  { keys: 'questions', zh: '## 疑问', en: '## Open questions' },
  { keys: 'quotes', zh: '## 引用', en: '## Quotes' },
  { keys: 'thoughts', zh: '## 我的想法', en: '## My take' },
  { keys: 'conversation', zh: '## 对话与补充', en: '## Conversation notes' },
]

const DEFAULT_SECTION: NoteSection['keys'] = 'thoughts'

function assertPaperId(paperId: string): void {
  if (!PAPER_ID_RE.test(paperId)) throw new Error(`invalid paper id: ${paperId}`)
}

function notesRel(paperId: string): string {
  return posixJoin(PAPERS_DIR, paperId, NOTES_FILE)
}

/** Local `YYYY-MM-DD HH:mm` stamp used in appended blocks. */
function formatStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Strip trailing closing hashes so `## Summary ##` matches `## Summary`. */
function normalizeHeading(line: string): string {
  return line.trim().replace(/\s*#+\s*$/, '').trim()
}

function headingKeyOf(line: string): NoteSection['keys'] | null {
  const normalized = normalizeHeading(line)
  for (const section of NOTE_SECTIONS) {
    if (normalized === section.zh || normalized === section.en) return section.keys
  }
  return null
}

/** Any level-1/2 markdown heading ends a section body (best-effort). */
function isSectionBoundary(line: string): boolean {
  const trimmed = line.trim()
  if (!/^#{1,2}\s+\S/.test(trimmed)) return false
  return true
}

interface MarkdownScan {
  lines: string[]
  /** Canonical heading line indexes and their section keys. */
  headings: { index: number; key: NoteSection['keys'] }[]
}

function scanMarkdown(markdown: string): MarkdownScan {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const headings: { index: number; key: NoteSection['keys'] }[] = []
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const key = headingKeyOf(trimmed)
    if (key !== null) headings.push({ index, key })
  }
  return { lines, headings }
}

/** Title heading used by {@link initialNotesMarkdown}. */
function titleHeading(meta: Pick<PaperMeta, 'title' | 'authors' | 'year'>, language: Language): string {
  const title = meta.title.trim() || meta.authors[0]?.trim() || 'Untitled'
  return language === 'zh' ? `# 笔记：${title}` : `# Notes: ${title}`
}

/** Fresh notes document: localized title plus empty canonical sections. */
export function initialNotesMarkdown(
  meta: Pick<PaperMeta, 'title' | 'authors' | 'year'>,
  language: Language,
): string {
  const lines = [titleHeading(meta, language), '']
  for (const section of NOTE_SECTIONS) {
    lines.push(language === 'zh' ? section.zh : section.en, '')
  }
  return lines.join('\n')
}

/** Current notes document; a missing or unreadable file yields an empty doc. */
export async function readNotes(root: string, paperId: string): Promise<NotesDocument> {
  assertPaperId(paperId)
  const absPath = safeJoin(root, notesRel(paperId))
  const info = await fileInfo(absPath)
  let markdown = ''
  let exists = false
  if (info !== null) {
    try {
      markdown = await readFile(absPath, 'utf8')
      exists = true
    } catch {
      // Unreadable (permissions, sync placeholder): report as absent.
      return { markdown: '', hash: '', mtimeMs: 0, exists: false }
    }
  }
  if (!exists) return { markdown: '', hash: '', mtimeMs: 0, exists: false }
  return { markdown, hash: sha256(markdown), mtimeMs: info?.mtimeMs ?? 0, exists: true }
}

/**
 * Write notes with optimistic concurrency.
 *
 * - no `baseHash` ⇒ explicit overwrite;
 * - matching `baseHash` ⇒ write;
 * - stale `baseHash` ⇒ keep the incoming content as a conflict copy (never
 *   overwrite) and report `{ ok: false, conflict: true, conflictPath }`.
 */
export async function writeNotes(
  root: string,
  paperId: string,
  markdown: string,
  opts?: { baseHash?: string; device?: string },
): Promise<NotesWriteResult> {
  assertPaperId(paperId)
  const current = await readNotes(root, paperId)
  if (current.exists && current.markdown === markdown) {
    return { ok: true, conflict: false, notes: current }
  }

  if (opts?.baseHash !== undefined && opts.baseHash !== current.hash) {
    const device = opts.device ?? deviceShort()
    const conflictPath = await writeConflictCopy(
      root,
      paperId,
      notesRel(paperId),
      markdown,
      device,
    )
    return { ok: false, conflict: true, conflictPath, notes: current }
  }

  const absPath = safeJoin(root, notesRel(paperId))
  await atomicWrite(absPath, markdown)
  const info = await fileInfo(absPath)
  return {
    ok: true,
    conflict: false,
    notes: {
      markdown,
      hash: sha256(markdown),
      mtimeMs: info?.mtimeMs ?? 0,
      exists: true,
    },
  }
}

/** Build one appended markdown block (+ heading when the section is new). */
function appendedBlock(input: NoteAppendInput): string[] {
  const by = input.by ?? 'agent'
  const stamp = formatStamp()
  const text = (input.text ?? '').replace(/\r\n?/g, '\n').trim()
  if (text.length === 0) throw new Error('note text must not be empty')

  if (input.page !== undefined && input.page !== null && Number.isFinite(input.page)) {
    const page = Math.trunc(input.page)
    if (page > 0) {
      const flat = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' ')
      return [`> p.${page} "${flat.replace(/"/g, "'")}"`, `- ${stamp} · ${by}`]
    }
  }

  // Keep the appended Markdown block-level (no per-line 2-space indent):
  // indenting every line made fenced/list content render as a code block in
  // the notes preview.
  return [`- ${stamp} · ${by}`, '', ...text.split('\n')]
}

/** Insert the block into the matching canonical section of `markdown`. */
function buildAppendedMarkdown(
  markdown: string,
  input: NoteAppendInput,
  language: Language,
): string {
  const requested = input.section !== undefined ? input.section : DEFAULT_SECTION
  const target = NOTE_SECTIONS.find((section) => section.keys === requested) ?? NOTE_SECTIONS[0]!
  const block = appendedBlock(input)

  const { lines, headings } = scanMarkdown(markdown)
  const wantedHeading = language === 'zh' ? target.zh : target.en
  const fallbackHeading = language === 'zh' ? target.en : target.zh
  const wanted = normalizeHeading(wantedHeading)
  const fallback = normalizeHeading(fallbackHeading)

  let targetIndex = lines.findIndex((line) => normalizeHeading(line) === wanted)
  if (targetIndex < 0) targetIndex = lines.findIndex((line) => normalizeHeading(line) === fallback)

  if (targetIndex >= 0) {
    // Insert at the end of the section: before the next heading, trailing blanks aside.
    let nextBoundary = lines.length
    let inFence = false
    for (let index = targetIndex + 1; index < lines.length; index += 1) {
      const trimmed = (lines[index] ?? '').trim()
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) inFence = !inFence
      if (!inFence && isSectionBoundary(trimmed)) {
        nextBoundary = index
        break
      }
    }
    let insertAt = nextBoundary
    while (insertAt > targetIndex + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt -= 1
    const prefix = lines.slice(0, insertAt).join('\n').replace(/\s+$/, '')
    const suffix = lines.slice(insertAt).join('\n').replace(/^\s+/, '')
    return joinBlocks([prefix, block.join('\n'), suffix])
  }

  // Section missing: create it before the next canonical section, else at the end.
  const targetOrder = NOTE_SECTIONS.indexOf(target)
  let insertIndex = -1
  for (const heading of headings) {
    const order = NOTE_SECTIONS.findIndex((section) => section.keys === heading.key)
    if (order > targetOrder) {
      insertIndex = heading.index
      break
    }
  }
  const sectionBlock = `${wantedHeading}\n\n${block.join('\n')}`
  const prefix = (insertIndex >= 0 ? lines.slice(0, insertIndex) : lines).join('\n').replace(/\s+$/, '')
  const suffix = insertIndex >= 0 ? lines.slice(insertIndex).join('\n').replace(/^\s+/, '') : ''
  return joinBlocks([prefix, sectionBlock, suffix])
}

function joinBlocks(parts: string[]): string {
  const body = parts.filter((part) => part.length > 0).join('\n\n')
  return body.length > 0 ? `${body}\n` : '\n'
}

/**
 * Append a dated block under the canonical section heading, creating the
 * section when it does not exist yet. Additive, so a one-shot retry after a
 * concurrent edit is safe.
 */
export async function appendToNotes(
  root: string,
  input: NoteAppendInput,
  opts?: { language?: Language; device?: string },
): Promise<NotesWriteResult> {
  assertPaperId(input.paperId)
  const language: Language = opts?.language ?? 'zh'
  const device = opts?.device ?? deviceShort()

  // Conflict copies written by a retried attempt are redundant once the
  // additive append lands; drop them so the sync panel shows no phantom conflicts.
  const transientConflicts: string[] = []
  let result: NotesWriteResult | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readNotes(root, input.paperId)
    const next = buildAppendedMarkdown(current.markdown, input, language)
    result = await writeNotes(root, input.paperId, next, { baseHash: current.hash, device })
    if (!result.conflict) {
      for (const relPath of transientConflicts) {
        await rm(safeJoin(root, relPath), { force: true }).catch(() => {})
      }
      return result
    }
    if (result.conflictPath !== undefined) transientConflicts.push(result.conflictPath)
  }
  return result!
}

/** First meaningful line for the library list; never throws on malformed markdown. */
export function extractNotePreview(markdown: string, cap = 160): string {
  if (!markdown.trim() || cap <= 0) return ''
  const sections = noteSections(markdown)
  const fromSummary = firstMeaningfulLine(sections['summary'] ?? '')
  const candidate = fromSummary || firstMeaningfulLine(stripTitle(markdown))
  if (!candidate) return ''
  const collapsed = candidate.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= cap) return collapsed
  return `${collapsed.slice(0, Math.max(0, cap - 1)).trimEnd()}…`
}

function stripTitle(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^#\s+/.test(line.trim()))
    .join('\n')
}

function firstMeaningfulLine(text: string): string {
  let inFence = false
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (isSectionBoundary(trimmed)) continue
    // Skip the dated metadata bullet of an appended block (show its content instead).
    if (/^-\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*·/.test(trimmed)) continue
    const cleaned = trimmed
      .replace(/^[-*+]\s+/, '')
      .replace(/^>\s+/, '')
      .replace(/^p\.\d+\s*/, '')
      .trim()
    if (cleaned) return cleaned
  }
  return ''
}

/** Best-effort parse of the canonical sections: key ⇒ section body. */
export function noteSections(markdown: string): Record<string, string> {
  const { lines, headings } = scanMarkdown(markdown)
  const out: Record<string, string> = {}
  for (const heading of headings) {
    let end = lines.length
    for (const candidate of headings) {
      if (candidate.index > heading.index) {
        end = candidate.index
        break
      }
    }
    // Stop at any other level-1/2 heading as well, so accidental headings do
    // not leak content into a canonical section.
    let inFence = false
    for (let index = heading.index + 1; index < end; index += 1) {
      const trimmed = (lines[index] ?? '').trim()
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) inFence = !inFence
      if (!inFence && isSectionBoundary(trimmed)) {
        end = index
        break
      }
    }
    const body = lines
      .slice(heading.index + 1, end)
      .join('\n')
      .trim()
    if (out[heading.key] === undefined) out[heading.key] = body
  }
  return out
}

/** Cheap existence/size probe for the notes file. */
export async function notesDisposition(
  root: string,
  paperId: string,
): Promise<{ exists: boolean; size: number }> {
  assertPaperId(paperId)
  const info = await fileInfo(safeJoin(root, notesRel(paperId)))
  return { exists: info !== null, size: info?.size ?? 0 }
}
