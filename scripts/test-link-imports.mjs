import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const root = await mkdtemp(path.join(os.tmpdir(), 'zhiyelinks-'))
let count = 0
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); count++; console.log(`ok ${label}`) }
try {
 const file = path.join(root, 'links.mjs')
 await build({entryPoints:['client/linkImports.ts'],bundle:true,platform:'node',format:'esm',outfile:file})
 const {parseImportLinks,runLinkImports}=await import(pathToFileURL(file))
 check('batch ignores blank lines and duplicate entries',parseImportLinks('  https://example.org/a.pdf\r\n\n2601.00001\n https://example.org/a.pdf '),['https://example.org/a.pdf','2601.00001'])
 check('URL query punctuation is not split',parseImportLinks('https://example.org/a.pdf?q=a,b&v=1'),['https://example.org/a.pdf?q=a,b&v=1'])
 const states=[], calls=[];let active=0,peak=0
 const run=async(url)=>{calls.push(url);active++;peak=Math.max(peak,active);await Promise.resolve();active--;if(url==='bad')throw Error('404');return{duplicated:url==='duplicate',meta:{title:url}}}
 const out=await runLinkImports(['good','bad','duplicate','last'],run,item=>states.push(item))
 check('one failure does not lose later entries',calls,['good','bad','duplicate','last'])
 check('requests execute one at a time',peak,1)
 check('partial results preserve successes and duplicates',out.map(item=>item.meta.title),['good','duplicate','last'])
 check('failed result carries its error',states.find(item=>item.state==='error'),{url:'bad',state:'error',error:'404'})
 check('duplicate is explicit rather than another saved record',states.find(item=>item.url==='duplicate'&&item.state!=='running').state,'duplicate')
 const retry=[];await runLinkImports(['bad'],async(url)=>({duplicated:false,meta:{title:url}}),item=>retry.push(item))
 check('retry touches only the requested failed entry',retry.map(item=>[item.url,item.state]),[['bad','running'],['bad','success']])
 console.log(`${count} link batch checks passed`)
} finally {await rm(root,{recursive:true,force:true})}
