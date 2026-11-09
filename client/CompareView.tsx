/**
 * Multi-paper comparison overlay (DESIGN-FEATURES.md §2 / §6.3).
 *
 * Self-contained container: owns its data fetching (papers, saved comparisons,
 * AI comparison thread), its zh/en dictionary fragment (`compareDict`, selected
 * through the `lang` prop) and its stylesheet fragment (`compareCss`, prefix
 * `pd-cmp-`, host tokens only; appended to `styles.ts`). This file is the single
 * source for the comparison feature.
 *
 * Flow:
 *   1. picker — search + ordered checkbox selection of 2..6 papers
 *      (`initialPaperIds` preselected),
 *   2. workspace — instant metadata matrix + AI report streamed through a
 *      dedicated `compare:<sorted ids>` AI thread, save into `/comparisons`,
 *      reopen saved reports read-only, and accept suggested relations from the
 *      report tail (`- [kind] A ↔ B: reason`) into the relation graph.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ComparisonSummary,
  PaperComparison,
  PaperStatus,
  PaperSummary,
  RelationKind,
} from '../src/types.js'
import { api } from './api.js'
import { createAiThread } from './aiSession.js'
import type { AiRow } from './aiSession.js'
import { Markdown } from './markdown.js'
import { Button, Chip, Spinner, Tabs, TextInput } from './ui.js'

export type Lang = 'zh' | 'en'

export interface CompareViewProps {
  open: boolean
  ctx: ClientContext
  lang: Lang
  initialPaperIds?: readonly string[]
  onClose: () => void
  onOpenPaper: (paperId: string) => void
}

/* ── constants ─────────────────────────────────────────────────────────── */

const MIN_PAPERS = 2
const MAX_PAPERS = 6
const MAX_TITLE = 200
const MAX_SUGGESTIONS = 12

type Step = 'pick' | 'work'
type TabId = 'report' | 'saved' | 'suggestions'
type NoticeKind = 'success' | 'error' | 'info'

interface Notice {
  kind: NoticeKind
  text: string
}

interface RelationSuggestion {
  key: string
  kind: RelationKind | null
  rawKind: string
  fromName: string
  toName: string
  fromId: string | null
  toId: string | null
  reason: string
}

interface SuggestionUi {
  busy: boolean
  added: boolean
  error: string | null
}

/* ── small helpers (locale-agnostic) ───────────────────────────────────── */

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  return ''
}

function formatTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match: string, key: string) => {
    const value = vars[key]
    return value === undefined ? match : String(value)
  })
}

function shortTitle(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, Math.max(1, max - 1))}…`
}

function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')
  return line === undefined ? '' : shortTitle(line, 90)
}

function formatDate(iso: string, lang: Lang): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date)
  } catch {
    return ''
  }
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*|__|`/g, '')
    .replace(/^[《<"'“”'「『【[]+/g, '')
    .replace(/[》>"'“”'」』】\]]+$/g, '')
    .trim()
}

function normalizeName(value: string): string {
  return value
    .replace(/\*\*|__|`/g, '')
    .replace(/[《》<>「」『』【】[\]()（）"'“”'‘’«»]/g, ' ')
    .replace(/[.,;:!?，。；：！？、·•—–~～…/\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 1))
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, '')
  const set = new Set<string>()
  for (let index = 0; index + 1 < compact.length; index += 1) {
    set.add(compact.slice(index, index + 2))
  }
  return set
}

function surnameOf(author: string): string {
  const cleaned = author
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return ''
  const comma = cleaned.indexOf(',')
  if (comma > 0) return cleaned.slice(0, comma).trim()
  const parts = cleaned.split(' ')
  return parts[parts.length - 1] ?? cleaned
}

const TITLE_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'with',
  'on',
  'in',
  'to',
  'is',
  'are',
  'via',
  'using',
  'towards',
])

/** First meaningful word of a title, used for "Attention (2017)" style names. */
function titleNickname(title: string): string {
  const words = title
    .replace(/[^A-Za-z0-9\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TITLE_STOPWORDS.has(word.toLowerCase()))
  return words[0] ?? ''
}

/** Normalized names a report might use for one paper (title, author+year, id). */
function aliasesOf(paper: PaperSummary): string[] {
  const values: string[] = [paper.title, paper.id]
  const firstAuthor = paper.authors[0]
  if (firstAuthor !== undefined) {
    values.push(firstAuthor)
    const surname = surnameOf(firstAuthor)
    if (surname !== '') {
      values.push(surname)
      if (paper.year !== null) {
        values.push(`${firstAuthor} ${paper.year}`)
        values.push(`${surname} ${paper.year}`)
        values.push(`${surname} et al ${paper.year}`)
      }
    }
  }
  if (paper.year !== null) {
    const nickname = titleNickname(paper.title)
    if (nickname !== '') values.push(`${nickname} ${paper.year}`)
  }
  const aliases: string[] = []
  for (const value of values) {
    const normalized = normalizeName(value)
    if (normalized !== '' && !aliases.includes(normalized)) aliases.push(normalized)
  }
  return aliases
}

function nameScore(rawName: string, alias: string): number {
  const query = normalizeName(rawName)
  if (query === '' || alias === '') return 0
  if (query === alias) return 1
  const shorter = Math.min(query.length, alias.length)
  const longer = Math.max(query.length, alias.length)
  const ratio = longer === 0 ? 0 : shorter / longer
  if (query.length >= 3 && alias.startsWith(query)) return 0.74 + 0.24 * ratio
  if (alias.length >= 3 && query.startsWith(alias)) return 0.7 + 0.24 * ratio
  if (query.length >= 6 && alias.includes(query)) return 0.64 + 0.2 * ratio
  if (alias.length >= 6 && query.includes(alias)) return 0.62 + 0.2 * ratio

  const left = tokenSet(query)
  const right = tokenSet(alias)
  if (left.size > 0 && right.size > 0) {
    let shared = 0
    for (const token of left) if (right.has(token)) shared += 1
    if (shared > 0) {
      const overlap = Math.min(shared / right.size, shared / left.size)
      if (overlap >= 0.6) return 0.6 + 0.25 * overlap
    }
  }

  if (/[\u3400-\u9fff]/.test(query) || /[\u3400-\u9fff]/.test(alias)) {
    const a = bigrams(query)
    const b = bigrams(alias)
    if (a.size > 0 && b.size > 0) {
      let shared = 0
      for (const gram of a) if (b.has(gram)) shared += 1
      const overlap = shared / Math.max(a.size, b.size)
      if (overlap >= 0.55) return 0.6 + 0.3 * overlap
    }
  }
  return 0
}

/**
 * Fuzzy title → paper resolution. Reports reference papers by full title,
 * truncated title, first-author + year (per `comparePrompt`) or by number.
 * Returns the best candidate, or null when ambiguous / not confident enough.
 */
function resolvePaperName(
  rawName: string,
  papers: readonly PaperSummary[],
  selectedIds: readonly string[],
): { paper: PaperSummary; score: number } | null {
  const cleaned = stripMarkdown(rawName).replace(/^\s*(?:论文|paper)\s*/i, '').trim()
  if (cleaned === '') return null

  const numeric = cleaned.match(/^#?\s*(\d{1,2})$/)
  if (numeric !== null) {
    const index = Number.parseInt(numeric[1] ?? '', 10) - 1
    const id = selectedIds[index]
    if (id !== undefined) {
      const found = papers.find((paper) => paper.id === id)
      if (found !== undefined) return { paper: found, score: 0.99 }
    }
  }

  let best: { paper: PaperSummary; score: number } | null = null
  let second = 0
  for (const paper of papers) {
    let score = 0
    for (const alias of aliasesOf(paper)) {
      const candidate = nameScore(cleaned, alias)
      if (candidate > score) score = candidate
    }
    if (best === null || score > best.score) {
      second = best === null ? 0 : best.score
      best = { paper, score }
    } else if (score > second) {
      second = score
    }
  }
  if (best === null || best.score < 0.58) return null
  if (best.score < 0.95 && second >= best.score - 0.02) return null
  return best
}

const RELATION_KIND_ALIASES: Readonly<Record<string, RelationKind>> = {
  cites: 'cites',
  cite: 'cites',
  citation: 'cites',
  'cites-relation': 'cites',
  引用: 'cites',
  引用关系: 'cites',
  被引: 'cites',
  被引用: 'cites',
  related: 'related',
  'related-work': 'related',
  relatedwork: 'related',
  相关: 'related',
  相关工作: 'related',
  关联: 'related',
  method: 'method',
  methods: 'method',
  方法: 'method',
  方法相关: 'method',
  方法关系: 'method',
  contrast: 'contrast',
  contrasting: 'contrast',
  对比: 'contrast',
  对比关系: 'contrast',
  差异: 'contrast',
  相反: 'contrast',
  'same-topic': 'same-topic',
  same: 'same-topic',
  同主题: 'same-topic',
  同一主题: 'same-topic',
  相同主题: 'same-topic',
  custom: 'custom',
  自定义: 'custom',
  其他: 'custom',
}

function relationKindOf(raw: string): RelationKind | null {
  const cleaned = stripMarkdown(raw).trim().toLowerCase()
  if (cleaned === '') return null
  const variants = [
    cleaned,
    cleaned.replace(/\s+/g, ' '),
    cleaned.replace(/[\s_]+/g, '-'),
    cleaned.replace(/^关系类型[:：]?/, '').replace(/关系$/, ''),
  ]
  for (const variant of variants) {
    const found = RELATION_KIND_ALIASES[variant]
    if (found !== undefined) return found
  }
  return null
}

/**
 * Parse the report tail for relation suggestions:
 * `- [cites] Paper A ↔ Paper B: reason` (English kinds or Chinese labels).
 * Titles are resolved fuzzily against every loaded paper; unresolved pairs are
 * kept so the card can explain why it cannot be added.
 */
function parseSuggestions(
  markdown: string,
  papers: readonly PaperSummary[],
  selectedIds: readonly string[],
): RelationSuggestion[] {
  const suggestions: RelationSuggestion[] = []
  const seen = new Set<string>()
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim()
    if (!/^[-*+]\s*\[/.test(line)) continue
    const head = line.match(/^[-*+]\s*\[([^\]]+)\]\s*(.+)$/)
    if (head === null) continue
    const rawKind = stripMarkdown(head[1] ?? '').trim()
    if (rawKind === '') continue
    const rest = (head[2] ?? '').trim()
    const arrow = rest.match(/\s*(?:↔\uFE0F?|<->|⇄|⇆)\s*/)
    if (arrow === null) continue
    const arrowIndex = arrow.index
    if (arrowIndex === undefined) continue
    const arrowText = arrow[0] ?? '↔'
    const left = rest.slice(0, arrowIndex).trim()
    const right = rest.slice(arrowIndex + arrowText.length).trim()
    if (left === '' || right === '') continue

    let toRaw = right
    let reason = ''
    const colonIndexes: number[] = []
    for (let index = 0; index < right.length; index += 1) {
      const char = right[index]
      if (char === ':' || char === '：') colonIndexes.push(index)
    }
    if (colonIndexes.length > 0) {
      // A colon inside paper B's title is possible, so pick the first split
      // whose left side actually resolves to a paper; otherwise use the last.
      let splitAt = -1
      for (const index of colonIndexes) {
        const candidate = right.slice(0, index).trim()
        if (candidate === '') continue
        if (resolvePaperName(candidate, papers, selectedIds) !== null) {
          splitAt = index
          break
        }
      }
      if (splitAt < 0) {
        const last = colonIndexes[colonIndexes.length - 1]
        splitAt = last === undefined ? -1 : last
      }
      if (splitAt >= 0) {
        toRaw = right.slice(0, splitAt).trim()
        reason = right.slice(splitAt + 1).trim()
      }
    }

    const fromName = stripMarkdown(left)
    const toName = stripMarkdown(toRaw)
    if (fromName === '' || toName === '') continue
    const from = resolvePaperName(fromName, papers, selectedIds)
    const to = resolvePaperName(toName, papers, selectedIds)
    const fromId = from === null ? null : from.paper.id
    const toId = to === null ? null : to.paper.id
    if (fromId !== null && toId !== null && fromId === toId) continue
    const kind = relationKindOf(rawKind)
    const key = [
      kind === null ? rawKind.toLowerCase() : kind,
      fromId ?? normalizeName(fromName),
      toId ?? normalizeName(toName),
      reason.slice(0, 80),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    suggestions.push({ key, kind, rawKind, fromName, toName, fromId, toId, reason })
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }
  return suggestions
}

const STATUS_KEY: Readonly<Record<PaperStatus, string>> = {
  unread: 'compare.status.unread',
  reading: 'compare.status.reading',
  read: 'compare.status.read',
  archived: 'compare.status.archived',
}

/* ── dictionary fragment (zh authoritative, en typed for parity) ───────── */

const zhStrings: Record<string, string> = {
  'compare.title': '论文对比',
  'compare.close': '关闭',
  'compare.back': '重新选择',
  'compare.loading': '正在加载…',
  'compare.loadFailed': '加载论文列表失败',
  'compare.loadSavedFailed': '加载已保存对比失败',
  'compare.retry': '重试',
  'compare.searchPlaceholder': '搜索标题、作者、标签、期刊…',
  'compare.searchLabel': '搜索论文',
  'compare.count': '已选 {selected} / {max} 篇',
  'compare.countHint': '至少选择 {min} 篇，最多 {max} 篇',
  'compare.pickHint': '选择 2–6 篇论文，先看元数据对比，再生成 AI 报告',
  'compare.workHint': '已选 {n} 篇论文 · 元数据即时对比，AI 报告可保存',
  'compare.papersEmpty': '论文库还是空的',
  'compare.papersEmptyHint': '先在论文库导入 PDF，再回来做多篇对比。',
  'compare.noMatch': '没有匹配的论文',
  'compare.noMatchHint': '换个关键词试试。',
  'compare.start': '开始对比',
  'compare.remove': '移除',
  'compare.unknownAuthor': '未知作者',
  'compare.unknownPaper': '已删除的论文',
  'compare.defaultTitle': '论文对比',
  'compare.titleJoin': ' vs ',
  'compare.threadPrefix': '对比',
  'compare.status.unread': '未读',
  'compare.status.reading': '在读',
  'compare.status.read': '已读',
  'compare.status.archived': '归档',
  'compare.matrixTitle': '元数据对比',
  'compare.matrixHint': '直接读取论文元数据，无需 AI',
  'compare.matrixCaption': '所选论文的元数据对比表',
  'compare.col.title': '标题',
  'compare.col.authors': '作者',
  'compare.col.year': '年份',
  'compare.col.venue': '期刊',
  'compare.col.status': '状态',
  'compare.col.tags': '标签',
  'compare.col.pages': '页数',
  'compare.col.doi': 'DOI',
  'compare.openPaper': '打开论文',
  'compare.reportTitle': 'AI 对比报告',
  'compare.reportEmpty': '还没有对比报告',
  'compare.reportEmptyHint': '用上方「生成 AI 对比」创建报告，或到「已保存对比」里打开一份。',
  'compare.generate': '生成 AI 对比',
  'compare.regenerate': '重新生成',
  'compare.stop': '停止',
  'compare.attaching': '正在连接 AI 会话…',
  'compare.thinking': '正在对比论文…',
  'compare.reasoning': '思考过程',
  'compare.threadError': 'AI 会话出错',
  'compare.save': '保存对比',
  'compare.saving': '正在保存…',
  'compare.saveTitle': '对比标题',
  'compare.saveConfirm': '保存',
  'compare.saveCancel': '取消',
  'compare.saveSuccess': '已保存这份对比',
  'compare.noAnswer': '还没有可保存的报告，先生成 AI 对比',
  'compare.saveFailed': '保存失败',
  'compare.tabs.report': '对比结果',
  'compare.tabs.saved': '已保存对比',
  'compare.tabs.suggestions': '关系建议',
  'compare.savedEmpty': '还没有保存的对比',
  'compare.savedEmptyHint': '生成报告后点击「保存对比」，就会出现在这里。',
  'compare.savedSelect': '从左侧选择一份已保存的对比',
  'compare.savedLoading': '正在打开…',
  'compare.savedRegenerate': '用这些论文重新生成',
  'compare.savedDelete': '删除',
  'compare.savedDeleteConfirm': '确认删除',
  'compare.savedDeleteCancel': '取消删除',
  'compare.savedDeleteHint': '删除后无法恢复。',
  'compare.savedDeleted': '已删除这份对比',
  'compare.savedReadOnly': '只读',
  'compare.savedAt': '保存于 {date}',
  'compare.savedPapers': '{n} 篇论文',
  'compare.deleting': '正在删除…',
  'compare.deleteFailed': '删除失败',
  'compare.suggestionsEmpty': '还没有关系建议',
  'compare.suggestionsEmptyHint':
    '生成 AI 对比后，报告末尾的 `- [类型] 论文A ↔ 论文B：理由` 会显示在这里，可一键加入图谱。',
  'compare.suggestionUnmatched': '无法从标题匹配到论文，暂不能加入图谱',
  'compare.suggestionUnknownKind': '无法识别这个关系类型，暂不能加入图谱',
  'compare.addGraph': '加入图谱',
  'compare.addingGraph': '正在加入…',
  'compare.addedGraph': '已加入图谱',
  'compare.addedGraphNotice': '已加入关系图谱',
  'compare.kind.cites': '引用',
  'compare.kind.related': '相关',
  'compare.kind.method': '方法',
  'compare.kind.contrast': '对比',
  'compare.kind.same-topic': '同主题',
  'compare.kind.custom': '自定义',
  'compare.noWorkspace': '论文库路径不可用，无法启动 AI 会话',
  'compare.unknownError': '操作失败，请重试',
  'compare.selectionChanged': '选择已变更：这份报告仍对应上次的 {n} 篇论文',
  'compare.jumpLatest': '跳到最新',
  'compare.regenerateMissing': '这次对比涉及的论文已不在论文库中',
}

const enStrings: Record<keyof typeof zhStrings, string> = {
  'compare.title': 'Compare papers',
  'compare.close': 'Close',
  'compare.back': 'Change papers',
  'compare.loading': 'Loading…',
  'compare.loadFailed': 'Could not load the paper list',
  'compare.loadSavedFailed': 'Could not load saved comparisons',
  'compare.retry': 'Retry',
  'compare.searchPlaceholder': 'Search title, authors, tags, venue…',
  'compare.searchLabel': 'Search papers',
  'compare.count': '{selected} / {max} selected',
  'compare.countHint': 'Pick at least {min} and at most {max} papers',
  'compare.pickHint': 'Pick 2–6 papers: compare metadata, then generate an AI report',
  'compare.workHint': '{n} papers selected · metadata is instant, the AI report can be saved',
  'compare.papersEmpty': 'The library is empty',
  'compare.papersEmptyHint': 'Import some PDFs into the library first, then come back to compare them.',
  'compare.noMatch': 'No matching papers',
  'compare.noMatchHint': 'Try a different keyword.',
  'compare.start': 'Start comparison',
  'compare.remove': 'Remove',
  'compare.unknownAuthor': 'Unknown author',
  'compare.unknownPaper': 'Deleted paper',
  'compare.defaultTitle': 'Paper comparison',
  'compare.titleJoin': ' vs ',
  'compare.threadPrefix': 'Compare',
  'compare.status.unread': 'Unread',
  'compare.status.reading': 'Reading',
  'compare.status.read': 'Read',
  'compare.status.archived': 'Archived',
  'compare.matrixTitle': 'Metadata comparison',
  'compare.matrixHint': 'Read straight from paper metadata — no AI needed',
  'compare.matrixCaption': 'Metadata comparison table for the selected papers',
  'compare.col.title': 'Title',
  'compare.col.authors': 'Authors',
  'compare.col.year': 'Year',
  'compare.col.venue': 'Venue',
  'compare.col.status': 'Status',
  'compare.col.tags': 'Tags',
  'compare.col.pages': 'Pages',
  'compare.col.doi': 'DOI',
  'compare.openPaper': 'Open paper',
  'compare.reportTitle': 'AI comparison report',
  'compare.reportEmpty': 'No report yet',
  'compare.reportEmptyHint': 'Generate an AI comparison above, or open one from “Saved comparisons”.',
  'compare.generate': 'Generate AI comparison',
  'compare.regenerate': 'Regenerate',
  'compare.stop': 'Stop',
  'compare.attaching': 'Connecting to the AI session…',
  'compare.thinking': 'Comparing the papers…',
  'compare.reasoning': 'Reasoning',
  'compare.threadError': 'The AI session failed',
  'compare.save': 'Save comparison',
  'compare.saving': 'Saving…',
  'compare.saveTitle': 'Comparison title',
  'compare.saveConfirm': 'Save',
  'compare.saveCancel': 'Cancel',
  'compare.saveSuccess': 'Comparison saved',
  'compare.noAnswer': 'Nothing to save yet — generate an AI comparison first',
  'compare.saveFailed': 'Could not save the comparison',
  'compare.tabs.report': 'Result',
  'compare.tabs.saved': 'Saved',
  'compare.tabs.suggestions': 'Suggestions',
  'compare.savedEmpty': 'No saved comparisons yet',
  'compare.savedEmptyHint': 'Generate a report and click “Save comparison” to keep it here.',
  'compare.savedSelect': 'Pick a saved comparison on the left',
  'compare.savedLoading': 'Opening…',
  'compare.savedRegenerate': 'Regenerate with these papers',
  'compare.savedDelete': 'Delete',
  'compare.savedDeleteConfirm': 'Confirm delete',
  'compare.savedDeleteCancel': 'Cancel delete',
  'compare.savedDeleteHint': 'Deleting cannot be undone.',
  'compare.savedDeleted': 'Comparison deleted',
  'compare.savedReadOnly': 'Read-only',
  'compare.savedAt': 'Saved on {date}',
  'compare.savedPapers': '{n} papers',
  'compare.deleting': 'Deleting…',
  'compare.deleteFailed': 'Could not delete the comparison',
  'compare.suggestionsEmpty': 'No relation suggestions yet',
  'compare.suggestionsEmptyHint':
    'After generating a report, lines like `- [kind] Paper A ↔ Paper B: reason` appear here and can be added to the graph with one click.',
  'compare.suggestionUnmatched': 'Could not match these names to papers, so the relation is disabled',
  'compare.suggestionUnknownKind': 'This relation kind is not recognised, so the relation is disabled',
  'compare.addGraph': 'Add to graph',
  'compare.addingGraph': 'Adding…',
  'compare.addedGraph': 'Added to graph',
  'compare.addedGraphNotice': 'Added to the relation graph',
  'compare.kind.cites': 'cites',
  'compare.kind.related': 'related',
  'compare.kind.method': 'method',
  'compare.kind.contrast': 'contrast',
  'compare.kind.same-topic': 'same topic',
  'compare.kind.custom': 'custom',
  'compare.noWorkspace': 'The library path is unavailable, so the AI session cannot start',
  'compare.unknownError': 'Something went wrong, please try again',
  'compare.selectionChanged': 'Selection changed: this report still covers the previous {n} papers',
  'compare.jumpLatest': 'Jump to latest',
  'compare.regenerateMissing': 'The papers of this comparison are no longer in the library',
}

export const compareDict: Record<Lang, Record<string, string>> = {
  zh: zhStrings,
  en: enStrings,
}

/* ── stylesheet fragment ───────────────────────────────────────────────── */

const CMP_FG = 'var(--dsw-alias-label-primary)'
const CMP_FG2 = 'var(--dsw-alias-label-secondary)'
const CMP_L1 = 'var(--dsw-alias-bg-layer-1)'
const CMP_L2 = 'var(--dsw-alias-bg-layer-2)'
const CMP_OVERLAY = 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2))'
const CMP_B1 = 'var(--dsw-alias-border-l1)'
const CMP_B4 = 'var(--dsw-alias-border-l4, var(--dsw-alias-border-l2))'
const CMP_BRAND = 'var(--dsw-alias-brand-primary)'
const CMP_ERR = 'var(--dsw-alias-state-error-primary)'
const CMP_OK = 'var(--dsw-alias-state-success-primary)'
const CMP_WARN = 'var(--dsw-alias-state-warn-primary)'
const CMP_IDLE = 'var(--dsw-alias-state-idle-primary)'
const CMP_MASK = 'var(--dsw-alias-bg-mask-1, color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent))'
const CMP_SHADOW = 'var(--dsw-shadow-lv1, 0 8px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent))'
const CMP_MONO = 'var(--dsw-alias-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)'

export const compareCss = `
/* ── comparison overlay ────────────────────────────────────────────────── */
.pd-cmp-overlay {
  position: absolute;
  inset: 0;
  z-index: 72;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  background: ${CMP_MASK};
  backdrop-filter: blur(2px);
  color: ${CMP_FG};
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.pd-cmp-overlay *, .pd-cmp-overlay *::before, .pd-cmp-overlay *::after { box-sizing: border-box; }
.pd-cmp-overlay ::-webkit-scrollbar { width: 10px; height: 10px; }
.pd-cmp-overlay ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 26%, transparent);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}
.pd-cmp-panel {
  display: flex;
  flex-direction: column;
  width: min(1120px, 100%);
  height: min(900px, 100%);
  min-height: 0;
  border: 1px solid ${CMP_B4};
  border-radius: 14px;
  background: ${CMP_OVERLAY};
  box-shadow: ${CMP_SHADOW};
  overflow: hidden;
  outline: none;
}
.pd-cmp-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 0 0 auto;
  padding: 13px 18px;
  border-bottom: 1px solid ${CMP_B1};
}
.pd-cmp-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pd-cmp-title { margin: 0; color: ${CMP_FG}; font-size: 15px; font-weight: 600; line-height: 1.35; }
.pd-cmp-subtitle { color: ${CMP_FG2}; font-size: 11.5px; line-height: 1.5; }
.pd-cmp-head-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: 0 0 auto; }
.pd-cmp-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ── step 1: paper picker ──────────────────────────────────────────────── */
.pd-cmp-picker { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-cmp-picker-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 10px 16px;
  border-bottom: 1px solid ${CMP_B1};
}
.pd-cmp-search { flex: 1 1 auto; min-width: 0; }
.pd-cmp-count { flex: 0 0 auto; color: ${CMP_FG2}; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.pd-cmp-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pd-cmp-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  cursor: pointer;
}
.pd-cmp-item:hover { background: color-mix(in srgb, ${CMP_BRAND} 5%, transparent); }
.pd-cmp-item[data-on="true"] {
  border-color: color-mix(in srgb, ${CMP_BRAND} 35%, transparent);
  background: color-mix(in srgb, ${CMP_BRAND} 8%, transparent);
}
.pd-cmp-item[data-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.pd-cmp-item-check { width: 15px; height: 15px; margin: 2px 0 0; flex: 0 0 auto; accent-color: ${CMP_BRAND}; }
.pd-cmp-item-main { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.pd-cmp-item-title {
  color: ${CMP_FG};
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pd-cmp-item-meta {
  color: ${CMP_FG2};
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-cmp-item-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.pd-cmp-tag {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border: 1px solid ${CMP_B1};
  border-radius: 999px;
  color: ${CMP_FG2};
  font-size: 10px;
  line-height: 1.6;
}
.pd-cmp-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 1px 7px;
  border: 1px solid ${CMP_B1};
  border-radius: 999px;
  color: ${CMP_FG2};
  font-size: 10px;
  line-height: 1.6;
  white-space: nowrap;
}
.pd-cmp-status-chip[data-status="unread"] { border-color: color-mix(in srgb, ${CMP_IDLE} 35%, ${CMP_B1}); color: ${CMP_IDLE}; }
.pd-cmp-status-chip[data-status="reading"] { border-color: color-mix(in srgb, ${CMP_WARN} 35%, ${CMP_B1}); color: ${CMP_WARN}; }
.pd-cmp-status-chip[data-status="read"] { border-color: color-mix(in srgb, ${CMP_OK} 35%, ${CMP_B1}); color: ${CMP_OK}; }
.pd-cmp-status-chip[data-status="archived"] { opacity: 0.8; }
.pd-cmp-pick-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  padding: 10px 16px;
  border-top: 1px solid ${CMP_B1};
}
.pd-cmp-chips { display: flex; flex-wrap: wrap; gap: 5px; flex: 1 1 auto; min-width: 0; }
.pd-cmp-selected-chip { max-width: 220px; }
.pd-cmp-chip-order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-right: 4px;
  border-radius: 50%;
  background: color-mix(in srgb, ${CMP_BRAND} 18%, transparent);
  color: ${CMP_BRAND};
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}
.pd-cmp-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-cmp-hint { flex: 0 0 auto; color: ${CMP_FG2}; font-size: 11px; }
.pd-cmp-hint[data-tone="warn"] { color: ${CMP_WARN}; }

/* ── step 2: comparison workspace ──────────────────────────────────────── */
.pd-cmp-work { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-cmp-work-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  padding: 8px 16px;
  border-bottom: 1px solid ${CMP_B1};
}
.pd-cmp-work-papers {
  flex: 1 1 180px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${CMP_FG2};
  font-size: 11.5px;
}
.pd-cmp-work .pd-tabs { padding: 0 12px; }
.pd-cmp-panes { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-cmp-tabpane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 14px;
}
.pd-cmp-report-pane { overflow: hidden; }

/* metadata matrix */
.pd-cmp-matrix-wrap { display: flex; flex-direction: column; gap: 6px; flex: 0 1 auto; min-height: 0; max-height: 44%; }
.pd-cmp-section-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pd-cmp-section-title { color: ${CMP_FG}; font-size: 12.5px; font-weight: 600; }
.pd-cmp-section-hint { color: ${CMP_FG2}; font-size: 11px; }
.pd-cmp-matrix-scroll {
  min-height: 0;
  overflow: auto;
  border: 1px solid ${CMP_B1};
  border-radius: 9px;
  background: ${CMP_L1};
}
.pd-cmp-matrix { width: 100%; min-width: 840px; border-collapse: separate; border-spacing: 0; font-size: 11.5px; }
.pd-cmp-matrix th, .pd-cmp-matrix td { padding: 6px 9px; border-bottom: 1px solid ${CMP_B1}; text-align: left; vertical-align: top; }
.pd-cmp-matrix tbody tr:last-child th, .pd-cmp-matrix tbody tr:last-child td { border-bottom: 0; }
.pd-cmp-matrix thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: ${CMP_L2};
  color: ${CMP_FG2};
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
}
.pd-cmp-matrix-corner { position: sticky !important; left: 0; z-index: 3 !important; }
.pd-cmp-matrix-rowhead {
  position: sticky;
  left: 0;
  z-index: 2;
  min-width: 200px;
  max-width: 280px;
  background: ${CMP_L1};
}
.pd-cmp-matrix td { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-cmp-matrix-doi { font-family: ${CMP_MONO}; font-size: 10.5px; }
.pd-cmp-paper-link {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${CMP_FG};
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-cmp-paper-link:hover { color: ${CMP_BRAND}; text-decoration: underline; }

/* AI thread */
.pd-cmp-ai { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; gap: 6px; }
.pd-cmp-ai-head { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: wrap; }
.pd-cmp-ai-spacer { flex: 1 1 auto; }
.pd-cmp-live {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${CMP_BRAND};
  box-shadow: 0 0 0 3px color-mix(in srgb, ${CMP_BRAND} 18%, transparent);
  animation: pd-cmp-pulse 1.6s ease-in-out infinite;
}
@keyframes pd-cmp-pulse { 50% { opacity: 0.35; } }
.pd-cmp-selection-hint { color: ${CMP_WARN}; font-size: 10.5px; }
.pd-cmp-ai-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid ${CMP_B1};
  border-radius: 10px;
  background: ${CMP_L1};
}
.pd-cmp-user {
  align-self: flex-end;
  max-width: 94%;
  max-height: 150px;
  overflow: auto;
  padding: 6px 9px;
  border-radius: 10px 10px 3px 10px;
  background: color-mix(in srgb, ${CMP_BRAND} 9%, transparent);
  color: ${CMP_FG};
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.pd-cmp-assistant { color: ${CMP_FG}; font-size: 12.5px; line-height: 1.6; }
.pd-cmp-assistant .pd-md { font-size: 12.5px; }
.pd-cmp-caret {
  display: inline-block;
  width: 5px;
  height: 12px;
  margin-left: 2px;
  border-radius: 1px;
  background: ${CMP_BRAND};
  vertical-align: -2px;
  animation: pd-cmp-blink 1s steps(2, start) infinite;
}
@keyframes pd-cmp-blink { 50% { opacity: 0; } }
.pd-cmp-reasoning { padding: 5px 8px; border: 1px solid ${CMP_B1}; border-radius: 8px; color: ${CMP_FG2}; font-size: 11px; }
.pd-cmp-reasoning summary { cursor: pointer; }
.pd-cmp-reasoning .pd-md { margin-top: 4px; color: ${CMP_FG2}; font-size: 11px; }
.pd-cmp-tool { display: flex; align-items: center; gap: 6px; min-width: 0; color: ${CMP_FG2}; font-size: 11px; }
.pd-cmp-tool-name { flex: 0 0 auto; font-weight: 500; }
.pd-cmp-tool-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.85; }
.pd-cmp-status { color: ${CMP_FG2}; font-size: 11px; }
.pd-cmp-thinking { display: flex; align-items: center; gap: 6px; padding: 2px 0; color: ${CMP_FG2}; font-size: 11.5px; }
.pd-cmp-error {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, ${CMP_ERR} 25%, ${CMP_B1});
  border-radius: 8px;
  background: color-mix(in srgb, ${CMP_ERR} 8%, transparent);
  color: ${CMP_ERR};
  font-size: 11.5px;
  line-height: 1.5;
}
.pd-cmp-error > span { flex: 1 1 auto; min-width: 0; word-break: break-word; }
.pd-cmp-jump {
  flex: 0 0 auto;
  padding: 1px 8px;
  border: 1px solid ${CMP_B1};
  border-radius: 999px;
  background: ${CMP_L1};
  color: ${CMP_FG2};
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.pd-cmp-jump:hover { color: ${CMP_FG}; }
.pd-cmp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: auto;
  padding: 26px 18px;
  color: ${CMP_FG2};
  text-align: center;
}
.pd-cmp-empty-title { color: ${CMP_FG}; font-size: 12.5px; font-weight: 600; }
.pd-cmp-empty-desc { max-width: 440px; font-size: 11.5px; line-height: 1.6; }
.pd-cmp-savebar { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: wrap; padding: 8px 2px 0; }
.pd-cmp-save-label { flex: 0 0 auto; color: ${CMP_FG2}; font-size: 11px; }
.pd-cmp-save-input { flex: 1 1 220px; min-width: 160px; }

/* notice strip */
.pd-cmp-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 7px 16px;
  border-top: 1px solid ${CMP_B1};
  color: ${CMP_FG2};
  font-size: 11.5px;
}
.pd-cmp-notice[data-kind="success"] { color: ${CMP_OK}; }
.pd-cmp-notice[data-kind="error"] { color: ${CMP_ERR}; }

/* ── saved comparisons ─────────────────────────────────────────────────── */
.pd-cmp-saved {
  display: grid;
  grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
}
.pd-cmp-saved-list { display: flex; flex-direction: column; gap: 5px; min-height: 0; overflow: auto; padding-right: 2px; }
.pd-cmp-saved-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid ${CMP_B1};
  border-radius: 9px;
  background: ${CMP_L1};
  color: ${CMP_FG};
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pd-cmp-saved-item:hover { border-color: color-mix(in srgb, ${CMP_BRAND} 35%, ${CMP_B1}); }
.pd-cmp-saved-item[data-on="true"] { border-color: ${CMP_BRAND}; background: color-mix(in srgb, ${CMP_BRAND} 6%, ${CMP_L1}); }
.pd-cmp-saved-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pd-cmp-saved-meta { color: ${CMP_FG2}; font-size: 10.5px; }
.pd-cmp-saved-preview {
  color: ${CMP_FG2};
  font-size: 11px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pd-cmp-saved-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid ${CMP_B1};
  border-radius: 10px;
  background: ${CMP_L1};
}
.pd-cmp-saved-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.pd-cmp-saved-detail-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pd-cmp-saved-detail-title { margin: 0; color: ${CMP_FG}; font-size: 13.5px; font-weight: 600; line-height: 1.4; }
.pd-cmp-saved-papers { color: ${CMP_FG2}; font-size: 11px; line-height: 1.5; }
.pd-cmp-saved-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pd-cmp-saved-delete-hint { color: ${CMP_ERR}; font-size: 11px; }
.pd-cmp-saved-view { padding-top: 8px; border-top: 1px solid ${CMP_B1}; }
.pd-cmp-readonly {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border: 1px solid ${CMP_B1};
  border-radius: 999px;
  color: ${CMP_FG2};
  font-size: 10px;
  line-height: 1.7;
}
.pd-cmp-saved-view .pd-md { margin-top: 8px; }
.pd-cmp-md { font-size: 12.5px; }

/* ── relation suggestions ──────────────────────────────────────────────── */
.pd-cmp-suggestions { display: flex; flex-direction: column; gap: 8px; }
.pd-cmp-suggestion {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid ${CMP_B1};
  border-radius: 10px;
  background: ${CMP_L1};
}
.pd-cmp-suggestion[data-added="true"] {
  border-color: color-mix(in srgb, ${CMP_OK} 40%, ${CMP_B1});
  background: color-mix(in srgb, ${CMP_OK} 5%, ${CMP_L1});
}
.pd-cmp-suggestion-main { display: flex; flex-direction: column; gap: 4px; flex: 1 1 320px; min-width: 0; }
.pd-cmp-suggestion-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; font-weight: 500; }
.pd-cmp-kind-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, ${CMP_BRAND} 35%, ${CMP_B1});
  border-radius: 999px;
  color: ${CMP_BRAND};
  font-size: 10px;
  line-height: 1.7;
  letter-spacing: 0.02em;
}
.pd-cmp-suggestion-pair { color: ${CMP_FG}; word-break: break-word; }
.pd-cmp-suggestion-reason { color: ${CMP_FG2}; font-size: 11.5px; line-height: 1.55; }
.pd-cmp-suggestion-warn { color: ${CMP_WARN}; font-size: 11px; }
.pd-cmp-suggestion-error { color: ${CMP_ERR}; font-size: 11px; }
.pd-cmp-suggestion-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.pd-cmp-suggestion-added { color: ${CMP_OK}; font-size: 11px; }

/* ── responsive: full-height single column ─────────────────────────────── */
@container pd (max-width: 900px) {
  .pd-cmp-overlay { padding: 0; backdrop-filter: none; }
  .pd-cmp-panel { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; }
  .pd-cmp-matrix-wrap { max-height: none; }
  .pd-cmp-saved { grid-template-columns: 1fr; }
  .pd-cmp-saved-list { max-height: 38vh; }
  .pd-cmp-saved-detail { min-height: 240px; }
  .pd-cmp-hint { flex: 1 1 100%; order: 3; }
}
@media (max-width: 900px) {
  .pd-cmp-overlay { padding: 0; backdrop-filter: none; }
  .pd-cmp-panel { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; }
  .pd-cmp-matrix-wrap { max-height: none; }
  .pd-cmp-saved { grid-template-columns: 1fr; }
  .pd-cmp-saved-list { max-height: 38vh; }
  .pd-cmp-saved-detail { min-height: 240px; }
  .pd-cmp-hint { flex: 1 1 100%; order: 3; }
}
`

/* ── component ─────────────────────────────────────────────────────────── */

export function CompareView(props: CompareViewProps): ReactElement | null {
  const { open, ctx, lang, initialPaperIds, onClose, onOpenPaper } = props

  const t = useCallback(
    (key: string): string => {
      const table = compareDict[lang]
      const value = table[key]
      return value === undefined ? key : value
    },
    [lang],
  )

  /* AI thread (one controller, per-compare thread keys). */
  const thread = useMemo(() => createAiThread(ctx), [ctx])
  const subscribeThread = useCallback((listener: () => void) => thread.subscribe(listener), [thread])
  const getThreadSnapshot = useCallback(() => thread.getSnapshot(), [thread])
  const snapshot = useSyncExternalStore(subscribeThread, getThreadSnapshot)
  useEffect(() => () => thread.dispose(), [thread])

  /* data + selection */
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const [papersLoading, setPapersLoading] = useState(false)
  const [papersError, setPapersError] = useState<string | null>(null)
  const papersTokenRef = useRef(0)

  const [saved, setSaved] = useState<ComparisonSummary[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)
  const savedTokenRef = useRef(0)

  const [step, setStep] = useState<Step>('pick')
  const [tab, setTab] = useState<TabId>('report')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [lastRunIds, setLastRunIds] = useState<string[]>([])
  const [query, setQuery] = useState('')

  /* request lifecycle */
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saving, setSaving] = useState(false)

  /* saved detail */
  const [detail, setDetail] = useState<PaperComparison | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const detailTokenRef = useRef(0)
  const detailIdRef = useRef<string | null>(null)

  /* relation suggestions */
  const [suggestionState, setSuggestionState] = useState<Record<string, SuggestionUi>>({})

  /* scroll + focus */
  const [follow, setFollow] = useState(true)
  const reportScrollRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const runLockRef = useRef(false)

  const paperById = useMemo(() => {
    const map = new Map<string, PaperSummary>()
    for (const paper of papers) map.set(paper.id, paper)
    return map
  }, [papers])

  const selectedPapers = useMemo(
    () => selectedIds.map((id) => paperById.get(id)).filter((paper): paper is PaperSummary => paper !== undefined),
    [selectedIds, paperById],
  )

  const filteredPapers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return papers
    return papers.filter((paper) => {
      const haystack = [
        paper.title,
        paper.authors.join(' '),
        paper.venue,
        paper.year === null ? '' : String(paper.year),
        paper.tags.join(' '),
        paper.status,
        t(STATUS_KEY[paper.status]),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [papers, query, t])

  const threadAnswer = thread.lastAnswer()
  const reportMarkdown = threadAnswer ?? (detail === null ? '' : detail.markdown)
  /* Numbered references ("Paper 1") follow the report's own paper order: the
   * live selection for a generated report, the saved ids for a saved one. */
  const suggestionOrder = threadAnswer === null && detail !== null ? detail.paperIds : selectedIds
  const suggestions = useMemo(
    () => parseSuggestions(reportMarkdown, papers, suggestionOrder),
    [reportMarkdown, papers, suggestionOrder],
  )

  /* Which papers the current report belongs to. The controller's thread key is
   * authoritative (it survives reopening/reloading the overlay); `lastRunIds`
   * keeps the selection order for the freshly started run. */
  const threadKeyIds = useMemo(() => {
    const key = snapshot.threadKey
    if (key === null || !key.startsWith('compare:')) return [] as string[]
    return key
      .slice('compare:'.length)
      .split(',')
      .filter((id) => id !== '')
  }, [snapshot.threadKey])

  const reportIds = useMemo(() => {
    if (lastRunIds.length >= MIN_PAPERS && (threadKeyIds.length === 0 || sameIdSet(lastRunIds, threadKeyIds))) {
      return lastRunIds
    }
    return threadKeyIds
  }, [lastRunIds, threadKeyIds])

  const threadRunning = snapshot.status === 'running'
  const attaching = starting || snapshot.status === 'attaching'
  const busy = attaching || threadRunning
  const canSave = threadAnswer !== null && threadAnswer.trim() !== ''
  const canStart = selectedIds.length >= MIN_PAPERS && selectedIds.length <= MAX_PAPERS

  const selectionChanged =
    threadAnswer !== null && reportIds.length > 0 && !sameIdSet(reportIds, selectedIds)

  /* ── loaders ─────────────────────────────────────────────────────────── */

  const loadPapers = useCallback(async (): Promise<void> => {
    const token = papersTokenRef.current + 1
    papersTokenRef.current = token
    setPapersLoading(true)
    setPapersError(null)
    try {
      const payload = await api.papers({ limit: 1000 })
      if (papersTokenRef.current === token) setPapers(payload.papers)
    } catch (error) {
      if (papersTokenRef.current === token) setPapersError(errorMessage(error))
    } finally {
      if (papersTokenRef.current === token) setPapersLoading(false)
    }
  }, [])

  const loadSaved = useCallback(async (): Promise<void> => {
    const token = savedTokenRef.current + 1
    savedTokenRef.current = token
    setSavedLoading(true)
    setSavedError(null)
    try {
      const payload = await api.comparisons()
      if (savedTokenRef.current === token) setSaved(payload.comparisons)
    } catch (error) {
      if (savedTokenRef.current === token) setSavedError(errorMessage(error))
    } finally {
      if (savedTokenRef.current === token) setSavedLoading(false)
    }
  }, [])

  const initialKey = initialPaperIds === undefined ? '' : initialPaperIds.join(',')

  /* Reset per open; refresh both lists. */
  useEffect(() => {
    if (!open) return
    setStep('pick')
    setTab('report')
    setQuery('')
    setNotice(null)
    setSaveOpen(false)
    setSaveTitle('')
    setSaving(false)
    setStarting(false)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(false)
    detailIdRef.current = null
    setDeleteConfirm(false)
    setDeleting(false)
    setSuggestionState({})
    setLastRunIds([])
    setFollow(true)
    setSelectedIds(initialPaperIds === undefined ? [] : [...initialPaperIds].slice(0, MAX_PAPERS))
    void loadPapers()
    void loadSaved()
    // initialPaperIds content is captured through initialKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey, loadPapers, loadSaved])

  /* Drop selections whose paper is no longer in the library. */
  useEffect(() => {
    if (papers.length === 0) return
    setSelectedIds((previous) => {
      const filtered = previous.filter((id) => papers.some((paper) => paper.id === id))
      return filtered.length === previous.length ? previous : filtered
    })
  }, [papers])

  /* Success notices fade out; errors stay until the next action. */
  useEffect(() => {
    if (notice === null || notice.kind !== 'success') return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  /* Dialog focus + Escape (Escape first closes the innermost transient state). */
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      if (previous !== null && previous.isConnected) previous.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (saveOpen) {
        setSaveOpen(false)
        return
      }
      if (deleteConfirm) {
        setDeleteConfirm(false)
        return
      }
      if (tab === 'saved' && detail !== null) {
        setDetail(null)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, saveOpen, deleteConfirm, tab, detail, onClose])

  /* Auto-follow the streaming report unless the user scrolled up. */
  useEffect(() => {
    if (!open || tab !== 'report') return
    const element = reportScrollRef.current
    if (element === null) return
    if (follow) element.scrollTop = element.scrollHeight
  }, [snapshot.rows, snapshot.status, follow, open, tab])

  const onReportScroll = (): void => {
    const element = reportScrollRef.current
    if (element === null) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setFollow(distance < 40)
  }

  const jumpLatest = (): void => {
    const element = reportScrollRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
    setFollow(true)
  }

  /* ── actions ─────────────────────────────────────────────────────────── */

  const togglePaper = (paperId: string): void => {
    setSelectedIds((previous) => {
      if (previous.includes(paperId)) return previous.filter((id) => id !== paperId)
      if (previous.length >= MAX_PAPERS) return previous
      return [...previous, paperId]
    })
  }

  const removeSelected = (paperId: string): void => {
    setSelectedIds((previous) => previous.filter((id) => id !== paperId))
  }

  const goWork = (): void => {
    if (!canStart) return
    setStep('work')
    setTab('report')
    setNotice(null)
    setFollow(true)
  }

  const backToPick = (): void => {
    setStep('pick')
    setTab('report')
    setSaveOpen(false)
    setNotice(null)
    setQuery('')
  }

  const sessionTitleFor = useCallback(
    (ids: readonly string[]): string => {
      const names = ids.map((id) => shortTitle(paperById.get(id)?.title ?? id, 32))
      return shortTitle(`${t('compare.threadPrefix')} · ${names.join(t('compare.titleJoin'))}`, MAX_TITLE)
    },
    [paperById, t],
  )

  const startCompare = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (ids.length < MIN_PAPERS || ids.length > MAX_PAPERS) return
      if (runLockRef.current) return
      runLockRef.current = true
      const ordered = [...ids]
      setStep('work')
      setTab('report')
      setNotice(null)
      setSaveOpen(false)
      setFollow(true)
      setStarting(true)
      setLastRunIds(ordered)
      try {
        const status = await api.status()
        const workspacePath = status.settings.libraryPath
        if (workspacePath.trim() === '') throw new Error(t('compare.noWorkspace'))
        const sortedIds = [...ordered].sort()
        const threadKey = `compare:${sortedIds.join(',')}`
        await thread.openThread(threadKey, {
          workspacePath,
          title: sessionTitleFor(ordered),
        })
        const payload = await api.compareAssist(ordered)
        const result = await thread.run(payload.prompt)
        if (!result.ok && typeof result.error === 'string' && result.error !== '') {
          setNotice({ kind: 'error', text: result.error })
        }
      } catch (error) {
        setNotice({ kind: 'error', text: errorMessage(error) || t('compare.unknownError') })
      } finally {
        runLockRef.current = false
        setStarting(false)
      }
    },
    [thread, t, sessionTitleFor],
  )

  const stopRun = (): void => {
    void thread.stop()
  }

  const retryRun = (): void => {
    const ids = reportIds.length >= MIN_PAPERS ? reportIds : selectedIds
    if (ids.length >= MIN_PAPERS && ids.length <= MAX_PAPERS) void startCompare(ids)
  }

  const openSave = (): void => {
    const markdown = thread.lastAnswer()
    if (markdown === null || markdown.trim() === '') {
      setNotice({ kind: 'error', text: t('compare.noAnswer') })
      return
    }
    const ids = reportIds.length >= MIN_PAPERS ? reportIds : selectedIds
    const names = ids.map((id) => shortTitle(paperById.get(id)?.title ?? id, 42))
    const fallback = names.join(t('compare.titleJoin'))
    setSaveTitle(shortTitle(fallback !== '' ? fallback : t('compare.defaultTitle'), MAX_TITLE))
    setSaveOpen(true)
    setNotice(null)
  }

  const submitSave = async (): Promise<void> => {
    if (saving) return
    const markdown = thread.lastAnswer()
    if (markdown === null || markdown.trim() === '') {
      setSaveOpen(false)
      setNotice({ kind: 'error', text: t('compare.noAnswer') })
      return
    }
    const ids = reportIds.length >= MIN_PAPERS ? reportIds : selectedIds
    if (ids.length < MIN_PAPERS || ids.length > MAX_PAPERS) {
      setNotice({ kind: 'error', text: t('compare.saveFailed') })
      return
    }
    const fallback = ids
      .map((id) => shortTitle(paperById.get(id)?.title ?? id, 42))
      .join(t('compare.titleJoin'))
    const desired = saveTitle.trim() !== '' ? saveTitle.trim() : fallback
    const title = shortTitle(desired !== '' ? desired : t('compare.defaultTitle'), MAX_TITLE)
    setSaving(true)
    try {
      const saved = await api.saveComparison({ title, paperIds: ids, markdown })
      const list = await api.comparisons()
      setSaved(list.comparisons)
      setSaveOpen(false)
      setTab('saved')
      setNotice({ kind: 'success', text: t('compare.saveSuccess') })
      await openSaved(saved.id)
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) || t('compare.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const openSaved = async (comparisonId: string): Promise<void> => {
    detailIdRef.current = comparisonId
    const token = detailTokenRef.current + 1
    detailTokenRef.current = token
    setDetailLoading(true)
    setDetailError(null)
    setDeleteConfirm(false)
    try {
      const comparison = await api.comparison(comparisonId)
      if (detailTokenRef.current === token) setDetail(comparison)
    } catch (error) {
      if (detailTokenRef.current === token) {
        setDetail(null)
        setDetailError(errorMessage(error) || t('compare.loadSavedFailed'))
      }
    } finally {
      if (detailTokenRef.current === token) setDetailLoading(false)
    }
  }

  const deleteSaved = async (): Promise<void> => {
    if (detail === null || deleting) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }
    setDeleting(true)
    try {
      await api.deleteComparison(detail.id)
      setDetail(null)
      setDeleteConfirm(false)
      setNotice({ kind: 'success', text: t('compare.savedDeleted') })
      await loadSaved()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) || t('compare.deleteFailed') })
    } finally {
      setDeleting(false)
    }
  }

  const regenerateSaved = (): void => {
    if (detail === null) return
    const ids = detail.paperIds.slice(0, MAX_PAPERS)
    if (ids.length < MIN_PAPERS) {
      setNotice({ kind: 'error', text: t('compare.regenerateMissing') })
      return
    }
    setSelectedIds(ids)
    setDetail(null)
    setDetailError(null)
    setDeleteConfirm(false)
    void startCompare(ids)
  }

  const addSuggestion = async (suggestion: RelationSuggestion): Promise<void> => {
    if (suggestion.fromId === null || suggestion.toId === null || suggestion.kind === null) return
    setSuggestionState((previous) => ({
      ...previous,
      [suggestion.key]: { busy: true, added: false, error: null },
    }))
    try {
      await api.addRelation({
        from: suggestion.fromId,
        to: suggestion.toId,
        kind: suggestion.kind,
        note: suggestion.reason.slice(0, 1000),
        source: 'agent',
      })
      setSuggestionState((previous) => ({
        ...previous,
        [suggestion.key]: { busy: false, added: true, error: null },
      }))
      setNotice({ kind: 'success', text: t('compare.addedGraphNotice') })
    } catch (error) {
      const message = errorMessage(error)
      const duplicate = /already exists|duplicate|已存在/i.test(message)
      setSuggestionState((previous) => ({
        ...previous,
        [suggestion.key]: duplicate
          ? { busy: false, added: true, error: null }
          : { busy: false, added: false, error: message !== '' ? message : t('compare.unknownError') },
      }))
    }
  }

  /* ── render helpers ──────────────────────────────────────────────────── */

  const statusLabel = (status: PaperStatus): string => t(STATUS_KEY[status])

  const renderThreadRow = (row: AiRow): ReactElement => {
    switch (row.kind) {
      case 'user':
        return (
          <div key={row.id} className="pd-cmp-user">
            {row.text}
          </div>
        )
      case 'assistant':
        return (
          <div key={row.id} className="pd-cmp-assistant">
            <Markdown markdown={row.text} />
            {row.streaming === true ? <span className="pd-cmp-caret" aria-hidden="true" /> : null}
          </div>
        )
      case 'reasoning':
        return (
          <details key={row.id} className="pd-cmp-reasoning">
            <summary>{t('compare.reasoning')}</summary>
            <Markdown markdown={row.text} />
          </details>
        )
      case 'tool':
        return (
          <div key={row.id} className="pd-cmp-tool">
            {row.running === true ? (
              <Spinner size={10} label={t('compare.thinking')} />
            ) : (
              <span aria-hidden="true">·</span>
            )}
            <span className="pd-cmp-tool-name">
              {row.tool ?? (row.text.trim() !== '' ? firstLine(row.text) : t('compare.thinking'))}
            </span>
            {row.tool !== undefined && row.text.trim() !== '' && row.text !== row.tool ? (
              <span className="pd-cmp-tool-detail" title={row.text}>
                {firstLine(row.text)}
              </span>
            ) : null}
          </div>
        )
      case 'error':
        return (
          <div key={row.id} className="pd-cmp-error" role="alert">
            <span>{row.text}</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={retryRun}>
              {t('compare.retry')}
            </Button>
          </div>
        )
      default:
        return (
          <div key={row.id} className="pd-cmp-status">
            {row.text}
          </div>
        )
    }
  }

  const renderMatrix = (): ReactElement => (
    <div className="pd-cmp-matrix-wrap">
      <div className="pd-cmp-section-head">
        <span className="pd-cmp-section-title">{t('compare.matrixTitle')}</span>
        <span className="pd-cmp-section-hint">{t('compare.matrixHint')}</span>
      </div>
      <div className="pd-cmp-matrix-scroll">
        <table className="pd-cmp-matrix">
          <caption className="pd-cmp-sr">{t('compare.matrixCaption')}</caption>
          <thead>
            <tr>
              <th scope="col" className="pd-cmp-matrix-corner">
                {t('compare.col.title')}
              </th>
              <th scope="col">{t('compare.col.authors')}</th>
              <th scope="col">{t('compare.col.year')}</th>
              <th scope="col">{t('compare.col.venue')}</th>
              <th scope="col">{t('compare.col.status')}</th>
              <th scope="col">{t('compare.col.tags')}</th>
              <th scope="col">{t('compare.col.pages')}</th>
              <th scope="col">{t('compare.col.doi')}</th>
            </tr>
          </thead>
          <tbody>
            {selectedPapers.map((paper) => (
              <tr key={paper.id}>
                <th scope="row" className="pd-cmp-matrix-rowhead">
                  <button
                    type="button"
                    className="pd-cmp-paper-link"
                    title={t('compare.openPaper')}
                    onClick={() => onOpenPaper(paper.id)}
                  >
                    {paper.title}
                  </button>
                </th>
                <td title={paper.authors.join(', ')}>
                  {paper.authors.length > 0 ? paper.authors.join(', ') : '—'}
                </td>
                <td>{paper.year === null ? '—' : String(paper.year)}</td>
                <td title={paper.venue}>{paper.venue !== '' ? paper.venue : '—'}</td>
                <td>
                  <span className="pd-cmp-status-chip" data-status={paper.status}>
                    {statusLabel(paper.status)}
                  </span>
                </td>
                <td title={paper.tags.join(' · ')}>{paper.tags.length > 0 ? paper.tags.join(' · ') : '—'}</td>
                <td>{paper.pageCount === null ? '—' : String(paper.pageCount)}</td>
                <td className="pd-cmp-matrix-doi" title={paper.doi}>
                  {paper.doi !== '' ? paper.doi : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  const renderReportTab = (): ReactElement => (
    <div className="pd-cmp-tabpane pd-cmp-report-pane">
      {renderMatrix()}
      <section className="pd-cmp-ai" aria-label={t('compare.reportTitle')}>
        <div className="pd-cmp-ai-head">
          <span className="pd-cmp-section-title">{t('compare.reportTitle')}</span>
          {busy ? <span className="pd-cmp-live" aria-hidden="true" /> : null}
          {selectionChanged ? (
            <span className="pd-cmp-selection-hint">
              {formatTemplate(t('compare.selectionChanged'), { n: reportIds.length })}
            </span>
          ) : null}
          <span className="pd-cmp-ai-spacer" />
          {!follow && snapshot.rows.length > 0 ? (
            <button type="button" className="pd-cmp-jump" onClick={jumpLatest}>
              {t('compare.jumpLatest')}
            </button>
          ) : null}
        </div>
        <div
          className="pd-cmp-ai-scroll"
          ref={reportScrollRef}
          onScroll={onReportScroll}
          aria-busy={busy || undefined}
        >
          {snapshot.status === 'error' && snapshot.error !== null ? (
            <div className="pd-cmp-error" role="alert">
              <span>{snapshot.error !== '' ? snapshot.error : t('compare.threadError')}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={retryRun}>
                {t('compare.retry')}
              </Button>
            </div>
          ) : null}
          {snapshot.rows.length === 0 && !attaching && snapshot.status !== 'error' ? (
            <div className="pd-cmp-empty">
              <span className="pd-cmp-empty-title">{t('compare.reportEmpty')}</span>
              <span className="pd-cmp-empty-desc">{t('compare.reportEmptyHint')}</span>
            </div>
          ) : null}
          {snapshot.rows.map((row) => renderThreadRow(row))}
          {attaching ? (
            <div className="pd-cmp-thinking">
              <Spinner size={12} label={t('compare.attaching')} />
              <span>{t('compare.attaching')}</span>
            </div>
          ) : null}
          {threadRunning ? (
            <div className="pd-cmp-thinking">
              <Spinner size={12} label={t('compare.thinking')} />
              <span>{t('compare.thinking')}</span>
            </div>
          ) : null}
        </div>
        {saveOpen ? (
          <div className="pd-cmp-savebar">
            <label className="pd-cmp-save-label" htmlFor="pd-cmp-save-title">
              {t('compare.saveTitle')}
            </label>
            <TextInput
              id="pd-cmp-save-title"
              className="pd-cmp-save-input"
              value={saveTitle}
              maxLength={MAX_TITLE}
              aria-label={t('compare.saveTitle')}
              onChange={(event) => setSaveTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void submitSave()
              }}
            />
            <Button size="sm" variant="primary" loading={saving} onClick={() => void submitSave()}>
              {saving ? t('compare.saving') : t('compare.saveConfirm')}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setSaveOpen(false)}>
              {t('compare.saveCancel')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )

  const renderSavedTab = (): ReactElement => (
    <div className="pd-cmp-tabpane pd-cmp-saved-pane">
      {savedLoading && saved.length === 0 ? (
        <div className="pd-cmp-thinking">
          <Spinner size={12} label={t('compare.loading')} />
          <span>{t('compare.loading')}</span>
        </div>
      ) : null}
      {savedError !== null ? (
        <div className="pd-cmp-error" role="alert">
          <span>{savedError !== '' ? savedError : t('compare.loadSavedFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => void loadSaved()}>
            {t('compare.retry')}
          </Button>
        </div>
      ) : null}
      {saved.length === 0 && !savedLoading && savedError === null ? (
        <div className="pd-cmp-empty">
          <span className="pd-cmp-empty-title">{t('compare.savedEmpty')}</span>
          <span className="pd-cmp-empty-desc">{t('compare.savedEmptyHint')}</span>
        </div>
      ) : null}
      {saved.length > 0 ? (
        <div className="pd-cmp-saved">
          <div className="pd-cmp-saved-list">
            {saved.map((item) => {
              const active = detail !== null && detail.id === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className="pd-cmp-saved-item"
                  data-on={active ? 'true' : 'false'}
                  onClick={() => void openSaved(item.id)}
                >
                  <span className="pd-cmp-saved-title">{item.title}</span>
                  <span className="pd-cmp-saved-meta">
                    {formatTemplate(t('compare.savedPapers'), { n: item.paperIds.length })}
                    {formatDate(item.createdAt, lang) !== ''
                      ? ` · ${formatDate(item.createdAt, lang)}`
                      : ''}
                  </span>
                  {item.preview.trim() !== '' ? (
                    <span className="pd-cmp-saved-preview">{shortTitle(item.preview, 150)}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="pd-cmp-saved-detail">
            {detailLoading ? (
              <div className="pd-cmp-thinking">
                <Spinner size={12} label={t('compare.savedLoading')} />
                <span>{t('compare.savedLoading')}</span>
              </div>
            ) : null}
            {detailError !== null ? (
              <div className="pd-cmp-error" role="alert">
                <span>{detailError !== '' ? detailError : t('compare.loadSavedFailed')}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const id = detailIdRef.current
                    setDetailError(null)
                    if (id !== null) void openSaved(id)
                  }}
                >
                  {t('compare.retry')}
                </Button>
              </div>
            ) : null}
            {!detailLoading && detailError === null && detail === null ? (
              <div className="pd-cmp-empty">
                <span className="pd-cmp-empty-desc">{t('compare.savedSelect')}</span>
              </div>
            ) : null}
            {!detailLoading && detail !== null ? (
              <>
                <div className="pd-cmp-saved-detail-head">
                  <div className="pd-cmp-saved-detail-meta">
                    <h3 className="pd-cmp-saved-detail-title">{detail.title}</h3>
                    <span className="pd-cmp-saved-meta">
                      {formatTemplate(t('compare.savedAt'), { date: formatDate(detail.createdAt, lang) })}
                    </span>
                    <span className="pd-cmp-saved-papers">
                      {detail.paperIds
                        .map((id) => shortTitle(paperById.get(id)?.title ?? t('compare.unknownPaper'), 28))
                        .join(' · ')}
                    </span>
                  </div>
                  <div className="pd-cmp-saved-actions">
                    <Button size="sm" variant="ghost" disabled={deleting} onClick={regenerateSaved}>
                      {t('compare.savedRegenerate')}
                    </Button>
                    <Button
                      size="sm"
                      variant={deleteConfirm ? 'danger' : 'ghost'}
                      loading={deleting}
                      onClick={() => void deleteSaved()}
                    >
                      {deleting
                        ? t('compare.deleting')
                        : deleteConfirm
                          ? t('compare.savedDeleteConfirm')
                          : t('compare.savedDelete')}
                    </Button>
                    {deleteConfirm ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleting}
                        onClick={() => setDeleteConfirm(false)}
                      >
                        {t('compare.savedDeleteCancel')}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {deleteConfirm ? (
                  <div className="pd-cmp-saved-delete-hint" role="alert">
                    {t('compare.savedDeleteHint')}
                  </div>
                ) : null}
                <div className="pd-cmp-saved-view">
                  <span className="pd-cmp-readonly">{t('compare.savedReadOnly')}</span>
                  <Markdown markdown={detail.markdown} className="pd-cmp-md" />
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )

  const renderSuggestionsTab = (): ReactElement => (
    <div className="pd-cmp-tabpane">
      {suggestions.length === 0 ? (
        <div className="pd-cmp-empty">
          <span className="pd-cmp-empty-title">{t('compare.suggestionsEmpty')}</span>
          <span className="pd-cmp-empty-desc">{t('compare.suggestionsEmptyHint')}</span>
        </div>
      ) : (
        <div className="pd-cmp-suggestions">
          {suggestions.map((suggestion) => {
            const state = suggestionState[suggestion.key] ?? { busy: false, added: false, error: null }
            const resolvable =
              suggestion.fromId !== null && suggestion.toId !== null && suggestion.kind !== null
            const kindText =
              suggestion.kind === null ? suggestion.rawKind : t(`compare.kind.${suggestion.kind}`)
            return (
              <div
                key={suggestion.key}
                className="pd-cmp-suggestion"
                data-added={state.added ? 'true' : 'false'}
              >
                <div className="pd-cmp-suggestion-main">
                  <div className="pd-cmp-suggestion-line">
                    <span className="pd-cmp-kind-chip">{kindText}</span>
                    <span className="pd-cmp-suggestion-pair">
                      {suggestion.fromName} ↔ {suggestion.toName}
                    </span>
                  </div>
                  {suggestion.reason !== '' ? (
                    <div className="pd-cmp-suggestion-reason">{suggestion.reason}</div>
                  ) : null}
                  {suggestion.kind === null ? (
                    <div className="pd-cmp-suggestion-warn">{t('compare.suggestionUnknownKind')}</div>
                  ) : null}
                  {suggestion.fromId === null || suggestion.toId === null ? (
                    <div className="pd-cmp-suggestion-warn">{t('compare.suggestionUnmatched')}</div>
                  ) : null}
                  {state.error !== null ? (
                    <div className="pd-cmp-suggestion-error" role="alert">
                      {state.error}
                    </div>
                  ) : null}
                </div>
                <div className="pd-cmp-suggestion-actions">
                  {state.added ? (
                    <span className="pd-cmp-suggestion-added">{t('compare.addedGraph')}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={state.busy}
                      disabled={!resolvable}
                      onClick={() => void addSuggestion(suggestion)}
                    >
                      {state.busy ? t('compare.addingGraph') : t('compare.addGraph')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderPicker = (): ReactElement => (
    <div className="pd-cmp-picker">
      <div className="pd-cmp-picker-bar">
        <TextInput
          className="pd-cmp-search"
          type="search"
          value={query}
          placeholder={t('compare.searchPlaceholder')}
          aria-label={t('compare.searchLabel')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="pd-cmp-count">
          {formatTemplate(t('compare.count'), { selected: selectedIds.length, max: MAX_PAPERS })}
        </span>
      </div>

      {papersError !== null ? (
        <div className="pd-cmp-error" role="alert">
          <span>{papersError !== '' ? papersError : t('compare.loadFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => void loadPapers()}>
            {t('compare.retry')}
          </Button>
        </div>
      ) : null}

      <div className="pd-cmp-list">
        {papersLoading && papers.length === 0 ? (
          <div className="pd-cmp-thinking">
            <Spinner size={12} label={t('compare.loading')} />
            <span>{t('compare.loading')}</span>
          </div>
        ) : null}
        {!papersLoading && papers.length === 0 && papersError === null ? (
          <div className="pd-cmp-empty">
            <span className="pd-cmp-empty-title">{t('compare.papersEmpty')}</span>
            <span className="pd-cmp-empty-desc">{t('compare.papersEmptyHint')}</span>
          </div>
        ) : null}
        {papers.length > 0 && filteredPapers.length === 0 ? (
          <div className="pd-cmp-empty">
            <span className="pd-cmp-empty-title">{t('compare.noMatch')}</span>
            <span className="pd-cmp-empty-desc">{t('compare.noMatchHint')}</span>
          </div>
        ) : null}
        {filteredPapers.map((paper) => {
          const checked = selectedIds.includes(paper.id)
          const disabled = !checked && selectedIds.length >= MAX_PAPERS
          const meta = [
            paper.authors.length > 0 ? shortTitle(paper.authors.join(', '), 70) : t('compare.unknownAuthor'),
            paper.year === null ? '' : String(paper.year),
            paper.venue === '' ? '' : shortTitle(paper.venue, 40),
          ]
            .filter((part) => part !== '')
            .join(' · ')
          return (
            <label
              key={paper.id}
              className="pd-cmp-item"
              data-on={checked ? 'true' : 'false'}
              data-disabled={disabled ? 'true' : 'false'}
            >
              <input
                className="pd-cmp-item-check"
                type="checkbox"
                checked={checked}
                disabled={disabled}
                aria-label={paper.title}
                onChange={() => togglePaper(paper.id)}
              />
              <span className="pd-cmp-item-main">
                <span className="pd-cmp-item-title">{paper.title}</span>
                <span className="pd-cmp-item-meta">{meta}</span>
                {paper.tags.length > 0 ? (
                  <span className="pd-cmp-item-tags">
                    {paper.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="pd-cmp-tag">
                        {tag}
                      </span>
                    ))}
                    {paper.tags.length > 4 ? (
                      <span className="pd-cmp-tag">+{paper.tags.length - 4}</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span className="pd-cmp-status-chip" data-status={paper.status}>
                {statusLabel(paper.status)}
              </span>
            </label>
          )
        })}
      </div>

      <div className="pd-cmp-pick-foot">
        <div className="pd-cmp-chips">
          {selectedIds.map((id, index) => (
            <Chip
              key={id}
              active
              className="pd-cmp-selected-chip"
              title={t('compare.remove')}
              onClick={() => removeSelected(id)}
            >
              <span className="pd-cmp-chip-order">{index + 1}</span>
              <span className="pd-cmp-chip-label">
                {shortTitle(paperById.get(id)?.title ?? id, 26)}
              </span>
              <span aria-hidden="true">×</span>
            </Chip>
          ))}
        </div>
        <span className="pd-cmp-hint" data-tone={selectedIds.length < MIN_PAPERS ? 'warn' : 'muted'}>
          {formatTemplate(t('compare.countHint'), { min: MIN_PAPERS, max: MAX_PAPERS })}
        </span>
        <Button variant="primary" disabled={!canStart} onClick={goWork}>
          {t('compare.start')}
        </Button>
      </div>
    </div>
  )

  const tabItems = useMemo(
    () => [
      { id: 'report', label: t('compare.tabs.report') },
      { id: 'saved', label: t('compare.tabs.saved') },
      {
        id: 'suggestions',
        label: t('compare.tabs.suggestions'),
        badge: suggestions.length > 0 ? suggestions.length : undefined,
      },
    ],
    [t, suggestions.length],
  )

  const renderWork = (): ReactElement => (
    <div className="pd-cmp-work">
      <div className="pd-cmp-work-bar">
        <Button size="sm" variant="ghost" disabled={busy} onClick={backToPick}>
          {t('compare.back')}
        </Button>
        <span
          className="pd-cmp-work-papers"
          title={selectedPapers.map((paper) => paper.title).join(' / ')}
        >
          {selectedPapers.map((paper) => shortTitle(paper.title, 36)).join('  ·  ')}
        </span>
        <Button
          size="sm"
          variant="primary"
          loading={attaching}
          disabled={busy || !canStart}
          onClick={() => void startCompare(selectedIds)}
        >
          {canSave ? t('compare.regenerate') : t('compare.generate')}
        </Button>
        {threadRunning ? (
          <Button size="sm" variant="ghost" onClick={stopRun}>
            {t('compare.stop')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={!canSave || saving}
          onClick={() => {
            if (saveOpen) setSaveOpen(false)
            else openSave()
          }}
        >
          {t('compare.save')}
        </Button>
      </div>

      <Tabs
        tabs={tabItems}
        value={tab}
        ariaLabel={t('compare.title')}
        onChange={(id) => {
          if (id === 'saved') {
            setTab('saved')
            void loadSaved()
          } else if (id === 'suggestions') setTab('suggestions')
          else setTab('report')
        }}
      />

      <div className="pd-cmp-panes">
        {tab === 'report' ? renderReportTab() : tab === 'saved' ? renderSavedTab() : renderSuggestionsTab()}
      </div>

      {notice !== null ? (
        <div
          className="pd-cmp-notice"
          data-kind={notice.kind}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  )

  if (!open) return null

  return (
    <div
      className="pd-cmp-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('compare.title')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="pd-cmp-panel" ref={panelRef} tabIndex={-1}>
        <header className="pd-cmp-head">
          <div className="pd-cmp-head-text">
            <h2 className="pd-cmp-title">{t('compare.title')}</h2>
            <span className="pd-cmp-subtitle">
              {step === 'pick'
                ? t('compare.pickHint')
                : formatTemplate(t('compare.workHint'), { n: selectedIds.length })}
            </span>
          </div>
          <div className="pd-cmp-head-actions">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('compare.close')}
            </Button>
          </div>
        </header>
        {step === 'pick' ? renderPicker() : renderWork()}
      </div>
    </div>
  )
}

/* ── misc ──────────────────────────────────────────────────────────────── */

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) return false
  }
  return true
}
