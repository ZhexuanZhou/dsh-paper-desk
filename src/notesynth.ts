/**
 * Synthesize a paper's note cards into a readable notes.md summary.
 * The model receives card titles/bodies/pages and returns Markdown only.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.js'
import type { NoteCard } from './types.js'

interface LlmChunk { text?: string }
interface LlmServiceLike {
  stream(options: {
    provider: string
    model: string
    system?: string
    messages: { role: 'user'; content: string }[]
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<LlmChunk>
}
interface DefaultModelLike { currentSelection?(): { provider?: unknown; model?: unknown } | undefined }

const MAX_INPUT_CHARS = 15000
const TIMEOUT_MS = 20_000

const SYSTEM_PROMPT =
  'You are writing the summary section of a research reading note from the reader\'s note cards. ' +
  'Return Markdown only, with a short overview and themed bullet points. ' +
  'Preserve the cards\' conclusions, evidence and page citations (p.N). Do not invent facts or add a title heading. ' +
  'Keep it under 700 words.'

function route(ctx: Context): { provider: string; model: string } | null {
  const defaults = ctx.get('agentDefaultModel') as unknown as DefaultModelLike | undefined
  try {
    const selection = defaults?.currentSelection?.()
    if (
      selection !== undefined &&
      typeof selection.provider === 'string' &&
      selection.provider.length > 0 &&
      typeof selection.model === 'string' &&
      selection.model.length > 0
    ) {
      return { provider: selection.provider, model: selection.model }
    }
  } catch {
    // no model
  }
  return null
}

function cardBlock(cards: readonly NoteCard[]): string {
  let out = ''
  for (const [index, card] of cards.entries()) {
    const pages = card.pages.length > 0 ? `p.${card.pages.join(', p.')}` : 'no page'
    const block = `Card ${index + 1}: ${card.title}\nPages: ${pages}\nTags: ${card.tags.join(', ') || '—'}\n\n${card.body.trim()}\n\n---\n\n`
    if (out.length + block.length > MAX_INPUT_CHARS) break
    out += block
  }
  return out
}

function fallback(cards: readonly NoteCard[]): string {
  const lines = ['## 卡片总结', '']
  for (const card of cards) {
    const pages = card.pages.length > 0 ? `（${card.pages.map((page) => `p.${page}`).join(', ')}）` : ''
    lines.push(`### ${card.title}${pages}`)
    lines.push(card.body.trim())
    lines.push('')
  }
  return lines.join('\n').trim()
}

export async function synthesizeNotes(ctx: Context, _config: Config, cards: readonly NoteCard[]): Promise<string> {
  if (cards.length === 0) throw new Error('no cards to summarize')
  const llm = ctx.get('llm') as unknown as LlmServiceLike | undefined
  const selected = route(ctx)
  if (llm === undefined || typeof llm.stream !== 'function' || selected === null) return fallback(cards)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    let answer = ''
    const stream = llm.stream({
      provider: selected.provider,
      model: selected.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Paper note cards:\n\n${cardBlock(cards)}\n\nWrite the summary Markdown now.` }],
      temperature: 0.2,
      maxTokens: 1600,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (typeof chunk.text === 'string') answer += chunk.text
    }
    return answer.trim().slice(0, 12000) || fallback(cards)
  } catch {
    return fallback(cards)
  } finally {
    clearTimeout(timer)
  }
}
