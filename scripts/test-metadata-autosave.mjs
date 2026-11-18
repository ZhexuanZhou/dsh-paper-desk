import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { pdfLinksFixture } from './fixtures/pdf-links.mjs'
const root = await mkdtemp(path.join(os.tmpdir(), 'paper-metadata-autosave-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
let server
let checks = 0
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`) }
try {
  const { createPaper, readMeta, updateMeta, fillMissingMetadata, undoMetadata } = await import('../lib/library.js')
  const { metadataHash, metadataUndoState, readMetadataRevision } = await import('../lib/metadataHistory.js')
  const { buildRoutes } = await import('../lib/http.js')
  const library = path.join(root, 'library')
  const generated = {abstract:'Generated from the supplied paper.',keywords:['one'],tags:['test-paper']}
  const imported = await createPaper(library,{bytes:pdfLinksFixture(),fileName:'fixture.pdf',source:'import',enrich:false,autoMetadata:async()=>generated})
  let meta = imported.meta
  const identity = [meta.id, meta.pdfFile, meta.pdfSha256, meta.addedAt]
  let undo = await metadataUndoState(library,meta)
  check('automatic import enrichment is immediately undoable',undo.fields,['abstract','keywords','tags'])
  meta = await undoMetadata(library,meta.id,undo.revisionId,undo.expectedHash)
  check('undo automatic enrichment clears only generated fields',[meta.abstract,meta.keywords,meta.tags],['',[],[]])
  check('undo preserves PDF identity and creation timestamp',[meta.id,meta.pdfFile,meta.pdfSha256,meta.addedAt],identity)
  undo=await metadataUndoState(library,meta)
  check('undo exposes an explicit redo',undo.action,'redo')
  meta=await undoMetadata(library,meta.id,undo.revisionId,undo.expectedHash)
  check('redo restores generated values', [meta.abstract,meta.keywords,meta.tags],[generated.abstract,generated.keywords,generated.tags])
  const safeRevision=await metadataUndoState(library,meta)
  const revisionFile=path.join(library,'.paperdesk','metadata-history',meta.id,`${safeRevision.revisionId}.json`)
  const revisionBytes=await readFile(revisionFile,'utf8')
  const tampered=JSON.parse(revisionBytes);tampered.before.pdfFile='other.pdf'
  await writeFile(revisionFile,JSON.stringify(tampered))
  await assert.rejects(readMetadataRevision(library,meta.id,safeRevision.revisionId),/invalid metadata version/);checks++
  await writeFile(revisionFile,revisionBytes)
  const bytes=await readFile(path.join(library,'papers',meta.id,'meta.json'),'utf8')
  await updateMeta(library,meta.id,{title:meta.title})
  check('no-op save does not rewrite metadata or create a timestamp change',await readFile(path.join(library,'papers',meta.id,'meta.json'),'utf8'),bytes)
  await updateMeta(library,meta.id,{abstract:'Manual note'},{abstract:generated.abstract})
  await assert.rejects(updateMeta(library,meta.id,{abstract:'Stale overwrite'},{abstract:generated.abstract}),error=>error.status===409);checks++
  check('stale expected fields cannot overwrite newer data',(await readMeta(library,meta.id)).abstract,'Manual note')
  await updateMeta(library,meta.id,{keywords:[]})
  const filled=await fillMissingMetadata(library,meta.id,{...generated,keywords:['automatic-keyword']})
  const enrichmentUndo=await metadataUndoState(library,filled.meta)
  check('existing-paper automatic completion has a reversible field delta',enrichmentUndo.fields,['keywords'])
  meta=await undoMetadata(library,meta.id,enrichmentUndo.revisionId,enrichmentUndo.expectedHash)
  check('undo completion preserves other user fields',[meta.abstract,meta.keywords],['Manual note',[]])
  const staleUndo=await metadataUndoState(library,meta)
  await updateMeta(library,meta.id,{venue:'New venue'})
  await assert.rejects(undoMetadata(library,meta.id,staleUndo.revisionId,staleUndo.expectedHash),error=>error.status===409);checks++
  check('undo never replaces a subsequent edit',(await readMeta(library,meta.id)).venue,'New venue')
  await updateMeta(library,meta.id,{pdfFile:null})
  check('internal PDF updates still work when editable metadata is unchanged',(await readMeta(library,meta.id)).pdfFile,null)
  const beforeFailure=await readMeta(library,meta.id)
  const blocked=path.join(root,'blocked')
  await mkdir(path.join(blocked,'papers',meta.id),{recursive:true})
  await writeFile(path.join(blocked,'papers',meta.id,'meta.json'),JSON.stringify(beforeFailure))
  await mkdir(path.join(blocked,'.paperdesk'),{recursive:true})
  await writeFile(path.join(blocked,'.paperdesk','metadata-history'),'blocks history directory')
  await assert.rejects(updateMeta(blocked,meta.id,{title:'Must not commit'}));checks++
  check('history failure prevents an irreversible metadata write',(await readMeta(blocked,meta.id)).title,beforeFailure.title)
  const config={libraryPath:library,language:'zh',enrich:false,autoImportInbox:false,maxPdfBytes:0,citationSync:false}
  const route=buildRoutes(config,undefined,undefined,undefined,async()=>generated)[0]
  server=createServer((req,res)=>void route.handler(req,res))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}/api/paper-desk`
  const request=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()}}
  const current=await readMeta(library,meta.id)
  check('backend advertises autosave/undo capability',(await request('/status')).body.features.metadataUndo,true)
  const patched=await request(`/paper?id=${meta.id}`,'PATCH',{venue:'Saved automatically',expected:{venue:current.venue},libraryPath:library})
  check('actual PATCH accepts expected-field auto-save',patched.status,200)
  check('changing the library cannot write a pending draft into the new one',(await request(`/paper?id=${meta.id}`,'PATCH',{venue:'Wrong library',libraryPath:root})).status,409)
  const version=(await request(`/paper/undo?id=${meta.id}`)).body
  const restored=await request(`/paper/undo?id=${meta.id}`,'POST',{revisionId:version.revisionId,expectedHash:version.expectedHash,libraryPath:library})
  check('actual undo route returns the restored canonical metadata',[restored.status,restored.body.meta.venue],[200,current.venue])
  check('undo endpoint rejects traversal-like versions',(await request(`/paper/undo?id=${meta.id}`,'POST',{revisionId:'../meta',expectedHash:metadataHash(current)})).status,400)

  await updateMeta(library,meta.id,{doi:'10.1000/metadata-test',abstract:''})
  const originalFetch=globalThis.fetch
  let crossrefCalls=0
  globalThis.fetch=async(input,init)=>{
    if(new URL(String(input)).hostname==='api.crossref.org'){
      crossrefCalls++
      await updateMeta(library,meta.id,{abstract:'Manual edit while Crossref was running'})
      return new Response(JSON.stringify({message:{DOI:'10.1000/metadata-test',title:[current.title],abstract:'<p>Stale Crossref abstract</p>'}}),{status:200,headers:{'content-type':'application/json'}})
    }
    return originalFetch(input,init)
  }
  let lateCrossref
  try{lateCrossref=await request(`/enrich?id=${meta.id}`,'POST',{})}finally{globalThis.fetch=originalFetch}
  check('Crossref test uses a controlled response without external networking',crossrefCalls,1)
  check('a late Crossref completion rejects a conflicting field baseline',lateCrossref.status,409)
  check('late Crossref cannot replace concurrent manual metadata',(await readMeta(library,meta.id)).abstract,'Manual edit while Crossref was running')

  const moduleFile=path.join(root,'autosave.mjs')
  await build({entryPoints:['client/metadataAutosave.ts'],bundle:true,platform:'node',format:'esm',outfile:moduleFile})
  const {createMetadataAutosave}=await import(pathToFileURL(moduleFile))
  const baseline=await readMeta(library,meta.id)
  let calls=[],ack
  const writer=createMetadataAutosave(baseline,{delay:60000,applied:()=>{},save:(patch,expected)=>{calls.push({patch,expected});return new Promise(resolve=>{ack=resolve})}})
  writer.update('title','First edit')
  const first=writer.flush()
  writer.update('title','Second edit while saving')
  check('inflight typing does not start a parallel write',calls.length,1)
  ack({...baseline,title:'First edit'})
  await first
  check('old acknowledgement does not erase newer typing',writer.getSnapshot().form.title,'Second edit while saving')
  const second=writer.flush()
  check('follow-up save uses the acknowledged baseline',calls[1],{patch:{title:'Second edit while saving'},expected:{title:'First edit'}})
  ack({...baseline,title:'Second edit while saving'})
  await second
  check('canonical acknowledgement finishes as saved',writer.getSnapshot().phase,'saved')
  writer.dispose()
  let saved=0
  const receive=createMetadataAutosave(baseline,{delay:60000,applied:()=>{},save:async patch=>{saved++;return{...baseline,...patch}}})
  receive.receive({...baseline,abstract:'Automatically filled on server'})
  await receive.flush()
  check('incoming auto-filled values are not mistaken for unsaved manual edits',saved,0)
  receive.update('year','20')
  check('incomplete year never silently writes invalid metadata',await receive.flush(),false)
  check('invalid input stays visible in the draft',receive.getSnapshot().form.year,'20')
  receive.dispose()
  const failed=createMetadataAutosave(baseline,{delay:60000,applied:()=>{},save:async()=>{throw Error('offline')}})
  failed.update('abstract','Keep this draft')
  await failed.flush()
  check('network failure is visible and preserves user text',[failed.getSnapshot().phase,failed.getSnapshot().error,failed.getSnapshot().form.abstract],['error','offline','Keep this draft'])
  failed.dispose()
  let completed=0
  const navigation=createMetadataAutosave(baseline,{delay:60000,applied:()=>{},save:async patch=>{completed++;return{...baseline,...patch}}})
  navigation.update('venue','Saved on navigation')
  navigation.dispose()
  await new Promise(resolve=>setImmediate(resolve))
  check('leaving before debounce flushes the outstanding edit',completed,1)
  const drafts=new Map()
  globalThis.localStorage={getItem:key=>drafts.get(key)??null,setItem:(key,value)=>drafts.set(key,value),removeItem:key=>drafts.delete(key)}
  const offlineDraft=createMetadataAutosave(baseline,{delay:60000,draftKey:'library:paper',applied:()=>{},save:async()=>{throw Error('offline')}})
  offlineDraft.update('abstract','Persist my unsaved text')
  await offlineDraft.flush()
  check('failed metadata edits are backed up per paper',drafts.has('library:paper'),true)
  offlineDraft.dispose()
  await new Promise(resolve=>setImmediate(resolve))
  const restoredDraft=createMetadataAutosave(baseline,{delay:60000,draftKey:'library:paper',applied:()=>{},save:async patch=>({...baseline,...patch})})
  check('returning to a paper restores the failed draft',restoredDraft.getSnapshot().form.abstract,'Persist my unsaved text')
  await restoredDraft.flush()
  check('successful persistence removes the temporary draft',drafts.has('library:paper'),false)
  restoredDraft.dispose()
  const otherDraft=createMetadataAutosave(baseline,{delay:60000,draftKey:'other-library:paper',applied:()=>{},save:async patch=>({...baseline,...patch})})
  check('drafts do not cross library keys',otherDraft.getSnapshot().form.abstract,baseline.abstract)
  otherDraft.dispose()
  globalThis.localStorage.setItem=()=>{throw Error('quota')}
  const fullDraft=createMetadataAutosave(baseline,{delay:60000,draftKey:'full:paper',applied:()=>{},save:async()=>{throw Error('offline')}})
  fullDraft.update('abstract','Kept in memory')
  check('backup quota failure is visible without blocking editing',[fullDraft.getSnapshot().storageError,fullDraft.getSnapshot().form.abstract],[true,'Kept in memory'])
  await fullDraft.flush();fullDraft.dispose()
  delete globalThis.localStorage
  console.log(`${checks} metadata autosave/undo checks passed`)
}finally{
  if(server) await new Promise(resolve=>server.close(resolve))
  if(oldHome===undefined) delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome
  await rm(root,{recursive:true,force:true})
}
