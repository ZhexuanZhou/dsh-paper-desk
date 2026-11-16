import type { AiRow } from './aiSession.js'

export type DisplayItem = { kind: 'row'; row: AiRow } | { kind: 'process'; id: string; rows: AiRow[] }

/** Fold adjacent processing events without crossing a user/answer/error boundary. */
export function groupProcessingRows(rows: readonly AiRow[]): DisplayItem[] {
  const items: DisplayItem[] = []
  for (const row of rows) {
    if (row.kind !== 'reasoning' && row.kind !== 'tool') {
      items.push({ kind: 'row', row })
      continue
    }
    const previous = items[items.length - 1]
    if (previous?.kind === 'process') previous.rows.push(row)
    else items.push({ kind: 'process', id: row.id, rows: [row] })
  }
  return items
}
