import katex from 'katex'
import type { TokenizerAndRendererExtension } from 'marked'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function closingDelimiter(source: string, delimiter: string, offset: number): number {
  let index = source.indexOf(delimiter, offset)
  while (index >= 0) {
    let backslashes = 0
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) backslashes++
    if (backslashes % 2 === 0) return index
    index = source.indexOf(delimiter, index + delimiter.length)
  }
  return -1
}

/** Dollar prose such as "$5 and $10" must remain prose. Explicit TeX is unambiguous. */
function dollarMath(text: string): boolean {
  return text.trim() === text && /[a-zA-Z\u0370-\u03ff\\^_{}=<>+*/|]/.test(text)
}

function renderMath(text: string, raw: string, display: boolean, block: boolean): string {
  try {
    const html = katex.renderToString(text, {
      displayMode: display, output: 'mathml', throwOnError: true,
      strict: 'ignore', trust: false,
    })
    // MathML-only output has a KaTeX HTML wrapper. Use our own wrapper so the
    // host's unrelated .katex font/hiding rules cannot alter native MathML.
    const start = html.indexOf('<math ')
    const end = html.lastIndexOf('</math>')
    if (start < 0 || end < start) return escapeHtml(raw)
    const math = html.slice(start, end + '</math>'.length)
    if (block) return `<div class="pd-math-block">${math}</div>\n`
    return `<span class="pd-math-inline${display ? ' pd-math-display' : ''}">${math}</span>`
  } catch { return escapeHtml(raw) }
}

/** Let Marked protect code, links, lists and fences before tokenizing formulas. */
export const mathExtensions: TokenizerAndRendererExtension[] = [
  {
    name: 'pdMathBlock', level: 'block',
    start(source) { return source.search(/^ {0,3}(?:\$\$|\\\[)/m) },
    tokenizer(source) {
      const opening = /^ {0,3}(\$\$|\\\[)/.exec(source)
      if (!opening) return
      const close = opening[1] === '$$' ? '$$' : '\\]'
      const end = closingDelimiter(source, close, opening[0].length)
      if (end < 0) return
      const text = source.slice(opening[0].length, end).trim()
      const suffix = /^[ \t]*(?:\r?\n|$)/.exec(source.slice(end + close.length))
      if (!suffix || !text || text.length > 10_000) return
      return { type: 'pdMathBlock', raw: source.slice(0, end + close.length + suffix[0].length), text }
    },
    renderer(token) { return renderMath(String(token.text), token.raw, true, true) },
  },
  {
    name: 'pdMathInline', level: 'inline',
    start(source) { return source.search(/\$|\\\(/) },
    tokenizer(source) {
      const open = source.startsWith('\\(') ? '\\(' : source.startsWith('$$') ? '$$' : source.startsWith('$') ? '$' : null
      if (open === null) return
      const close = open === '\\(' ? '\\)' : open
      const end = closingDelimiter(source, close, open.length)
      if (end < 0) return
      const text = source.slice(open.length, end)
      if (!text.trim() || text.length > 1_000 || text.includes('\n')) return
      if (open === '$' && (!dollarMath(text) || /\d/.test(source[end + 1] ?? ''))) return
      return { type: 'pdMathInline', raw: source.slice(0, end + close.length), text, display: open === '$$' }
    },
    renderer(token) { return renderMath(String(token.text), token.raw, token.display === true, false) },
  },
]
