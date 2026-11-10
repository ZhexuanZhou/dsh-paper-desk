/** Text helpers for prompts the panel injects context into. */

const CONTEXT_MARKER = '\n\n---\n\n'

/**
 * Remove the paper/history context the panel prepends to a prompt, leaving the
 * question the user actually typed. Used for both the rendered user bubble and
 * the persisted transcript.
 */
export function cleanUserPrompt(text: string): string {
  const index = text.lastIndexOf(CONTEXT_MARKER)
  const body = index >= 0 ? text.slice(index + CONTEXT_MARKER.length) : text
  // Assist-task prompts contain the whole reading instructions and library
  // context. The conversation bubble should show only the user's actual
  // question (or the task name when the task had no custom question).
  const mine = /\n(?:我的问题|My question)[：:]\s*([^\n]+)/i.exec(body)
  if (mine !== null && (mine[1] ?? '').trim() !== '') return (mine[1] ?? '').trim()
  const task = /\n(?:任务|Task)[：:]\s*([^\n]+)/i.exec(body)
  if (task !== null && (task[1] ?? '').trim() !== '') return (task[1] ?? '').trim()
  return body
    .replace(/^当前论文：《[\s\S]*?》（id: [^）]*）。\s*/, '')
    .trim()
}
