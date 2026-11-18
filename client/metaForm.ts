import type { PaperMeta, PaperStatus } from '../src/types.js'

/** Reading state is a saved fact, not an optimistic form value. */
export function optimisticMetaPatch(patch: Partial<PaperMeta>): Partial<PaperMeta> {
  const { status: _status, ...otherFields } = patch
  return otherFields
}

export interface MetaForm {
  title: string
  authors: string
  year: string
  venue: string
  doi: string
  url: string
  abstract: string
  keywords: string
  tags: string
  status: PaperStatus
  rating: number
}

export function toMetaForm(meta: PaperMeta): MetaForm {
  return {
    title: meta.title,
    authors: meta.authors.join(', '),
    year: meta.year === null ? '' : String(meta.year),
    venue: meta.venue,
    doi: meta.doi,
    url: meta.url,
    abstract: meta.abstract,
    keywords: meta.keywords.join(', '),
    tags: meta.tags.join(', '),
    status: meta.status,
    rating: meta.rating,
  }
}

/** Adopt incoming server values only where the reader has not edited the old value. */
export function reconcileMetaForm(current: MetaForm, previous: PaperMeta, incoming: PaperMeta): MetaForm {
  const next = toMetaForm(incoming)
  if (previous.id !== incoming.id) return next
  const before = toMetaForm(previous)
  const merged = { ...current }
  const adopt = <K extends keyof MetaForm>(key: K): void => {
    if (current[key] === before[key]) merged[key] = next[key]
  }
  for (const key of Object.keys(next) as (keyof MetaForm)[]) adopt(key)
  return merged
}

/** Normalize user input and send only changed fields, with their server baseline. */
export function metadataFormPatch(form: MetaForm, baseline: PaperMeta): { patch: Partial<PaperMeta>; expected: Partial<PaperMeta> } {
  const yearText = form.year.trim()
  const year = yearText ? Number(yearText) : null
  if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 3000)) throw new Error('year')
  if (!form.title.trim()) throw new Error('title')
  const list = (text: string) => [...new Set(text.split(/[,，;；]/).map((value) => value.trim()).filter(Boolean))]
  const values: Partial<PaperMeta> = { title: form.title.trim(), authors: list(form.authors), year, venue: form.venue.trim(), doi: form.doi.trim(), url: form.url.trim(), abstract: form.abstract.trim(), keywords: list(form.keywords), tags: list(form.tags), status: form.status, rating: form.rating }
  const patch: Record<string, unknown> = {}, expected: Record<string, unknown> = {}
  for (const key of Object.keys(values) as (keyof MetaForm)[]) {
    if (JSON.stringify(values[key]) !== JSON.stringify(baseline[key])) { patch[key] = values[key]; expected[key] = baseline[key] }
  }
  return { patch, expected }
}

/** An acknowledgement adopts normalized values only if the user has not typed more. */
export function acknowledgeMetadata(current: MetaForm, sent: MetaForm, incoming: PaperMeta): MetaForm {
  const normalized = toMetaForm(incoming), next = { ...current }
  for (const key of Object.keys(next) as (keyof MetaForm)[]) {
    if (current[key] === sent[key]) Object.assign(next, { [key]: normalized[key] })
  }
  return next
}
