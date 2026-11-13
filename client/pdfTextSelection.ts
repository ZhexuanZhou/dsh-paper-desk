import type { AnnotationRect } from '../src/types.js'

/** Merge only touching, equal-font horizontal runs without losing original PDF metrics. */
export function mergeTextItems(items: readonly unknown[]): unknown[] {
  const out: Record<string, unknown>[] = []
  let current: Record<string, unknown> | null = null
  const flush = (): void => {
    if (current !== null) out.push(current)
    current = null
  }
  for (const raw of items) {
    if (raw === null || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.str !== 'string') { flush(); out.push({ ...item }); continue }
    if (item.str.length === 0) continue
    const transform = Array.isArray(item.transform) ? (item.transform as number[]) : null
    const x = transform?.[4]
    const y = transform?.[5]
    const width = typeof item.width === 'number' ? item.width : 0
    if (current === null || transform === null || x === undefined || y === undefined) {
      flush()
      current = { ...item }
      if (current !== null) current.width = width
      continue
    }
    const curTransform = Array.isArray(current.transform) ? (current.transform as number[]) : null
    const curX = curTransform?.[4]
    const curY = curTransform?.[5]
    const curWidth = typeof current.width === 'number' ? current.width : 0
    const sameFont = current.fontName === item.fontName && current.dir === item.dir
    const tolerance = Math.max(0.01, (typeof item.height === 'number' ? item.height : 10) * 0.02)
    const sameLine = curY !== undefined && Math.abs(y - curY) <= tolerance
    const sameTransform = curTransform !== null && transform.slice(0, 4).every((value, index) => Math.abs(value - (curTransform[index] ?? NaN)) <= 1e-5 * Math.max(1, Math.abs(value)))
    const horizontal = item.dir === 'ltr' && Math.abs(transform[1] ?? 0) < 1e-6 && Math.abs(transform[2] ?? 0) < 1e-6
    const gap = curX !== undefined ? x - (curX + curWidth) : Number.POSITIVE_INFINITY
    if (current.hasEOL !== true && sameFont && sameLine && sameTransform && horizontal && Math.abs(gap) <= tolerance) {
      current.str = `${String(current.str ?? '')}${item.str}`
      if (curX !== undefined) current.width = x + width - curX
      current.hasEOL = item.hasEOL
      if (item.hasEOL === true) flush()
      continue
    }
    flush()
    current = { ...item }
    if (current !== null) current.width = width
    if (item.hasEOL === true) flush()
  }
  flush()
  // Preserve PDF widths: TextLayer needs them to calibrate horizontal glyph scaling.
  return out
}

interface TextPosition { segment: number; offset: number }

/** Exact text matching with whitespace normalisation, retaining DOM character offsets. */
export function findUniqueQuote(segments: readonly string[], quote: string): { start: TextPosition; end: TextPosition } | null {
  const characters: string[] = []
  const positions: TextPosition[] = []
  segments.forEach((segment, index) => {
    for (let offset = 0; offset < segment.length; offset++) {
      const character = /\s/.test(segment[offset] ?? '') ? ' ' : segment[offset]!
      if (character === ' ' && characters.at(-1) === ' ') continue
      characters.push(character)
      positions.push({ segment: index, offset })
    }
  })
  const text = characters.join('')
  const needle = quote.replace(/\s+/g, ' ').trim()
  if (!needle) return null
  const index = text.indexOf(needle)
  if (index < 0 || text.indexOf(needle, index + 1) >= 0) return null
  const start = positions[index], last = positions[index + needle.length - 1]
  return start && last ? { start, end: { segment: last.segment, offset: last.offset + 1 } } : null
}

type PageBounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
type ClientBox = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>

export function normaliseTextRects(boxes: readonly ClientBox[], page: PageBounds): AnnotationRect[] {
  if (![page.left, page.top, page.width, page.height].every(Number.isFinite) || page.width <= 0 || page.height <= 0) return []
  const rects: AnnotationRect[] = []
  for (const box of boxes) {
    if (![box.left, box.top, box.right, box.bottom].every(Number.isFinite)) continue
    const left = Math.max(box.left, page.left), top = Math.max(box.top, page.top)
    const right = Math.min(box.right, page.left + page.width), bottom = Math.min(box.bottom, page.top + page.height)
    if (right - left < 0.5 || bottom - top < 0.5) continue
    const rect = { x: (left - page.left) / page.width, y: (top - page.top) / page.height, w: (right - left) / page.width, h: (bottom - top) / page.height }
    if (!rects.some((previous) => (['x', 'y', 'w', 'h'] as const).every((key) => Math.abs(previous[key] - rect[key]) < 1e-7))) rects.push(rect)
  }
  return rects
}

/** Collect selected glyph runs, excluding ancestor element boxes returned by a whole Range. */
export function rangeTextRects(range: Range, layer: HTMLElement, page: PageBounds): AnnotationRect[] {
  const boxes: DOMRect[] = []
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.textContent || !range.intersectsNode(node)) continue
    const part = layer.ownerDocument.createRange()
    part.selectNodeContents(node)
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset)
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset)
    if (!part.collapsed) boxes.push(...part.getClientRects())
  }
  return normaliseTextRects(boxes, page)
}

/** Re-anchor only an unambiguous saved quote; never alter the stored annotation. */
export function quoteTextRects(layer: HTMLElement, page: PageBounds, quote: string): AnnotationRect[] | null {
  const nodes: (Node | null)[] = []
  const segments: string[] = []
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      nodes.push(node); segments.push(node.textContent)
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      nodes.push(null); segments.push(' ')
    }
  }
  const match = findUniqueQuote(segments, quote)
  if (!match) return null
  const start = nodes[match.start.segment], end = nodes[match.end.segment]
  if (!start || !end) return null
  const range = layer.ownerDocument.createRange()
  range.setStart(start, match.start.offset)
  range.setEnd(end, match.end.offset)
  const rects = rangeTextRects(range, layer, page)
  return rects.length ? rects : null
}
