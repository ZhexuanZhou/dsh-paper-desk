import type { NoteCard } from '../src/types.js'

/** History preserves raw documents; malformed legacy data must not crash preview. */
export function historyCardPreview(content: string): NoteCard[] | null {
  try {
    const value: unknown = JSON.parse(content)
    if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) return null
    if (!value.items.every((c: unknown) => c && typeof c === 'object' &&
      'id' in c && typeof c.id === 'string' && 'title' in c && typeof c.title === 'string' && 'body' in c && typeof c.body === 'string' &&
      'tags' in c && Array.isArray(c.tags) && c.tags.every((v: unknown) => typeof v === 'string') &&
      'pages' in c && Array.isArray(c.pages) && c.pages.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0))) return null
    return value.items as NoteCard[]
  } catch { return null }
}
