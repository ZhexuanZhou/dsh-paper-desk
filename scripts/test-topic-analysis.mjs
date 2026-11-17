import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const root=await mkdtemp(path.join(os.tmpdir(),'zhiyetopicjob-'))
let count=0
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);count++;console.log(`ok ${name}`)}
try {
 const file=path.join(root,'job.mjs')
 await build({stdin:{contents:"export * from './client/topicAnalysis.ts'; export {api} from './client/api.ts'",resolveDir:process.cwd(),loader:'ts'},outfile:file,bundle:true,platform:'node',format:'esm',plugins:[{name:'controlled-session',setup(b){b.onResolve({filter:/aiSession\.js$/},()=>({path:'session',namespace:'controlled'}));b.onLoad({filter:/.*/,namespace:'controlled'},()=>({contents:'export const createAiThread = () => globalThis.__topicAi();',loader:'js'}))}}]})
 const mod=await import(pathToFileURL(file));let calls=0,saves=0,controller;const prepares=[],savedVersions=[]
 const make=()=>{let state={status:'ready',rows:[]};const listeners=new Set();const emit=(next)=>{state=next;for(const f of listeners)f()};const ai={openThread:async()=>{},getSnapshot:()=>state,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},run:async()=>{calls++;emit({status:'running',rows:[]});return{ok:true}},lastAnswer:()=>state.rows.filter(r=>r.kind==='assistant').map(r=>r.text).join('\n\n'),stop:async()=>emit({status:'ready',rows:state.rows}),dispose:()=>listeners.clear(),emit};controller=ai;return ai}
 globalThis.__topicAi=make
 mod.api.topicPrompt=async(...args)=>{prepares.push(args);return{prompt:'controlled context',inputHash:'scope',analysisHash:'report-before-generation'}}
 mod.api.saveTopicAnalysis=async(id,inputHash,paperIds,markdown,expectedHash)=>{savedVersions.push(expectedHash);saves++;return{document:{topics:[{id,analysis:{markdown}}]},hash:'saved'}}
 const ctx={};const promise=mod.startTopicAnalysis(ctx,'root:topic','root','topic','question',['paper'])
 await new Promise(r=>setImmediate(r))
 check('explicit creation starts one model request',calls,1)
 check('a second click while running does not resubmit',await mod.startTopicAnalysis(ctx,'root:topic','root','topic','question',['paper']),null)
 controller.emit({status:'running',rows:[{id:'a',kind:'assistant',text:'partial',streaming:true}]})
 check('streaming text is shown without prematurely persisting', [mod.topicAnalysisState(ctx,'root:topic').markdown,saves],['partial',0])
 controller.emit({status:'ready',rows:[{id:'a',kind:'assistant',text:'Final $x>1$ (p.1)',streaming:false}]})
 await promise
 check('finished interpretation is persisted exactly once',saves,1)
 check('report generation requests the read-only analysis phase',prepares[0].at(-1),'analysis')
 check('saving uses the report version read before generation',savedVersions,['report-before-generation'])
 check('reopening the state does not call the model', [mod.topicAnalysisState(ctx,'root:topic').phase,calls],['complete',1])
 const stopped=mod.startTopicAnalysis(ctx,'root:stop','root','stop','question',['paper']);await new Promise(r=>setImmediate(r));await mod.stopTopicAnalysis(ctx,'root:stop');await stopped
 check('stopping never persists a partial interpretation',saves,1)
 check('stopped job has a visible retryable error',mod.topicAnalysisState(ctx,'root:stop').phase,'error')
 mod.api.saveTopicAnalysis=async()=>{throw Error('scope changed')}
 const stale=mod.startTopicAnalysis(ctx,'root:stale','root','stale','question',['paper']);await new Promise(r=>setImmediate(r));controller.emit({status:'ready',rows:[{id:'b',kind:'assistant',text:'old scope'}]});await stale
 check('failed save retains generated text and reports why',[mod.topicAnalysisState(ctx,'root:stale').phase,mod.topicAnalysisState(ctx,'root:stale').markdown,mod.topicAnalysisState(ctx,'root:stale').error],['error','old scope','scope changed'])
 console.log(`${count} topic job checks passed`)
}finally{delete globalThis.__topicAi;await rm(root,{recursive:true,force:true})}
