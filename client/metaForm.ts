import type { PaperMeta, PaperStatus } from '../src/types.js'

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
