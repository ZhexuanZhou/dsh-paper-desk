import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-ai-display-'))
try {
  const file = path.join(root, 'display.mjs')
  await build({ entryPoints: ['client/aiDisplay.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file })
  const { groupProcessingRows } = await import(pathToFileURL(file))
  const row = (id, kind) => ({ id, kind, text: `${kind} ${id}` })
  const input = [row('u1','user'),row('r1','reasoning'),row('t1','tool'),row('r2','reasoning'),row('t2','tool'),row('a1','assistant'),row('u2','user'),row('r3','reasoning'),row('err','error'),row('t3','tool'),row('a2','assistant')]
  const out = groupProcessingRows(input)
  assert.equal(out.filter(item => item.kind === 'process').length, 3)
  assert.deepEqual(out[1].rows.map(row => row.id), ['r1','t1','r2','t2'])
  assert.deepEqual(out.flatMap(item => item.kind === 'row' ? [item.row] : item.rows), input)
  assert.equal(out[1].id, 'r1')
  assert.equal(groupProcessingRows([...input.slice(0,4), row('r4','reasoning')])[1].id, 'r1')
  assert.deepEqual(groupProcessingRows([]), [])
  assert.deepEqual(groupProcessingRows([row('a','assistant')]), [{kind:'row',row:row('a','assistant')}])
  console.log('7 AI display checks passed: grouping, boundaries, order, stable streaming identity and empty input')
} finally { await rm(root, { recursive: true, force: true }) }
