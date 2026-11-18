/** Scroll by this amount to keep the same fractional position within a resized page. */
export function pdfAnchorScrollDelta(pageTop: number, viewportTop: number, pageHeight: number, fraction: number): number {
  return pageTop - viewportTop + fraction * pageHeight
}
