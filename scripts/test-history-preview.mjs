import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root=await mkdtemp(path.join(os.tmpdir(),'paperdesk-history-preview-'))
try {
  const file=path.join(root,'preview.mjs')
  await build({entryPoints:['client/historyPreview.ts'],bundle:true,platform:'node',format:'esm',outfile:file})
  const {historyCardPreview}=await import(pathToFileURL(file))
  const card={id:'c-test',title:'Formula',body:'$x>1$ (p.1)',tags:['method'],pages:[1]}
  const cases=[
    [JSON.stringify({items:[card]}),[card]],
    [JSON.stringify({items:[]}),[]],
    ['{broken',null],['null',null],[JSON.stringify({items:[null]}),null],
    [JSON.stringify({items:[{...card,tags:'broken'}]}),null],
    [JSON.stringify({items:[{...card,pages:[0]}]}),null],
    [JSON.stringify({items:[{...card,body:123}]}),null],
  ]
  for(const [content,expected] of cases) assert.deepEqual(historyCardPreview(content),expected)
  console.log('8 history preview checks passed: valid, empty and malformed legacy snapshots')
} finally {await rm(root,{recursive:true,force:true})}
