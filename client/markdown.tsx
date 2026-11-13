/**
 * Markdown rendering for the notes preview.
 *
 * `marked` renders GFM; raw HTML is escaped (no `dangerouslySetInnerHTML`
 * bypass of tags) and link/image URLs with a dangerous scheme are refused, so
 * a note written by another device cannot inject markup or script.
 */
import { useMemo } from 'react'
import { mathExtensions } from './markdownMath.js'
import { Marked } from 'marked'
import type { RendererObject } from 'marked'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Allow http(s), mailto, fragment and relative paths; reject other schemes. */
function safeUrl(href: string): string | null {
  const url = href.trim()
  if (url === '') return null
  if (/^(https?:|mailto:)/i.test(url)) return url
  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null
  return url
}

function titleAttr(title: string | null | undefined): string {
  return typeof title === 'string' && title.length > 0 ? ` title="${escapeHtml(title)}"` : ''
}

const renderer: RendererObject = {
  html({ text }) {
    return escapeHtml(text)
  },
  link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens)
    const safe = safeUrl(href)
    if (safe === null) return label
    return `<a href="${escapeHtml(safe)}"${titleAttr(title)} target="_blank" rel="noopener noreferrer">${label}</a>`
  },
  image({ href, title, text }) {
    const safe = safeUrl(href)
    if (safe === null) return escapeHtml(text)
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttr(title)} loading="lazy" />`
  },
}

const marked = new Marked({ gfm: true, breaks: true, renderer, extensions: mathExtensions })

/**
 * Render a long Markdown document section by section at top-level `##`
 * headings. A preceding loose list would otherwise make the next heading a
 * child of its last list item, which visually indents section headings in the
 * notes preview. Fenced code blocks are never split.
 */
function markdownSections(markdown: string): { markdown: string; offset: number }[] {
  const chunks: { markdown: string; offset: number }[] = []
  let start = 0
  let offset = 0
  let fence: { marker: string; length: number } | null = null
  for (const line of markdown.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (match) {
      const delimiter = match[1] ?? ''
      if (fence === null) fence = { marker: delimiter[0] ?? '', length: delimiter.length }
      else if (delimiter[0] === fence.marker && delimiter.length >= fence.length && !match[2]?.trim()) fence = null
    }
    if (fence === null && /^##\s+/.test(line) && offset > start) {
      chunks.push({ markdown: markdown.slice(start, offset), offset: start })
      start = offset
    }
    offset += line.length + 1
  }
  if (start < markdown.length) chunks.push({ markdown: markdown.slice(start), offset: start })
  return chunks
}

export function renderMarkdownSectioned(markdown: string): string {
  return markdownSections(markdown).map((chunk) => renderMarkdown(chunk.markdown)).join('\n')
}

/** Use the same section boundaries as the preview, including notes after loose lists. */
export function noteOutline(markdown: string): { label: string; offset: number }[] {
  const result: { label: string; offset: number }[] = []
  for (const chunk of markdownSections(markdown)) {
    let cursor = 0
    for (const token of marked.lexer(chunk.markdown)) {
      const offset = chunk.markdown.indexOf(token.raw, cursor)
      if (offset < 0) continue
      cursor = offset + token.raw.length
      if (token.type === 'heading' && token.depth === 2) {
        result.push({ label: token.text, offset: chunk.offset + offset })
      }
    }
  }
  return result
}

/** Render markdown to a safe HTML string (never throws). */
export function renderMarkdown(markdown: string): string {
  try {
    const html = marked.parse(markdown)
    return typeof html === 'string' ? html : escapeHtml(markdown)
  } catch {
    return `<p>${escapeHtml(markdown)}</p>`
  }
}

export interface MarkdownProps {
  markdown: string
  className?: string
}

/** Rendered markdown block (used by the notes preview). */
export function Markdown({ markdown, className }: MarkdownProps) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  const cls = className === undefined ? 'pd-md' : `pd-md ${className}`
  return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />
}
