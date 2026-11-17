import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-ai-display-'))
let checks = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`) }
try {
  const file = path.join(root, 'display.mjs')
  await build({ entryPoints: ['client/aiDisplay.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file })
  const { groupConversationTurns } = await import(pathToFileURL(file))
  const row = (id, kind, text = `${kind} ${id}`) => ({ id, kind, text })
  const input = [row('u1','user'),row('r1','reasoning'),row('a0','assistant'),row('t1','tool'),row('a1','assistant'),row('u2','user'),row('r2','reasoning'),row('err','error'),row('s','status'),row('a2','assistant')]
  const original = JSON.stringify(input)
  const out = groupConversationTurns(input)
  check('each question begins one turn', out.length, 2)
  check('process and intermediate answers remain in the same turn', out[0].rows.map(row => row.id), ['r1','a0','t1','a1'])
  check('all events preserve their original order', out.flatMap(turn => [...(turn.question ? [turn.question] : []), ...turn.rows]), input)
  check('input transcript is never mutated', JSON.stringify(input), original)
  check('turn identity survives streaming appends', groupConversationTurns([...input, row('t2','tool')])[1].id, out[1].id)
  check('empty input stays empty', groupConversationTurns([]), [])
  check('leading events without a question are retained', groupConversationTurns([row('s0','status'),row('a','assistant')])[0], {id:'s0',question:null,rows:[row('s0','status'),row('a','assistant')]})
  check('an unanswered question stays visible', groupConversationTurns([row('u','user')]), [{id:'u',question:row('u','user'),rows:[]}])
  check('consecutive questions are not merged', groupConversationTurns([row('u1','user'),row('u2','user')]).length, 2)
  check('errors and statuses remain visible reply events', out[1].rows.filter(row => row.kind !== 'reasoning' && row.kind !== 'tool').map(row => row.id), ['err','s','a2'])
  console.log(`${checks} AI display checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
