/**
 * Host-side synthesis of a multi-turn conversation into one card.
 *
 * The model receives the selected turns and returns a structured knowledge
 * card. When no model is available, the card falls back to a readable
 * transcript so the user can still save it.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.js'
import type { CardContextTurn } from './types.js'

interface LlmChunk {
  type?: string
  text?: string
}

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

interface AgentDefaultModelLike {
  currentSelection?(): { provider?: unknown; model?: unknown } | undefined
}

export interface SynthesizedCard {
  title: string
  body: string
  tags: string[]
  pages: number[]
}

const MAX_TRANSCRIPT_CHARS = 12000
const TIMEOUT_MS = 20_000

const SYSTEM_PROMPT =
  'You turn a selected research-paper conversation into one reusable knowledge card. ' +
  'Reply with ONLY a JSON object with keys: title (short, <=60 chars), body (Markdown, 3-8 short paragraphs or bullets), ' +
  'tags (3-5 lowercase topic tags), pages (cited page numbers as integers). ' +
  'Keep the user\'s conclusions, evidence, caveats and cited pages; do not invent facts. ' +
  'Do not include the raw conversation or meta commentary.'

function resolveRoute(ctx: Context): { provider: string; model: string } | null {
  const defaults = ctx.get('agentDefaultModel') as unknown as AgentDefaultModelLike | undefined
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

function transcript(turns: readonly CardContextTurn[]): string {
  return turns
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}:\n${turn.text.trim()}`)
    .join('\n\n---\n\n')
    .slice(0, MAX_TRANSCRIPT_CHARS)
}

function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '')
  const value = (line ?? '').trim().replace(/^#+\s*/, '').replace(/[*_`]/g, '')
  return value.length > 60 ? `${value.slice(0, 60)}…` : value || 'Conversation card'
}

function pagesFromText(text: string): number[] {
  const pages: number[] = []
  for (const match of text.matchAll(/\bpp?\.\s?(\d{1,3})/g)) {
    const page = Number.parseInt(match[1] ?? '', 10)
    if (Number.isFinite(page) && page > 0 && page <= 999 && !pages.includes(page)) pages.push(page)
    if (pages.length >= 20) break
  }
  return pages
}

function parseJsonCard(raw: string): SynthesizedCard | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
    const body = typeof record['body'] === 'string' ? record['body'].trim() : ''
    if (title === '' || body === '') return null
    const tags = Array.isArray(record['tags'])
      ? record['tags']
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLowerCase().replace(/\s+/g, '-'))
          .filter((value) => value.length > 0)
          .slice(0, 5)
      : []
    const pages = Array.isArray(record['pages'])
      ? record['pages']
          .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 999)
          .slice(0, 20)
      : pagesFromText(body)
    return { title: title.slice(0, 200), body, tags, pages: [...new Set(pages)] }
  } catch {
    return null
  }
}

function fallbackCard(turns: readonly CardContextTurn[]): SynthesizedCard {
  const lastAnswer = [...turns].reverse().find((turn) => turn.role === 'assistant')
  const text = lastAnswer?.text.trim() ?? transcript(turns)
  return {
    title: firstLine(text),
    body: text,
    tags: [],
    pages: pagesFromText(text),
  }
}

export async function synthesizeCard(
  ctx: Context,
  _config: Config,
  turns: readonly CardContextTurn[],
): Promise<SynthesizedCard> {
  if (turns.length === 0) throw new Error('no conversation turns selected')
  const llm = ctx.get('llm') as unknown as LlmServiceLike | undefined
  const route = resolveRoute(ctx)
  if (llm === undefined || typeof llm.stream !== 'function' || route === null) {
    return fallbackCard(turns)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    let answer = ''
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Conversation:\n\n${transcript(turns)}\n\nReturn the JSON card now.` }],
      temperature: 0.2,
      maxTokens: 1200,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (typeof chunk.text === 'string') answer += chunk.text
    }
    return parseJsonCard(answer) ?? fallbackCard(turns)
  } catch {
    return fallbackCard(turns)
  } finally {
    clearTimeout(timer)
  }
}
