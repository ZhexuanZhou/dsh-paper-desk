import type { AnnotationRect } from '../src/types.js'
import type { PdfViewportLike } from './pdfjs.js'

/** Convert PDF coordinates before normalising; never treat PDF points as CSS pixels. */
export function normaliseLinkRect(
  viewport: Pick<PdfViewportLike, 'width' | 'height' | 'convertToViewportPoint'>,
  rect: readonly number[],
): AnnotationRect | null {
  const { width, height } = viewport
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      rect.length < 4 || !rect.slice(0, 4).every(Number.isFinite) ||
      typeof viewport.convertToViewportPoint !== 'function') return null

  try {
    // PageViewport handles page rotation, cropping, user units, scaling and Y inversion.
    const a = viewport.convertToViewportPoint(rect[0]!, rect[1]!)
    const b = viewport.convertToViewportPoint(rect[2]!, rect[3]!)
    const x1 = a[0] ?? NaN, y1 = a[1] ?? NaN
    const x2 = b[0] ?? NaN, y2 = b[1] ?? NaN
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null
    const left = Math.max(0, Math.min(width, Math.min(x1, x2)))
    const right = Math.max(0, Math.min(width, Math.max(x1, x2)))
    const top = Math.max(0, Math.min(height, Math.min(y1, y2)))
    const bottom = Math.max(0, Math.min(height, Math.max(y1, y2)))
    if (right <= left || bottom <= top) return null
    return { x: left / width, y: top / height, w: (right - left) / width, h: (bottom - top) / height }
  } catch {
    // An unsupported/broken transform must not create a clickable region in the wrong place.
    return null
  }
}
