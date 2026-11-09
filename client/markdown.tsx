/**
 * Markdown rendering for the notes preview.
 *
 * `marked` renders GFM; raw HTML is escaped (no `dangerouslySetInnerHTML`
 * bypass of tags) and link/image URLs with a dangerous scheme are refused, so
 * a note written by another device cannot inject markup or script.
 */
import { useMemo } from 'react'
import katex from 'katex'
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

/** Kinds of formulas worth passing to KaTeX (avoids treating `$5` as math). */
function looksLikeMath(source: string): boolean {
  const trimmed = source.trim()
  if (trimmed === '' || trimmed.length > 500) return false
  // Bare identifiers such as $x$ / $v$ are common in ELF-style answers and
  // must be typeset too; require a letter so "$5" stays currency.
  if (!/[a-zA-Z\u0370-\u03ff]/.test(trimmed)) return false
  if (/[\\^_{}=]/.test(trimmed)) return true
  if (/\\[a-zA-Z]+/.test(trimmed)) return true
  return /^[a-zA-Z\u0370-\u03ff][a-zA-Z0-9\u0370-\u03ff\s*+\-/().,'’]*$/.test(trimmed)
}

/**
 * Render Markdown with inline/display LaTeX typeset by KaTeX. Formulas are
 * replaced by placeholders before marked runs (so Markdown escaping cannot
 * break them), then expanded to MathML. Code spans/fences are protected too.
 */
function renderMarkdownWithMath(markdown: string): string {
  const codeParts: string[] = []
  const mathParts: string[] = []
  const codeToken = (index: number): string => `PAPERDESKCODEBLOCK${index}`
  const mathToken = (index: number): string => `PAPERDESKMATHFORMULA${index}`

  let text = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, (block) => {
    codeParts.push(block)
    return ` ${codeToken(codeParts.length - 1)} `
  })
  text = text.replace(/`[^`\n]*`/g, (span) => {
    codeParts.push(span)
    return ` ${codeToken(codeParts.length - 1)} `
  })

  const replaceMath = (source: string, displayMode: boolean): string => {
    if (!looksLikeMath(source)) return displayMode ? `$$${source}$$` : `$${source}$`
    try {
      const rendered = katex.renderToString(source, {
        displayMode,
        output: 'mathml',
        throwOnError: false,
        strict: 'ignore',
      })
      mathParts.push(rendered)
      return ` ${mathToken(mathParts.length - 1)} `
    } catch {
      return displayMode ? `$$${source}$$` : `$${source}$`
    }
  }

  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, source: string) => replaceMath(source, true))
  text = text.replace(/\$([^$\n]{1,400}?)\$/g, (_match, source: string) => replaceMath(source, false))

  const html = marked.parse(text)
  const rendered = typeof html === 'string' ? html : escapeHtml(text)
  return rendered
    .replace(/PAPERDESKMATHFORMULA(\d+)/g, (_m, index: string) => mathParts[Number(index)] ?? '')
    .replace(/PAPERDESKCODEBLOCK(\d+)/g, (_m, index: string) => {
      const original = codeParts[Number(index)] ?? ''
      if (original.startsWith('```') || original.startsWith('~~~')) {
        const body = original.replace(/^(```|~~~)[^\n]*\n?/, '').replace(/\n?(```|~~~)\s*$/, '')
        return `<pre><code>${escapeHtml(body)}</code></pre>`
      }
      return `<code>${escapeHtml(original.replace(/^`|`$/g, ''))}</code>`
    })
}

/** Render markdown to a safe HTML string (never throws). */
export function renderMarkdown(markdown: string): string {
  try {
    return renderMarkdownWithMath(markdown)
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
