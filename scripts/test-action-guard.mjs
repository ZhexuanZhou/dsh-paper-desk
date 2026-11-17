import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const root = await mkdtemp(path.join(os.tmpdir(), 'zhiyeguard-'))
let checks = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`) }
try {
  const file = path.join(root, 'guard.mjs')
  await build({ entryPoints: ['client/actionGuard.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file })
  const { createActionGuard } = await import(pathToFileURL(file))
  let dirty = false, draft = '', view = 'topic', paper = 'original', pending
  const guard = createActionGuard(() => dirty, action => { pending = action })
  let complete
  const importResult = new Promise(resolve => { complete = resolve })
  const importFinished = importResult.then(() => guard(() => { view = 'library'; paper = 'imported' }))
  // The completion callback already exists, then the user edits while the import runs.
  draft = 'new unsaved idea'; dirty = true
  complete(); await importFinished
  check('a draft started after the request blocks both navigation and selection', [view, paper, draft, typeof pending], ['topic', 'original', 'new unsaved idea', 'function'])
  // Staying means the pending action is discarded, not executed.
  pending = undefined
  check('staying keeps the draft and current paper', [view, paper, draft], ['topic', 'original', 'new unsaved idea'])
  const second = Promise.resolve().then(() => guard(() => { view = 'library'; paper = 'second' }))
  dirty = false; await second
  check('a draft saved before completion does not leave a stale blocked action', [view, paper, pending], ['library', 'second', undefined])
  dirty = true
  guard(() => { view = 'library'; paper = 'third' })
  const queued = pending; dirty = false; queued()
  check('an explicit continue executes navigation and selection together', [view, paper], ['library', 'third'])
  console.log(`${checks} async action guard checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
