import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-ui-state-'))
let checks = 0
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`) }
try {
  const file = path.join(root, 'state.mjs')
  await build({ stdin: { contents: "export * from './client/metaForm.ts'; export * from './client/lastPaper.ts'", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', outfile: file })
  const { toMetaForm, reconcileMetaForm, readLastPaper, writeLastPaper } = await import(pathToFileURL(file))
  const meta = { id: 'paper-a', title: 'Title', authors: ['Author'], year: 2026, venue: '', doi: '', url: '', abstract: '', keywords: [], tags: [], status: 'unread', rating: 0 }
  const filled = { ...meta, abstract: 'Generated abstract', keywords: ['attention'], tags: ['fast-weights'] }
  check('pristine form adopts all generated fields', reconcileMetaForm(toMetaForm(meta), meta, filled), toMetaForm(filled))
  check('adopting LLM values does not leave a dirty form', JSON.stringify(reconcileMetaForm(toMetaForm(meta), meta, filled)) === JSON.stringify(toMetaForm(filled)), true)
  const draft = { ...toMetaForm(meta), title: 'User-edited title', keywords: 'user keyword' }
  check('three-way merge keeps edits while adopting untouched generated fields', reconcileMetaForm(draft, meta, filled), { ...toMetaForm(filled), title: 'User-edited title', keywords: 'user keyword' })
  check('header changes also merge without dropping the draft', reconcileMetaForm(draft, meta, { ...meta, status: 'read', rating: 4 }), { ...draft, status: 'read', rating: 4 })
  check('switching papers starts with the new paper values', reconcileMetaForm(draft, meta, { ...filled, id: 'paper-b' }), toMetaForm({ ...filled, id: 'paper-b' }))
  check('an intentional user deletion remains an edit', reconcileMetaForm({ ...toMetaForm(filled), abstract: '' }, filled, { ...filled, abstract: 'Updated server abstract' }).abstract, '')

  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  check('no saved selection returns null', readLastPaper('/library-a', storage), null)
  writeLastPaper('/library-a', 'paper-a', storage)
  writeLastPaper('/library-b', 'paper-b', storage)
  check('selection survives remount through persistent storage', readLastPaper('/library-a', storage), 'paper-a')
  check('library selections stay separate', readLastPaper('/library-b', storage), 'paper-b')
  writeLastPaper('/library-a', null, storage)
  check('deleted selections can be cleared without touching other libraries', [readLastPaper('/library-a', storage), readLastPaper('/library-b', storage)], [null, 'paper-b'])
  writeLastPaper('/library-b', '../invalid', storage)
  check('invalid IDs never replace valid selections', readLastPaper('/library-b', storage), 'paper-b')
  values.set('paperdesk:last-paper:/library-a', '../../outside')
  check('malformed stored selection is rejected', readLastPaper('/library-a', storage), null)
  const denied = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
  check('unavailable storage does not break reading', readLastPaper('/library-a', denied), null)
  assert.doesNotThrow(() => writeLastPaper('/library-a', 'paper-a', denied)); checks++
  console.log(`${checks} UI state checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
