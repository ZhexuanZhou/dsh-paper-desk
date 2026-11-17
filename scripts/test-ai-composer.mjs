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
  const { appendQuotedComment, parseImagePages, readComposerOptions, writeComposerOptions, clearAcceptedDraft } = await import(pathToFileURL(file))
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
  const options = { pages: [4, 6] }
  writeComposerOptions(storage, keyA, options)
  values.set(`${keyA}:options`, JSON.stringify({ task: 'method', pages: [4, 6] }))
  check('legacy task is ignored while explicit pages are preserved', readComposerOptions(storage, keyA, 17), options)
  writeComposerOptions(storage, keyA, options)
  check('switching chats does not carry page attachments or a task', readComposerOptions(storage, keyB, 17), { pages: [] })
  check('returning to the chat restores its own explicit attachments', readComposerOptions(storage, keyA, 17), options)
  check('restoring after a smaller document count discards invalid attachments', readComposerOptions(storage, keyA, 5), { pages: [] })
  values.set(`${keyB}:options`, JSON.stringify({ task: 'unknown', pages: ['4'] }))
  check('malformed options do not create implicit attachments', readComposerOptions(storage, keyB, 17), { pages: [] })
  values.set(`${keyB}:options`, '{broken')
  check('broken stored JSON is recoverable', readComposerOptions(storage, keyB, 17), { pages: [] })

  values.set(`${keyA}:options`, JSON.stringify({ task: 'method', pages: options.pages }))
  clearAcceptedDraft(storage, keyA, 'text', options)
  check('sending a legacy task draft clears its sent attachments', storage.getItem(`${keyA}:options`), null)
  writeComposerOptions(storage, keyA, options)
  storage.setItem(keyA, 'sent question')
  storage.setItem(keyB, 'a different draft')
  clearAcceptedDraft(storage, keyA, 'sent question', options)
  check('acceptance clears only the sent chat text and attachments', [storage.getItem(keyA), storage.getItem(`${keyA}:options`), storage.getItem(keyB)], [null, null, 'a different draft'])
  storage.setItem(keyA, 'a newer unsent question')
  writeComposerOptions(storage, keyA, { pages: [9] })
  clearAcceptedDraft(storage, keyA, 'sent question', options)
  check('a late acceptance preserves newer text and attachment choices', [storage.getItem(keyA), readComposerOptions(storage, keyA, 17)], ['a newer unsent question', { pages: [9] }])
  writeComposerOptions(storage, keyA, { pages: [] })
  check('removing the last attachment clears empty options', storage.getItem(`${keyA}:options`), null)

  const denied = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') }, removeItem: () => { throw Error('denied') } }
  check('unavailable storage falls back to an ordinary text question', readComposerOptions(denied, keyA, 17), { pages: [] })
  assert.doesNotThrow(() => { writeComposerOptions(denied, keyA, options); clearAcceptedDraft(denied, keyA, 'text', options) }); checks++
  check('no chat scope never reads another chat draft', readComposerOptions(storage, null, 17), { pages: [] })
  check('selected answer text goes into an editable ordinary draft', appendQuotedComment('', 'a passage', 'explain this', 'Selected text'), 'Selected text：\n> a passage\n\nexplain this')
  check('existing question and formula source are preserved', appendQuotedComment('Compare $x_t$ first.', '$x_{t+1}=x_t+h v_t$', 'Is this Euler?', 'Selected text'), 'Compare $x_t$ first.\n\nSelected text：\n> $x_{t+1}=x_t+h v_t$\n\nIs this Euler?')
  check('each line including a paragraph break stays quoted', appendQuotedComment('', 'one\r\n\r\ntwo', '', '选中内容'), '选中内容：\n> one\n> \n> two')
  check('empty comment does not invent a user question', appendQuotedComment('My question', 'evidence', '  ', 'Selected text'), 'My question\n\nSelected text：\n> evidence')
  check('missing quoted content leaves an existing draft alone', appendQuotedComment('keep me', '  ', 'comment', 'Selected text'), 'keep me')
  check('another passage can be added without replacing the prior one', appendQuotedComment(appendQuotedComment('', 'first', 'why?', '选中内容'), 'second', 'compare', '选中内容'), '选中内容：\n> first\n\nwhy?\n\n选中内容：\n> second\n\ncompare')
  const existingCommentDraft = appendQuotedComment('Original question', 'evidence', 'old comment', 'Selected text')
  check('editing a saved comment updates its unmodified draft context once', appendQuotedComment(existingCommentDraft, 'evidence', 'new comment', 'Selected text', 'old comment'), 'Original question\n\nSelected text：\n> evidence\n\nnew comment')
  check('reopening without edits does not duplicate the current context', appendQuotedComment(existingCommentDraft, 'evidence', 'old comment', 'Selected text', 'old comment'), existingCommentDraft)
  check('editing a comment does not replace user-edited question text', appendQuotedComment('Original question\n\nSelected text：\n> evidence\n\nuser changed this', 'evidence', 'new comment', 'Selected text', 'old comment'), 'Original question\n\nSelected text：\n> evidence\n\nuser changed this\n\nSelected text：\n> evidence\n\nnew comment')
  console.log(`${checks} AI composer checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
