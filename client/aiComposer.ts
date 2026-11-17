export interface ComposerOptions { pages: number[] }

/** Freeze explicit page numbers when attached, rather than following PDF navigation. */
export function parseImagePages(input: string, currentPage: number, pageCount: number | null): number[] | null {
  const tokens = input.trim() ? input.trim().split(/[,，\s]+/).filter(Boolean) : [String(currentPage)]
  if (!tokens.every((token) => /^\d+$/.test(token))) return null
  const pages = [...new Set(tokens.map(Number))]
  if (!pages.length || pages.length > 3 || pages.some((page) => !Number.isSafeInteger(page) || page < 1 || (pageCount !== null && page > pageCount))) return null
  return pages
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readComposerOptions(storage: StorageLike, key: string | null, pageCount: number | null): ComposerOptions {
  if (key === null) return { pages: [] }
  try {
    const value: unknown = JSON.parse(storage.getItem(`${key}:options`) ?? 'null')
    if (value === null || typeof value !== 'object') return { pages: [] }
    const record = value as Record<string, unknown>
    const pages = Array.isArray(record.pages) && record.pages.every((page) => typeof page === 'number')
      ? parseImagePages(record.pages.join(','), 0, pageCount) ?? [] : []
    return { pages }
  } catch { return { pages: [] } }
}

export function writeComposerOptions(storage: StorageLike, key: string | null, options: ComposerOptions): void {
  if (key === null) return
  try {
    if (options.pages.length === 0) storage.removeItem(`${key}:options`)
    else storage.setItem(`${key}:options`, JSON.stringify(options))
  } catch { /* Draft persistence is optional. */ }
}

/** An asynchronous acceptance must not erase a newer draft in this chat. */
export function clearAcceptedDraft(storage: StorageLike, key: string | null, sentText: string, options: ComposerOptions): void {
  if (key === null) return
  try {
    if ((storage.getItem(key) ?? '') === sentText) storage.removeItem(key)
    const stored = readComposerOptions(storage, key, null)
    if (JSON.stringify(stored.pages) === JSON.stringify(options.pages)) storage.removeItem(`${key}:options`)
  } catch { /* Keep the in-memory composer usable when storage is unavailable. */ }
}

/** Bring an answer passage into the ordinary editable composer; never send it here. */
export function appendQuotedComment(draft: string, quote: string, comment: string, label: string, previousComment?: string): string {
  if (!quote.trim()) return draft
  const quoted = quote.trim().replace(/\r\n?/g, '\n').split('\n').map((line) => `> ${line}`).join('\n')
  const context = `${label}：\n${quoted}${comment.trim() ? `\n\n${comment.trim()}` : ''}`
  if (previousComment !== undefined) {
    const previous = `${label}：\n${quoted}${previousComment.trim() ? `\n\n${previousComment.trim()}` : ''}`
    const index = draft.indexOf(previous)
    if (index >= 0 && draft.indexOf(previous, index + previous.length) < 0) {
      const startsBlock = index === 0 || draft.slice(0, index).endsWith('\n\n')
      const rest = draft.slice(index + previous.length)
      if (startsBlock && (!rest || rest.startsWith('\n\n'))) return draft.slice(0, index) + context + rest
    }
  }
  return draft.trim() ? `${draft}\n\n${context}` : context
}
