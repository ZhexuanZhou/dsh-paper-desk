export interface ReproductionDraft { markdown: string; instructions: string; baseHash: string }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const memory = new Map<string, ReproductionDraft>()
const failed = new Set<string>()
export function reproductionDraftKey(library: string, id: string): string { return `paperdesk:reproduction-draft:${library}:${id}` }
export function readReproductionDraft(store: Store | null, key: string): ReproductionDraft | null {
  if (failed.has(key)) return memory.get(key) ?? null
  try {
    const draft = JSON.parse(store?.getItem(key) ?? 'null') as ReproductionDraft | null
    if (draft && typeof draft.markdown === 'string' && draft.markdown.length <= 120000 && typeof draft.instructions === 'string' && draft.instructions.length <= 4000 && typeof draft.baseHash === 'string') return draft
  } catch { /* Never replace a library document with malformed browser data. */ }
  return memory.get(key) ?? null
}
export function writeReproductionDraft(store: Store | null, key: string, draft: ReproductionDraft | null): boolean {
  if (draft) memory.set(key, draft); else memory.delete(key)
  try {
    if (!store) throw new Error('storage unavailable')
    if (draft) store.setItem(key, JSON.stringify(draft)); else store.removeItem(key)
    failed.delete(key); return true
  } catch { failed.add(key); return false }
}
