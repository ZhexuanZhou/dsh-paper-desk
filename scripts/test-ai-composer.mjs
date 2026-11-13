import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-ai-composer-'))
let checks = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`) }
try {
  const file = path.join(root, 'composer.mjs')
  await build({ entryPoints: ['client/aiComposer.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file })
  const { parseImagePages, readComposerOptions, writeComposerOptions, clearAcceptedDraft } = await import(pathToFileURL(file))
  check('attaching without a list freezes the current page', parseImagePages('', 6, 17), [6])
  check('Chinese commas, spaces and duplicates resolve to actual page images', parseImagePages('1，3 3, 17', 6, 17), [1, 3, 17])
  for (const input of ['0', '-1', '1.5', '1e1', 'NaN', '18', '9007199254740993', '1,2,3,4']) {
    check(`invalid page list is refused: ${input}`, parseImagePages(input, 1, 17), null)
  }
  check('unknown page count still enforces positive integer pages', parseImagePages('2,5', 1, null), [2, 5])
  check('a missing current page is not converted to page zero', parseImagePages('', 0, 17), null)

  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  const keyA = 'paperdesk:ai-draft:paper-a:chat-a'
  const keyB = 'paperdesk:ai-draft:paper-a:chat-b'
  const options = { task: 'method', pages: [4, 6] }
  writeComposerOptions(storage, keyA, options)
  check('switching chats does not carry page attachments or a task', readComposerOptions(storage, keyB, 17), { task: null, pages: [] })
  check('returning to the chat restores its own explicit attachments', readComposerOptions(storage, keyA, 17), options)
  check('restoring after a smaller document count discards invalid attachments', readComposerOptions(storage, keyA, 5), { task: 'method', pages: [] })
  values.set(`${keyB}:options`, JSON.stringify({ task: 'unknown', pages: ['4'] }))
  check('malformed options do not create implicit attachments', readComposerOptions(storage, keyB, 17), { task: null, pages: [] })
  values.set(`${keyB}:options`, '{broken')
  check('broken stored JSON is recoverable', readComposerOptions(storage, keyB, 17), { task: null, pages: [] })

  storage.setItem(keyA, 'sent question')
  storage.setItem(keyB, 'a different draft')
  clearAcceptedDraft(storage, keyA, 'sent question', options)
  check('acceptance clears only the sent chat text and attachments', [storage.getItem(keyA), storage.getItem(`${keyA}:options`), storage.getItem(keyB)], [null, null, 'a different draft'])
  storage.setItem(keyA, 'a newer unsent question')
  writeComposerOptions(storage, keyA, { task: null, pages: [9] })
  clearAcceptedDraft(storage, keyA, 'sent question', options)
  check('a late acceptance preserves newer text and attachment choices', [storage.getItem(keyA), readComposerOptions(storage, keyA, 17)], ['a newer unsent question', { task: null, pages: [9] }])
  writeComposerOptions(storage, keyA, { task: null, pages: [] })
  check('removing the last attachment clears empty options', storage.getItem(`${keyA}:options`), null)

  const denied = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') }, removeItem: () => { throw Error('denied') } }
  check('unavailable storage falls back to an ordinary text question', readComposerOptions(denied, keyA, 17), { task: null, pages: [] })
  assert.doesNotThrow(() => { writeComposerOptions(denied, keyA, options); clearAcceptedDraft(denied, keyA, 'text', options) }); checks++
  check('no chat scope never reads another chat draft', readComposerOptions(storage, null, 17), { task: null, pages: [] })
  console.log(`${checks} AI composer checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
