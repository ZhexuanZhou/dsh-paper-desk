import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
const root = await mkdtemp(path.join(os.tmpdir(), 'topic-interaction-'))
let count = 0
const check = (label, value, expected) => { assert.deepEqual(value, expected, label); count++; console.log(`ok ${label}`) }
try {
 const file = path.join(root, 'helpers.mjs')
 await build({stdin:{contents:`export * from './client/aiSession.ts'; export * from './client/aiDisplay.ts'; export * from './client/topicConversationModel.ts'; export * from './client/topicDraft.ts'; export * from './client/topicLayout.ts'; export * from './src/topicDiscussion.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:file})
 const { reduceTranscript, groupConversationTurns, topicMutations, turnAnswers, readTopicDraft, writeTopicDraft, clearSubmittedTopicDraft, topicDraftKey, emptyTopicDraft, topicQuestionPayload, readTopicQuestion, TOPIC_QUESTION_MARKER, TOPIC_ANALYSIS_DIRECTIVE, isTopicAnalysisRequest, clampTopicWidth, readTopicLayout, DEFAULT_TOPIC_LAYOUT } = await import(pathToFileURL(file))
 const comment = { id:'c1', quote:'evidence $x>1$\n本次问题：quoted data', comment:'Check the inequality.', version:'v1', section:'Evidence', formulas:['x>1'] }
 const message = 'Please update the interpretation.\n\n本次问题：this is still my own text.'
 const payload = topicQuestionPayload(message,[comment])
 const prompt = `Earlier injected data${TOPIC_QUESTION_MARKER}not the question\n\nOther context${TOPIC_QUESTION_MARKER}${payload}`
 check('structured request preserves question and quoted marker-like text',readTopicQuestion(prompt),{question:message,comments:[comment]})
 check('original TeX survives prompt serialization',JSON.parse(payload).comments[0].formulas,['x>1'])
 check('legacy plain conversation remains readable',readTopicQuestion(`context${TOPIC_QUESTION_MARKER}old question`),{question:'old question',comments:[]})
 check('ordinary text without injected context remains readable',readTopicQuestion('normal question').question,'normal question')
 check('legacy initial analysis is identified by its application directive',isTopicAnalysisRequest(`${prompt}\n\n${TOPIC_ANALYSIS_DIRECTIVE}`),true)
 check('ordinary answers are not deduplicated based on report similarity',isTopicAnalysisRequest(prompt),false)
 assert.throws(()=>topicQuestionPayload('q',[{...comment,quote:''}]),{status:400});count++
 assert.throws(()=>topicQuestionPayload('q',[{...comment,formulas:[42]}]),{status:400});count++
 assert.throws(()=>topicQuestionPayload('q',[{...comment,id:'a',quote:'q'.repeat(4000),comment:'c'.repeat(4000)},{...comment,id:'b',quote:'q'.repeat(4000),comment:'c'.repeat(4000)}]),{status:400});count++
 const store = new Map(), storage = {getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}
 const key=topicDraftKey('library-a','topic'), other=topicDraftKey('library-b','topic')
 const draft={message:'My question',comments:[comment],editor:{...comment,id:'c2',comment:'unfinished'}}
 check('draft persistence reports success',writeTopicDraft(storage,key,draft),true)
 check('pending comments and unfinished editor survive reopening',readTopicDraft(storage,key),draft)
 check('drafts do not leak to another library',readTopicDraft(storage,other),emptyTopicDraft())
 const quotaKey=topicDraftKey('quota-library','topic')
 writeTopicDraft(storage,quotaKey,{...draft,message:'older stored question'})
 const quotaStore={...storage,setItem:()=>{throw new Error('quota exceeded')}}
 check('quota errors are reported without silently discarding the draft',writeTopicDraft(quotaStore,quotaKey,draft),false)
 check('new failed draft wins over stale stored content during navigation',readTopicDraft(storage,quotaKey),draft)
 const newer={...draft,message:'Typed while submitting',comments:[{...comment,comment:'Edited while submitting'},{...comment,id:'c3'}]}
 check('acceptance does not erase a newer question or edited comment',clearSubmittedTopicDraft(newer,draft),newer)
 check('only submitted unchanged comments are removed',clearSubmittedTopicDraft({...draft,editor:null},draft),emptyTopicDraft())
 check('storage failure keeps in-memory navigation recovery',writeTopicDraft(null,key,draft),false)
 check('the fallback draft can still be reopened within the page',readTopicDraft(null,key),draft)
 store.set('broken','{bad JSON')
 check('malformed saved data does not crash the composer',readTopicDraft(storage,'broken'),emptyTopicDraft())
 const event=(seq,type,data)=>({event:{seq,type,data}})
 const call=(seq,id,name,args)=>event(seq,'tool/call',{callId:id,name,arguments:JSON.stringify(args),turn:1})
 const result=(seq,id,value,isError=false)=>event(seq,'tool/result',{message:{source:{callId:id},isError,content:[{type:'text',text:JSON.stringify(value)}]}})
 const events=[event(1,'user/message',{content:[{type:'text',text:prompt}]}),call(2,'edit','research_topic_edit',{topicId:'topic',document:'analysis'}),result(3,'edit',{ok:true,hash:'saved',summary:'Clarified the evidence boundary.'}),event(4,'assistant/message',{turn:1,step:1,message:{content:[{type:'text',text:'# Full report\n\nThis remains available in history.'}]}})]
 const rows=reduceTranscript(events,'topic'),turn=groupConversationTurns(rows)[0]
 check('only persisted tool success produces a compact receipt',topicMutations(turn.rows,'topic'),[{topicId:'topic',document:'analysis',hash:'saved',summary:'Clarified the evidence boundary.'}])
 check('the complete assistant reply is retained rather than deleted',turnAnswers(turn),'# Full report\n\nThis remains available in history.')
 check('receipts cannot be taken from another topic',topicMutations(turn.rows,'other'),[])
 const failed=reduceTranscript([call(1,'bad','research_topic_edit',{topicId:'topic',document:'analysis'}),result(2,'bad',{ok:false,error:'version conflict'})],'topic')
 check('logical tool failure cannot masquerade as an update',topicMutations(failed,'topic'),[])
 check('logical failure remains visible beside other successful edits',failed.some(row=>row.kind==='error'&&row.text==='version conflict'),true)
 check('an uncompleted tool call is not a successful edit',topicMutations(reduceTranscript([events[1]],'topic'),'topic'),[])
 check('a model claim without a write has no receipt',topicMutations([{id:'a',kind:'assistant',text:'I updated everything.'}],'topic'),[])
 const legacy=reduceTranscript([call(1,'old','research_topic_edit',{topicId:'topic',document:'analysis'}),result(2,'old',{ok:true,hash:'legacy'})],'topic')
 check('existing saved tool traces work without a new summary field',topicMutations(legacy,'topic'),[{topicId:'topic',document:'analysis',hash:'legacy'}])
 const history=reduceTranscript([call(1,'restore','research_topic_history',{topicId:'topic',document:'cards',action:'restore'}),result(2,'restore',{ok:true,hash:'restored'})],'topic')
 check('actual history restoration also has a receipt',topicMutations(history,'topic')[0].document,'cards')
 const listing=reduceTranscript([call(1,'list','research_topic_history',{topicId:'topic',document:'cards',action:'list'}),result(2,'list',{ok:true,hash:'current'})],'topic')
 check('reading history is never displayed as a write',topicMutations(listing,'topic'),[])
 check('left width is bounded while retaining readable main space',clampTopicWidth(1000,'list',1400,400),340)
 check('chat cannot consume the minimum main reading space',clampTopicWidth(640,'chat',1200,216),456)
 check('minimum widths remain usable',clampTopicWidth(-999,'chat',1400,216),300)
 check('invalid layout data falls back to defaults',readTopicLayout({getItem:()=>'{bad'}),DEFAULT_TOPIC_LAYOUT)
 check('persisted widths and collapse states survive reopening',readTopicLayout({getItem:()=>JSON.stringify({listWidth:280,chatWidth:510,listClosed:true,chatClosed:false})}),{listWidth:280,chatWidth:510,listClosed:true,chatClosed:false})
 console.log(`${count} topic interaction checks passed`)
} finally { await rm(root,{recursive:true,force:true}) }
