export const QUICK_TASKS = ['summary', 'method', 'critique', 'related', 'questions'] as const
export type QuickTask = typeof QUICK_TASKS[number]
export interface ComposerOptions { task: QuickTask | null; pages: number[] }

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
  if (key === null) return { task: null, pages: [] }
  try {
    const value: unknown = JSON.parse(storage.getItem(`${key}:options`) ?? 'null')
    if (value === null || typeof value !== 'object') return { task: null, pages: [] }
    const record = value as Record<string, unknown>
    const task = QUICK_TASKS.includes(record.task as QuickTask) ? record.task as QuickTask : null
    const pages = Array.isArray(record.pages) && record.pages.every((page) => typeof page === 'number')
      ? parseImagePages(record.pages.join(','), 0, pageCount) ?? [] : []
    return { task, pages }
  } catch { return { task: null, pages: [] } }
}

export function writeComposerOptions(storage: StorageLike, key: string | null, options: ComposerOptions): void {
  if (key === null) return
  try {
    if (options.task === null && options.pages.length === 0) storage.removeItem(`${key}:options`)
    else storage.setItem(`${key}:options`, JSON.stringify(options))
  } catch { /* Draft persistence is optional. */ }
}

/** An asynchronous acceptance must not erase a newer draft in this chat. */
export function clearAcceptedDraft(storage: StorageLike, key: string | null, sentText: string, options: ComposerOptions): void {
  if (key === null) return
  try {
    if ((storage.getItem(key) ?? '') === sentText) storage.removeItem(key)
    if (storage.getItem(`${key}:options`) === JSON.stringify(options)) storage.removeItem(`${key}:options`)
  } catch { /* Keep the in-memory composer usable when storage is unavailable. */ }
}
