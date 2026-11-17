import type { ConversationTurn } from './aiDisplay.js'
import type { AiRow, TopicMutation } from './aiSession.js'
/** Only confirmed successful writes produce receipts. Requests and model claims do not. */
export function topicMutations(rows: readonly AiRow[], topicId: string): TopicMutation[] {
  const result: TopicMutation[] = []
  for (const row of rows) {
    const change = row.mutation
    if (change?.topicId !== topicId) continue
    const index = result.findIndex((item) => item.document === change.document)
    if (index >= 0) result[index] = change
    else result.push(change)
  }
  return result
}
export function turnAnswers(turn: ConversationTurn): string { return turn.rows.filter((row) => row.kind === 'assistant').map((row) => row.text).join('\n\n') }
