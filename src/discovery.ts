/**
 * Incremental relation-discovery state.
 *
 * The graph discovery prompt used to contain every paper and every existing
 * edge. That is fine for a dozen papers but grows linearly with the library.
 * This module records which paper metadata signatures have already been
 * analysed, so a normal run only sends new/changed papers plus their 1-hop
 * neighbours. A full-library re-analysis remains an explicit user choice.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeJoin } from './util.js'
import type { PaperMeta, PaperRelation, RelationsDocument } from './types.js'

export interface DiscoveryScope {
  mode: 'incremental' | 'none'
  /** Papers whose metadata signature is new or changed. */
  newIds: string[]
  /** Existing papers directly connected to a new paper. */
  neighborIds: string[]
  /** New papers + neighbours, i.e. the papers sent to the model. */
  scopeIds: string[]
  totalPapers: number
  analyzedPapers: number
}

interface DiscoveryState {
  version: 1
  papers: Record<string, { signature: string; analyzedAt: string }>
}

const STATE_DIR = '.paperdesk'
const STATE_FILE = 'discovery.json'
const SCOPE_CAP = 40

function statePath(root: string): string {
  return safeJoin(root, `${STATE_DIR}/${STATE_FILE}`)
}

export function paperSignature(meta: PaperMeta): string {
  return createHash('sha256')
    .update(
      [
        meta.title.trim(),
        meta.year === null ? '' : String(meta.year),
        meta.authors.join('|'),
        meta.abstract.trim(),
      ].join('\n'),
    )
    .digest('hex')
}

async function readState(root: string): Promise<DiscoveryState> {
  try {
    const raw = await readFile(statePath(root), 'utf8')
    const parsed = JSON.parse(raw) as Partial<DiscoveryState> | null
    if (parsed === null || parsed.version !== 1 || typeof parsed.papers !== 'object' || parsed.papers === null) {
      return { version: 1, papers: {} }
    }
    const papers: DiscoveryState['papers'] = {}
    for (const [id, value] of Object.entries(parsed.papers)) {
      if (value !== null && typeof value === 'object' && typeof value.signature === 'string') {
        papers[id] = { signature: value.signature, analyzedAt: String(value.analyzedAt ?? '') }
      }
    }
    return { version: 1, papers }
  } catch {
    return { version: 1, papers: {} }
  }
}

async function writeState(root: string, state: DiscoveryState): Promise<void> {
  const path = statePath(root)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/** Compute the next incremental scope without mutating state. */
export async function discoveryScope(
  root: string,
  papers: readonly PaperMeta[],
  relations: RelationsDocument,
): Promise<DiscoveryScope> {
  const state = await readState(root)
  const newIds: string[] = []
  for (const paper of papers) {
    const entry = state.papers[paper.id]
    if (entry === undefined || entry.signature !== paperSignature(paper)) newIds.push(paper.id)
  }
  const newSet = new Set(newIds)
  const neighborSet = new Set<string>()
  for (const relation of relations.items) {
    if (newSet.has(relation.from) && !newSet.has(relation.to)) neighborSet.add(relation.to)
    if (newSet.has(relation.to) && !newSet.has(relation.from)) neighborSet.add(relation.from)
  }
  const neighborIds = [...neighborSet]
  const scope = [...newIds, ...neighborIds]
  // A brand-new paper with no existing edges still needs a bounded context
  // set to compare against. Use recent papers only; never the whole library.
  if (newIds.length > 0) {
    const terms = (paper: PaperMeta): Set<string> => new Set(
      `${paper.title} ${paper.abstract} ${paper.tags.join(' ')}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    )
    const newTerms = new Set(papers.filter((paper) => newSet.has(paper.id)).flatMap((paper) => [...terms(paper)]))
    const candidates = papers.filter((paper) => !newSet.has(paper.id)).map((paper) => ({
      paper,
      score: [...terms(paper)].filter((term) => newTerms.has(term)).length,
    })).sort((a, b) => b.score - a.score || b.paper.addedAt.localeCompare(a.paper.addedAt))
    for (const { paper } of candidates.slice(0, 12)) {
      if (!scope.includes(paper.id)) scope.push(paper.id)
    }
  }
  // Keep space for old-library candidates even when a batch fills the budget.
  const selectedNew = scope.filter((id) => newSet.has(id)).slice(0, Math.max(1, SCOPE_CAP - Math.min(12, scope.filter((id) => !newSet.has(id)).length)))
  const scopeIds = [...selectedNew, ...scope.filter((id) => !newSet.has(id))].slice(0, SCOPE_CAP)
  return {
    mode: scopeIds.length === 0 ? 'none' : 'incremental',
    newIds: selectedNew,
    neighborIds,
    scopeIds,
    totalPapers: papers.length,
    analyzedPapers: papers.filter((paper) => {
      const entry = state.papers[paper.id]
      return entry !== undefined && entry.signature === paperSignature(paper)
    }).length,
  }
}

/** Mark analysed papers. Full runs pass every current paper id. */
export async function markDiscoveryAnalyzed(
  root: string,
  papers: readonly PaperMeta[],
  ids: readonly string[],
): Promise<DiscoveryScope> {
  const wanted = new Set(ids)
  const state = await readState(root)
  const stamp = new Date().toISOString()
  let changed = false
  for (const paper of papers) {
    if (!wanted.has(paper.id)) continue
    state.papers[paper.id] = { signature: paperSignature(paper), analyzedAt: stamp }
    changed = true
  }
  if (changed) await writeState(root, state)
  return discoveryScope(root, papers, { schemaVersion: 1, updatedAt: '', items: [] })
}

/** Existing relations touching the scope, for duplicate avoidance. */
export function relationsForScope(
  relation: PaperRelation,
  scopeIds: ReadonlySet<string>,
): boolean {
  return scopeIds.has(relation.from) || scopeIds.has(relation.to)
}
