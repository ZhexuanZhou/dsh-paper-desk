/** One non-empty URL or arXiv identifier per line; query strings are preserved. */
export function parseImportLinks(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}
export interface LinkImportItem {
  url: string
  state: 'queued' | 'running' | 'success' | 'duplicate' | 'error'
  title?: string
  error?: string
}

/** A successful retry closes the dialog only when no other unresolved items remain. */
export function allLinkImportsResolved(previous: readonly LinkImportItem[], attempted: readonly string[], succeeded: number): boolean {
  if (!attempted.length || succeeded !== attempted.length) return false
  const touched = new Set(attempted)
  return previous.every((item) => touched.has(item.url) || item.state === 'success' || item.state === 'duplicate')
}
/** Sequential requests preserve upstream rate limits; one failure never drops later links. */
export async function runLinkImports<T extends { duplicated: boolean; meta: { title: string } }>(
  urls: readonly string[], run: (url: string) => Promise<T>, update: (item: LinkImportItem) => void,
): Promise<T[]> {
  const successes: T[] = []
  for (const url of urls) {
    update({ url, state: 'running' })
    try {
      const result = await run(url)
      successes.push(result)
      update({ url, state: result.duplicated ? 'duplicate' : 'success', title: result.meta.title })
    } catch (error) {
      update({ url, state: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return successes
}
