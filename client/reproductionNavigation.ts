/** Discard may undo this editor's in-flight save, never someone else's write. */
export function reproductionDiscardAction(baselineHash: string, currentHash: string, lastOwnHash: string): 'unchanged' | 'restore' | 'conflict' {
  if (currentHash === baselineHash) return 'unchanged'
  return currentHash === lastOwnHash ? 'restore' : 'conflict'
}
