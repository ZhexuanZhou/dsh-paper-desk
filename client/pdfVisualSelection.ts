export interface VisualCaret { left: number; top: number; width: number; height: number }
interface Bounds { left: number; top: number; right: number; bottom: number; width: number; height: number }

export function textCaretOffsets(text: string): number[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(({ index }) => index).concat(text.length)
}

/** PDF spans have no browser line layout. Navigate their rendered geometry. */
export function verticalTextTarget<T extends Bounds>(current: Bounds, candidates: readonly T[], x: number, direction: 'forward' | 'backward'): T | null {
  const sign = direction === 'forward' ? 1 : -1
  const center = current.top + current.height / 2
  let best: T | null = null
  let bestScore = Infinity
  for (const rect of candidates) {
    const dy = sign * (rect.top + rect.height / 2 - center)
    // Ignore fragments and superscripts belonging to the current visual line.
    if (dy <= Math.max(2, current.height * .6)) continue
    const dx = Math.max(rect.left - x, 0, x - rect.right)
    const score = dy + dx * 2
    if (score < bestScore) { best = rect; bestScore = score }
  }
  return best
}

export function moveSelectionVertically(selection: Selection, root: HTMLElement, direction: 'forward' | 'backward', preferredX?: number, extend = false): number | null {
  const node = selection.focusNode
  if (!node) return null
  const current = selectionEndpointRect(node, selection.focusOffset, root)
  if (!current) return null
  const doc = root.ownerDocument
  const x = preferredX ?? current.left
  type TextBounds = Bounds & { node: Text }
  const collect = (scope: Element): TextBounds[] => {
    const result: TextBounds[] = []
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
    let text: Node | null
    while ((text = walker.nextNode())) {
      if (!text.textContent?.trim() || !text.parentElement?.closest('.textLayer')) continue
      const range = doc.createRange()
      range.selectNodeContents(text)
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) result.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, node: text as Text })
      }
    }
    return result
  }
  const layer = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest('.textLayer')
  if (!layer) return null
  const target = verticalTextTarget(current, collect(layer), x, direction)
    ?? verticalTextTarget(current, collect(root), x, direction)
  if (!target) return null
  // A line may be shorter than the previous one. Clamp this step, retaining x
  // for the following step so a short line does not cause horizontal drift.
  let offset = 0
  let distance = Infinity
  const range = doc.createRange()
  for (const i of textCaretOffsets(target.node.data)) {
    range.setStart(target.node, i)
    range.collapse(true)
    for (const rect of range.getClientRects()) {
      const dy = Math.abs(rect.top + rect.height / 2 - (target.top + target.height / 2))
      const score = Math.abs(rect.left - x) + dy * 2
      if (score < distance) { offset = i; distance = score }
    }
  }
  if (!Number.isFinite(distance)) return null
  if (extend && selection.anchorNode) selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, target.node, offset)
  else selection.collapse(target.node, offset)
  return x
}

/** Reposition at the active end; unlike extend, this starts a new collapsed range. */
export function moveSelectionCaret(selection: Pick<Selection, 'focusNode' | 'focusOffset' | 'isCollapsed' | 'collapse'> & {
  modify?: (alter: string, direction: string, granularity: string) => void
}, granularity: 'character', direction: 'forward' | 'backward'): boolean {
  if (!selection.focusNode || !selection.modify) return false
  try {
    if (!selection.isCollapsed) selection.collapse(selection.focusNode, selection.focusOffset)
    selection.modify('move', direction, granularity)
    return true
  } catch { return false }
}

/** Browser ranges already include PDF zoom, page transforms and text direction. */
export function visualCaretPosition(rect: Bounds, root: Bounds, viewport: Bounds): VisualCaret | null {
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || (rect.width <= 0 && rect.height <= 0)) return null
  if (rect.right < viewport.left || rect.left > viewport.right || rect.bottom < viewport.top || rect.top > viewport.bottom) return null
  const horizontal = rect.width > rect.height
  return { left: rect.left - root.left, top: rect.top - root.top,
    width: horizontal ? Math.max(8, rect.width) : 2,
    height: horizontal ? 2 : Math.max(8, rect.height) }
}

export function selectionEndpointRect(node: Node | null, offset: number, root: HTMLElement): DOMRect | null {
  if (!node || !node.isConnected || !root.contains(node)) return null
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  if (!element?.closest('.textLayer')) return null
  try {
    const range = document.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    const rect = [...range.getClientRects()].find((entry) => entry.width > 0 || entry.height > 0)
    if (rect) return rect
    // selectNodeContents(span).collapse() uses an element boundary. Resolve the
    // adjacent text node without inventing a position from the whole span box.
    if (node.nodeType !== Node.ELEMENT_NODE) return null
    const child = node.childNodes[offset] ?? node.childNodes[offset - 1]
    if (!child) return null
    const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT)
    let text = child.nodeType === Node.TEXT_NODE ? child : walker.nextNode()
    if (offset >= node.childNodes.length) {
      let next: Node | null
      while ((next = walker.nextNode())) text = next
    }
    if (!text) return null
    range.setStart(text, offset >= node.childNodes.length ? text.textContent?.length ?? 0 : 0)
    range.collapse(true)
    return [...range.getClientRects()].find((entry) => entry.width > 0 || entry.height > 0) ?? null
  } catch { return null }
}
