/**
 * Markdown rendering for the notes preview.
 *
 * `marked` renders GFM; raw HTML is escaped (no `dangerouslySetInnerHTML`
 * bypass of tags) and link/image URLs with a dangerous scheme are refused, so
 * a note written by another device cannot inject markup or script.
 */
import { useMemo } from 'react'
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

const marked = new Marked({ gfm: true, breaks: true, renderer })

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
