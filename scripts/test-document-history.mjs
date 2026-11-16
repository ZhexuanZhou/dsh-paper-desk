import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-history-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
let server
let checks = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`) }
try {
  const { registerTools } = await import('../lib/tools.js')
  const { readNotes, writeNotes, appendToNotes } = await import('../lib/notes.js')
  const { addCard, updateCard, removeCard, readCards, readCardsState, editCards } = await import('../lib/cards.js')
  const { documentState, editDocument, listRevisions, readRevision, restoreRevision } = await import('../lib/history.js')
  const { buildRoutes } = await import('../lib/http.js')
  const library = path.join(root, 'library'), paperId = 'test-paper'
  const dir = path.join(library, 'papers', paperId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({id:paperId, title:'History fixture', authors:[],year:2026}))
  const config = {libraryPath:library, language:'zh', enrich:false, autoImportInbox:false,maxPdfBytes:0,citationSync:false}
  const tools = new Map()
  registerTools({register(tool){tools.set(tool.name,tool);return()=>{}}},config)
  const signal = new AbortController().signal
  const require = createRequire(import.meta.url)
  const sdkRequire = createRequire(require.resolve('@deepseek-ai/dsh-tools'))
  const { snapshotJsonValue } = await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-util-values')))
  const run = async (name,args) => {
    const tool = tools.get(name)
    const result = await tool.execute(args,{signal})
    const detached = snapshotJsonValue(result)
    assert.notEqual(detached, undefined, `${name}: result must be lossless JSON`)
    assert.deepEqual(validateJsonSchemaValue(tool.output.schema,detached), [], `${name}: output schema`)
    assert.notEqual(snapshotJsonValue(tool.output.render(args,detached)), undefined, `${name}: render contract`)
    return result
  }
  check('actual SDK rejects undefined optional fields', snapshotJsonValue({context:undefined}), undefined)
  const original = '# Notes\r\n\r\n## Personal judgment\r\nKeep my inference. $x>1$ (p.1)\r\n'
  await writeFile(path.join(dir,'notes.md'),original)
  check('no invented legacy versions',await listRevisions(library,paperId,'notes'),[])
  const before = await readNotes(library,paperId)
  const rewritten = '# Reorganized\n\n## Evidence\n$x>1$ (p.1)\n\n## Personal judgment\nKeep my inference.\n'
  const write = await run('paper_notes_write',{paperId,expectedHash:before.hash,markdown:rewritten})
  check('agent rewrites original notes rather than append', [write.ok,(await readNotes(library,paperId)).markdown],[true,rewritten])
  const first = (await listRevisions(library,paperId,'notes'))[0]
  check('snapshot preserves exact CRLF and formula bytes',(await readRevision(library,paperId,'notes',first.id)).content,original)
  const replacement = await run('paper_notes_replace',{paperId,expectedHash:write.hash,oldText:'Keep my inference.',newText:'Updated personal judgment.'})
  check('exact replacement edits requested passage',replacement.ok,true)
  const current = await readNotes(library,paperId)
  check('replacement preserves unrelated formula',current.markdown.includes('$x>1$ (p.1)'),true)
  const ambiguous = await run('paper_notes_replace',{paperId,expectedHash:current.hash,oldText:'',newText:'BAD'})
  check('empty match is rejected',ambiguous.ok,false)
  check('stale rewrite is rejected',(await run('paper_notes_write',{paperId,expectedHash:before.hash,markdown:'STALE'})).ok,false)
  check('failed rewrite leaves current notes unchanged',(await readNotes(library,paperId)).markdown,current.markdown)
  await writeNotes(library,paperId,'duplicate duplicate',{baseHash:current.hash})
  check('ambiguous replacement rejects without partial text',(await run('paper_notes_replace',{paperId,expectedHash:(await readNotes(library,paperId)).hash,oldText:'duplicate',newText:'X'})).ok,false)
  const long = 'Long notes and TeX $x_1$\n'.repeat(1500)
  await writeNotes(library,paperId,long)
  const p1=await run('paper_notes_read',{paperId}),p2=await run('paper_notes_read',{paperId,offset:p1.nextOffset})
  check('paged reads return all notes with a consistent version',[p1.truncated,p2.truncated,p1.markdown+p2.markdown,p1.hash===p2.hash],[true,false,long,true])
  const restored=await run('paper_history_restore',{paperId,kind:'notes',revisionId:first.id,expectedHash:p2.hash})
  check('agent restoration returns exact original text',[restored.ok,(await readNotes(library,paperId)).markdown],[true,original])
  const undo=(await listRevisions(library,paperId,'notes')).find(v=>v.hash===p2.hash)
  check('restoration saves the state it replaces',Boolean(undo),true)
  await restoreRevision(library,paperId,'notes',undo.id,restored.hash)
  check('restore can itself be undone',(await readNotes(library,paperId)).markdown,long)
  const n=(await listRevisions(library,paperId,'notes')).length
  const noop=await restoreRevision(library,paperId,'notes',undo.id,(await readNotes(library,paperId)).hash)
  check('no-op restoration reports no change and makes no extra version',[noop.changed,(await listRevisions(library,paperId,'notes')).length],[false,n])
  const a=(await addCard(library,paperId,{title:'A',body:'Evidence A',pages:[1],source:'user',context:[{id:'x',role:'user',text:'Context'}]})).items[0]
  const b=(await addCard(library,paperId,{title:'B',body:'Evidence B',pages:[2]})).items[1]
  const c=(await addCard(library,paperId,{title:'C',body:'Two ideas',pages:[3]})).items[2]
  check('updating a card without context satisfies the Host output contract', (await run('paper_card_update',{paperId,cardId:b.id,expectedUpdatedAt:b.updatedAt,title:'B updated'})).ok, true)
  const baseline=await documentState(library,paperId,'cards')
  const merged=await run('paper_cards_edit',{paperId,expectedHash:baseline.hash,operations:[
    {action:'update',cardId:a.id,title:'A + B',body:'Evidence A and B',pages:[1,2]}, {action:'remove',cardId:b.id},
    {action:'create',title:'C1',body:'Idea one',pages:[3]},{action:'create',title:'C2',body:'Idea two',pages:[3]}, {action:'remove',cardId:c.id},
  ]})
  check('merge/split commits the complete desired collection',[merged.ok,merged.cards.map(v=>v.title)],[true,['A + B','C1','C2']])
  check('retained card preserves identity and origin',[merged.cards[0].id,merged.cards[0].source,merged.cards[0].createdAt],[a.id,'user',a.createdAt])
  const prev=(await listRevisions(library,paperId,'cards'))[0]
  check('whole batch creates one exact prior snapshot',(await readRevision(library,paperId,'cards',prev.id)).content,baseline.content)
  const bad=await run('paper_cards_edit',{paperId,expectedHash:merged.hash,operations:[{action:'update',cardId:a.id,body:'MUST NOT COMMIT'},{action:'remove',cardId:'missing'}]})
  check('invalid later operation aborts all earlier operations',[bad.ok,(await documentState(library,paperId,'cards')).hash],[false,merged.hash])
  check('stale card collection batch is rejected',(await run('paper_cards_edit',{paperId,expectedHash:baseline.hash,operations:[{action:'remove',cardId:a.id}]})).ok,false)
  await run('paper_history_restore',{paperId,kind:'cards',revisionId:prev.id,expectedHash:merged.hash})
  check('card restoration is byte-exact including context',(await documentState(library,paperId,'cards')).content,baseline.content)
  await assert.rejects(()=>updateCard(library,paperId,a.id,{body:'STALE'},'stale'),/changed/);checks++
  await assert.rejects(()=>removeCard(library,paperId,a.id,'stale'),/changed/);checks++
  const h=(await documentState(library,paperId,'cards')).hash
  const moved=await editCards(library,paperId,[{action:'move',cardId:c.id,position:0}],h)
  check('reorder preserves card body and identity',moved.items.map(v=>v.id),[c.id,a.id,b.id])
  await removeCard(library,paperId,b.id)
  check('manual deletion is versioned',(await listRevisions(library,paperId,'cards')).length>4,true)
  const emptyId='empty-paper';await mkdir(path.join(library,'papers',emptyId));await writeFile(path.join(library,'papers',emptyId,'meta.json'),'{}')
  await writeNotes(library,emptyId,'created',{baseHash:''})
  const absent=(await listRevisions(library,emptyId,'notes'))[0]
  check('creation remembers absence',absent.exists,false)
  await restoreRevision(library,emptyId,'notes',absent.id,(await readNotes(library,emptyId)).hash)
  check('restoring before creation returns absence',(await readNotes(library,emptyId)).exists,false)
  const saved=(await listRevisions(library,emptyId,'notes')).find(v=>v.exists)
  await restoreRevision(library,emptyId,'notes',saved.id,'')
  check('deleted document remains recoverable',(await readNotes(library,emptyId)).markdown,'created')
  const versionCount=(await listRevisions(library,emptyId,'notes')).length
  await Promise.all(Array.from({length:8},(_,i)=>appendToNotes(library,{paperId:emptyId,text:`parallel-${i}`})))
  const parallel=(await readNotes(library,emptyId)).markdown
  check('all concurrent note appends survive',Array.from({length:8},(_,i)=>parallel.includes(`parallel-${i}`)).every(Boolean),true)
  const snapshots=await listRevisions(library,emptyId,'notes')
  check('successful appends have history',snapshots.length,versionCount+8)
  const beforeRace=await documentState(library,emptyId,'notes')
  await assert.rejects(()=>editDocument(library,emptyId,'notes',async()=>{await writeFile(path.join(library,'papers',emptyId,'notes.md'),'cloud edit');return 'overwrite'}, {expectedHash:beforeRace.hash,reason:'race test'}),/changed/);checks++
  check('detected external write is not overwritten',(await readNotes(library,emptyId)).markdown,'cloud edit')
  const failedId='snapshot-failure';await mkdir(path.join(library,'papers',failedId));await writeFile(path.join(library,'papers',failedId,'meta.json'),'{}');await writeFile(path.join(library,'papers',failedId,'notes.md'),'safe')
  await mkdir(path.join(library,'.paperdesk/history',failedId),{recursive:true});await writeFile(path.join(library,'.paperdesk/history',failedId,'notes'),'blocked')
  await assert.rejects(()=>writeNotes(library,failedId,'unsafe'));checks++
  check('snapshot failure aborts the edit',(await readNotes(library,failedId)).markdown,'safe')
  for (const [id,kind,revisionId] of [['../escape','notes',first.id],[paperId,'cards',first.id],[paperId,'notes','../../bad']]) {
    await assert.rejects(()=>readRevision(library,id,kind,revisionId));checks++
  }
  server=createServer((req,res)=>{void buildRoutes(config)[0].handler(req,res)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url=`http://127.0.0.1:${server.address().port}/api/paper-desk`
  const api=async(route,method='GET',body)=>{const res=await fetch(url+route,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()}}
  const listed=await api(`/history?id=${paperId}&kind=notes`)
  check('history API exposes current version and previews without editing',[listed.status,typeof listed.data.currentHash,listed.data.versions.length>0],[200,'string',true])
  const stateBefore=await documentState(library,paperId,'notes')
  const preview=await api(`/history/version?id=${paperId}&kind=notes&revisionId=${first.id}`)
  check('history preview is exact and read-only',[preview.data.content,(await documentState(library,paperId,'notes')).hash],[original,stateBefore.hash])
  check('HTTP restore requires version token',(await api(`/history/restore?id=${paperId}&kind=notes`,'POST',{revisionId:first.id})).status,400)
  check('HTTP rejects stale restoration',(await api(`/history/restore?id=${paperId}&kind=notes`,'POST',{revisionId:first.id,expectedHash:'stale'})).status,409)
  const success=await api(`/history/restore?id=${paperId}&kind=notes`,'POST',{revisionId:first.id,expectedHash:stateBefore.hash})
  check('HTTP restore performs an actual versioned write',[success.status,success.data.ok,(await readNotes(library,paperId)).markdown],[200,true,original])
  check('unknown history kind rejected',(await api(`/history?id=${paperId}&kind=other`)).status,400)
  console.log(`${checks} document history/edit checks passed`)
} finally {
  if(server) await new Promise(resolve=>server.close(resolve))
  if(oldHome===undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=oldHome
  await rm(root,{recursive:true,force:true})
}
