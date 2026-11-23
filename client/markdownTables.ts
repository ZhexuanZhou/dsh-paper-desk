import { Tokenizer } from 'marked'
import type { RendererObject, TokenizerObject, TokenizerAndRendererExtension, Tokens } from 'marked'
import { inlineMathToken, mathExtensions } from './markdownMath.js'

/** Only protect literal code/math spans; real GFM cell boundaries are unchanged. */
function protectLiteralPipes(source: string, marker: string): string {
  let output = '', index = 0
  while (index < source.length) {
    if (source[index] === '`') {
      const opening = /^`+/.exec(source.slice(index))![0]
      const runs = /`+/g
      runs.lastIndex = index + opening.length
      const lineEnd = source.indexOf('\n', runs.lastIndex)
      let closing: RegExpExecArray | null
      while ((closing = runs.exec(source))) {
        if (lineEnd >= 0 && closing.index > lineEnd) { closing = null; break }
        if (closing[0].length !== opening.length) continue
        const end = closing.index + closing[0].length
        // Already escaped GFM pipes retain their standard interpretation.
        output += source.slice(index, end).replace(/\|/g, (pipe, offset: number, text: string) => {
          let slashes = 0
          for (let cursor = offset - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) slashes++
          return slashes % 2 ? pipe : marker
        })
        index = end
        break
      }
      if (closing) continue
      output += opening; index += opening.length; continue
    }
    const math = inlineMathToken(source.slice(index))
    if (math) { output += math.raw.replaceAll('|', marker); index += math.raw.length; continue }
    if (source[index] === '\\' && index + 1 < source.length) { output += source.slice(index, index + 2); index += 2; continue }
    output += source[index]; index++
  }
  return output
}

function cellCount(line: string): number {
  const text = line.trim()
  let count = 1, slashes = 0, lastBoundary = -1
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '|' && slashes % 2 === 0) { count++; lastBoundary = index }
    slashes = char === '\\' ? slashes + 1 : 0
  }
  if (text.startsWith('|')) count--
  if (lastBoundary === text.length - 1) count--
  return count
}

/** Per-render markers never enter stored Markdown, clipboard text, or source offsets. */
export function literalTableSupport(source: string): { tokenizer: TokenizerObject; renderer: RendererObject; extensions: TokenizerAndRendererExtension[]; restore: (text: string) => string } {
  let marker = 'PAPERDESK_LITERAL_PIPE'
  while (source.includes(marker)) marker += 'X'
  const restore = (text: string) => text.replaceAll(marker, '|')
  const overflow = new WeakMap<Tokens.Table, Map<number, Tokens.TableCell>>()
  return {
    restore,
    renderer: {
      table(token) {
        const originals = overflow.get(token)
        if (!originals) return false
        const header = this.tablerow({ text: token.header.map((cell) => this.tablecell(cell)).join('') })
        const rows = token.rows.map((row, index) => {
          const original = originals.get(index)
          if (!original) return this.tablerow({ text: row.map((cell) => this.tablecell(cell)).join('') })
          // GFM silently discards excess cells. Preserve the complete row instead
          // of guessing which unescaped pipes were intended as column boundaries.
          return `<tr class="pd-md-table-overflow"><td colspan="${token.header.length}"><small>原文 / Source</small><div>${this.parser.parseInline(original.tokens)}</div></td></tr>\n`
        }).join('')
        return `<table>\n<thead>${header}</thead>\n<tbody>${rows}</tbody>\n</table>\n`
      },
    },
    tokenizer: {
      table(input) {
        const firstEnd = input.indexOf('\n')
        if (firstEnd < 0 || !input.slice(0, firstEnd).includes('|')) return false
        const secondEnd = input.indexOf('\n', firstEnd + 1)
        const delimiter = input.slice(firstEnd + 1, secondEnd < 0 ? input.length : secondEnd).trim()
        if (!delimiter.includes('|') || !delimiter.includes('-') || !/^[|:\-\s]+$/.test(delimiter)) return false
        const protectedInput = protectLiteralPipes(input, marker)
        const token = Tokenizer.prototype.table.call(this, protectedInput)
        if (token) {
          const originals = new Map<number, Tokens.TableCell>()
          const lines = token.raw.trimEnd().split('\n').slice(2)
          for (let index = 0; index < token.rows.length; index++) {
            const line = lines[index]
            if (line && cellCount(line) > token.header.length) originals.set(index, { text: line, tokens: this.lexer.inline(line), header: false, align: null })
          }
          if (originals.size) overflow.set(token, originals)
          token.raw = restore(token.raw)
        }
        return token ?? false
      },
    },
    extensions: mathExtensions.map((extension) => {
      if (!('renderer' in extension)) return extension
      const render = extension.renderer
      return { ...extension, renderer(token) { return render.call(this, { ...token, text: typeof token.text === 'string' ? restore(token.text) : token.text, raw: restore(token.raw) }) } }
    }),
  }
}
