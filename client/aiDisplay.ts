import type { AiRow } from './aiSession.js'

export interface ConversationTurn {
  id: string
  question: AiRow | null
  rows: AiRow[]
}

/** Keep each question and its reply together without discarding or mutating events. */
export function groupConversationTurns(rows: readonly AiRow[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  for (const row of rows) {
    if (row.kind === 'user') {
      turns.push({ id: row.id, question: row, rows: [] })
    } else {
      let turn = turns[turns.length - 1]
      if (!turn) {
        turn = { id: row.id, question: null, rows: [] }
        turns.push(turn)
      }
      turn.rows.push(row)
    }
  }
  return turns
}
