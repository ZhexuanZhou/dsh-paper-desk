/**
 * Host-side LLM tagger for newly imported papers.
 *
 * The model receives the title, abstract and the first few pages (introduction)
 * and returns a compact JSON array of topic tags. Any missing model/service or
 * malformed answer falls back to the deterministic taxonomy so importing a PDF
 * never fails because tagging did.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.js'
import { autoTags, type AutoTagContext, type AutoTagFn } from './autotag.js'
import { extractText, pageText } from './pdf.js'

interface LlmChunk {
  type?: string
  text?: string
  reason?: { kind?: string }
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

const MAX_EXCERPT_CHARS = 7000
const TAG_TIMEOUT_MS = 12_000
const MAX_TAGS = 5

const SYSTEM_PROMPT =
  'You tag research papers for a local paper library. Read the title, abstract and introduction excerpt. ' +
  'Reply with ONLY a JSON array of 3 to 5 short topic tags, for example ["diffusion-model","language-model"]. ' +
  'Use lowercase English words joined by hyphens. Tag the research topic, method or application, not the venue, authors, year, ' +
  'paper type or generic words such as research/paper/study/method. Do not invent topics that are not present in the text.'

const GENERIC_TAGS = new Set([
  'paper',
  'papers',
  'research',
  'study',
  'method',
  'methods',
  'approach',
  'analysis',
  'experiment',
  'experiments',
  'result',
  'results',
  'model',
  'models',
  'artificial-intelligence',
  'machine-learning',
])

function normaliseTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/[`"'“”‘’]/g, '')
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

/** Parse a JSON array or a comma/newline separated answer. */
export function parseTagAnswer(raw: string): string[] {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  let values: unknown[] = []
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) values = parsed
    } catch {
      // Fall through to the delimiter split.
    }
  }
  if (values.length === 0) values = text.split(/[\n,，、]+/)
  const tags: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const tag = normaliseTag(value)
    if (tag.length < 2 || tag.length > 32) continue
    if (GENERIC_TAGS.has(tag)) continue
    if (!tags.includes(tag)) tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

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
    // No model available.
  }
  return null
}

/** Build an excerpt from the first pages: abstract is already passed separately. */
async function introductionExcerpt(pdfAbs: string): Promise<string> {
  try {
    const text = await extractText(pdfAbs, 4)
    const pages: string[] = []
    for (let page = 1; page <= Math.min(4, text.pageCount); page += 1) {
      const value = pageText(text, page).trim()
      if (value.length > 0) pages.push(value)
    }
    let joined = pages.join('\n\n')
    const refIndex = joined.search(/\n(?:References|REFERENCES|Bibliography)\b/)
    if (refIndex > 800) joined = joined.slice(0, refIndex)
    return joined.slice(0, MAX_EXCERPT_CHARS)
  } catch {
    return ''
  }
}

function tagPrompt(input: AutoTagContext, excerpt: string): string {
  const lines = [
    `Title: ${input.title.trim()}`,
    `Abstract: ${input.abstract.trim().slice(0, 2500) || '(none)'}`,
    `Keywords: ${(input.keywords ?? []).join(', ') || '(none)'}`,
    `Venue: ${input.venue?.trim() || '(unknown)'}`,
    '',
    'Introduction / first pages (use only for topic identification):',
    excerpt || '(text extraction unavailable; use title and abstract only)',
    '',
    'Return the JSON array now.',
  ]
  return lines.join('\n')
}

async function streamTags(ctx: Context, input: AutoTagContext): Promise<string[]> {
  const llm = ctx.get('llm') as unknown as LlmServiceLike | undefined
  if (llm === undefined || typeof llm.stream !== 'function') return []
  const route = resolveRoute(ctx)
  if (route === null) return []
  const excerpt = await introductionExcerpt(input.pdfAbs)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TAG_TIMEOUT_MS)
  try {
    let answer = ''
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: tagPrompt(input, excerpt) }],
      temperature: 0,
      maxTokens: 160,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (typeof chunk.text === 'string' && (chunk.type === 'text-delta' || chunk.type === undefined)) {
        answer += chunk.text
      }
    }
    return parseTagAnswer(answer)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create the tagger wired to the current Host model. If the model is missing,
 * times out or returns unusable output, the deterministic taxonomy is used.
 */
export function createLlmTagger(ctx: Context, _config: Config): AutoTagFn {
  return async (input: AutoTagContext): Promise<readonly string[]> => {
    try {
      const tagged = await streamTags(ctx, input)
      if (tagged.length >= 2) return tagged
    } catch {
      // Tagging is best-effort; the import must still succeed.
    }
    return autoTags({
      title: input.title,
      abstract: input.abstract,
      keywords: input.keywords,
      venue: input.venue,
    })
  }
}
