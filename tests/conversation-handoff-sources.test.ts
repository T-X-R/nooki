import assert from 'node:assert/strict'
import test from 'node:test'
const calls: {command:string;args:any}[]=[]
let sourceCount=2
const draftId='a'.repeat(64)
const values=new Map<string,string>()
Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)},__TAURI_INTERNALS__:{invoke:async(command:string,args:any)=>{
  calls.push({command,args})
  if(command==='conversation_handoff_sources') return Array.from({length:sourceCount},(_,i)=>({reference:{kind:'library-document',documentId:`document-${i}`,title:`Source ${i}`,revision:'original',snapshotId:'manual-send'},content:'Retained original text',documentDate:'2026-11-26'}))
  if(command==='conversation_run') return {threadId:'chat',turnId:'turn'}
  throw new Error(`Unexpected ${command}`)
}}}})
const {respond}=await import('../src/features/conversation/conversation-jobs.ts')
const input={threadId:'chat',message:'Review',snapshotId:'manual-send',documentIds:['extra'],handoffId:draftId,uploads:[{id:'upload',name:'notes.txt',content:'User upload'}]}
const context=()=>({executionId:'run:attempt',signal:new AbortController().signal,step:async(_:string,run:()=>Promise<unknown>)=>run()})
test('manual handoff send uses native retained sources and preserves user uploads and citation snapshot',async()=>{
  calls.length=0
  assert.deepEqual(await respond.run(input,context()),{threadId:'chat',turnId:'turn'})
  assert.deepEqual(calls[0],{command:'conversation_handoff_sources',args:{request:{draftId,snapshotId:'manual-send',documentIds:['extra']}}})
  const request=calls[1].args.request
  assert.equal(request.snapshotId,'manual-send')
  assert.ok(request.context.includes('manual-send'))
  assert.deepEqual(request.uploads,input.uploads)
  assert.equal(calls.length,2,'offered references are never recaptured by Library ID')
})
test('checkpoint replay keeps the same retained snapshot without recapture',async()=>{
  calls.length=0
  const checkpoints=new Map<string,unknown>();const ctx={...context(),step:async(key:string,run:()=>Promise<unknown>)=>{if(!checkpoints.has(key))checkpoints.set(key,await run());return checkpoints.get(key)}}
  await respond.run(input,ctx)
  checkpoints.delete('codex-turn')
  await respond.run(input,ctx)
  assert.equal(calls.filter(c=>c.command==='conversation_handoff_sources').length,1)
  assert.deepEqual(calls.filter(c=>c.command==='conversation_run').map(c=>c.args.request.snapshotId),['manual-send','manual-send'])
})
test('invalid offers, board sessions and cancellation fail before native work; combined source limits block sends',async()=>{
  calls.length=0
  await assert.rejects(respond.run({...input,handoffId:'invalid'},context()),/handoff/i)
  await assert.rejects(respond.run({...input,boardTask:{runId:'task',title:'Task'}},context()),/handoff/i)
  const stopped=new AbortController();stopped.abort();await assert.rejects(respond.run(input,{...context(),signal:stopped.signal}))
  assert.equal(calls.length,0)
  sourceCount=50
  await assert.rejects(respond.run(input,context()),/50/)
  assert.equal(calls.some(c=>c.command==='conversation_run'),false)
  sourceCount=2
})
