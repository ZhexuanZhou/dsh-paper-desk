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
  return body
    .replace(/^当前论文：《[\s\S]*?》（id: [^）]*）。\s*/, '')
    .trim()
}
