import assert from 'node:assert/strict'
import test from 'node:test'
import {createHandoffClient,invalidateHandoffs} from '../src/platform/capability-handoff.ts'
import {createHandoffReview} from '../src/platform/handoff-review.ts'
const input={title:'Review',text:'Original draft',sources:[]}
const options={idempotencyKey:'one'}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(){
  const review=createHandoffReview(),calls:{command:string;args:any}[]=[],opened:string[]=[]
  const receipt={draftId:'d'.repeat(64),target:{kind:'new' as const}}
  const config={id:'example.reader',version:'1.0.0',name:'Reader',permission:true,desktop:true,assertActive(){},onDispose(){},open:review.open,onCommitted:(id:string)=>opened.push(id),
    invoke:async(command:string,args:any):Promise<any>=>{calls.push({command,args});if(command==='conversation_handoff_begin')return{status:'pending',handle:'a'.repeat(64),requestId:args.request.requestId,capabilityId:'example.reader',version:'1.0.0'};if(command==='conversation_handoff_commit')return receipt;if(command==='conversation_handoff_targets')return{data:[{id:'chat',title:'Chat'}],nextCursor:null,partial:false}}}
  return{review,calls,opened,receipt,config}
}
test('immutable proposal reaches Host review, dismissal releases without navigation',async()=>{
  const f=fixture(),client=createHandoffClient(f.config),mutable=structuredClone(input)
  const pending=client.conversations.handoff(mutable,options);mutable.text='Changed';await tick()
  const shown=f.review.getSnapshot()!;assert.equal(shown.draft.text,'Original draft')
  assert.deepEqual(await shown.targets(),{data:[{id:'chat',title:'Chat'}],nextCursor:null,partial:false})
  f.review.dismiss(shown);assert.deepEqual(await pending,{status:'dismissed'});assert.deepEqual(f.opened,[])
  assert.equal(f.calls.at(-1)?.command,'conversation_handoff_cancel');await client.dispose()
})
test('confirmed receipt navigates once; committed replay returns metadata without navigation',async()=>{
  const f=fixture(),client=createHandoffClient(f.config)
  const pending=client.conversations.handoff(input,options);await tick();const shown=f.review.getSnapshot()!
  const receipt=await shown.confirm({kind:'new'});f.review.complete(shown,{status:'handedOff',receipt})
  assert.deepEqual(await pending,{status:'handedOff',receipt:f.receipt});assert.deepEqual(f.opened,[f.receipt.draftId]);await client.dispose()
  const replay=createHandoffClient({...f.config,invoke:async(command,args)=>command==='conversation_handoff_begin'?{status:'committed',receipt:f.receipt}:f.config.invoke(command,args)})
  assert.deepEqual(await replay.conversations.handoff(input,options),{status:'handedOff',receipt:f.receipt});assert.equal(f.opened.length,1);await replay.dispose()
})
test('unknown commit outcomes retry frozen target; overlapping reviews and changed targets fail',async()=>{
  const f=fixture();let attempt=0
  const client=createHandoffClient({...f.config,invoke:async(command,args)=>{if(command==='conversation_handoff_commit'&&++attempt===1)throw new Error('reply lost');return f.config.invoke(command,args)}})
  const pending=client.conversations.handoff(input,options);await tick();const shown=f.review.getSnapshot()!
  await assert.rejects(client.conversations.handoff(input,options),{code:'RESOURCE_BUSY'})
  await assert.rejects(shown.confirm({kind:'new'}),{code:'OUTCOME_UNKNOWN'})
  await assert.rejects(shown.confirm({kind:'conversation',id:'chat'}),{code:'CONFLICT'})
  const receipt=await shown.confirm({kind:'new'});f.review.complete(shown,{status:'handedOff',receipt});await pending;await client.dispose()
})
test('disable or disposal during begin cancels late review and never opens a draft',async()=>{
  const f=fixture();let unblock!:(v:unknown)=>void
  const client=createHandoffClient({...f.config,invoke:async(command,args)=>command==='conversation_handoff_begin'?new Promise(resolve=>{unblock=()=>resolve({status:'pending',handle:'a'.repeat(64),requestId:args.request.requestId,capabilityId:'example.reader',version:'1.0.0'})}):f.config.invoke(command,args)})
  const pending=client.conversations.handoff(input,options);const rejected=assert.rejects(pending,{code:'CANCELLED'});await tick();await invalidateHandoffs('example.reader');unblock(null);await rejected
  assert.equal(f.review.getSnapshot(),null);assert.deepEqual(f.opened,[])
})
test('caller-supplied target, invalid sources, missing permission and preview fail before native calls',async()=>{
  const f=fixture(),client=createHandoffClient(f.config)
  for(const proposal of [{...input,target:{kind:'new'}},{...input,text:''},{...input,sources:null},{...input,sources:[{kind:'library-document',documentId:'doc',title:'Notes'}]}])await assert.rejects(client.conversations.handoff(proposal as never,options),{code:'INVALID_INPUT'})
  const denied=createHandoffClient({...f.config,permission:false}),preview=createHandoffClient({...f.config,desktop:false})
  await assert.rejects(denied.conversations.handoff(input,options),{code:'PERMISSION_DENIED'});await assert.rejects(preview.conversations.handoff(input,options),{code:'UNSUPPORTED_SERVICE'})
  assert.deepEqual(f.calls,[]);await Promise.all([client.dispose(),denied.dispose(),preview.dispose()])
})

test('malformed native commit targets preserve outcome uncertainty',async()=>{
  const f=fixture(),client=createHandoffClient({...f.config,invoke:async(command,args)=>command==='conversation_handoff_commit'?{draftId:'d'.repeat(64),target:{kind:'foreign'}}:f.config.invoke(command,args)})
  const pending=client.conversations.handoff(input,options);await tick();const shown=f.review.getSnapshot()!
  await assert.rejects(shown.confirm({kind:'new'}),{code:'OUTCOME_UNKNOWN'})
  f.review.dismiss(shown);await pending;assert.deepEqual(f.opened,[]);await client.dispose()
})
test('disposal during an uncertain commit suppresses the late result and navigation',async()=>{
  const f=fixture();let finish!:(value:unknown)=>void
  const client=createHandoffClient({...f.config,invoke:async(command,args)=>command==='conversation_handoff_commit'?new Promise(resolve=>{finish=resolve}):f.config.invoke(command,args)})
  const pending=client.conversations.handoff(input,options),cancelled=assert.rejects(pending,{code:'CANCELLED'});await tick()
  const commit=f.review.getSnapshot()!.confirm({kind:'new'}),late=assert.rejects(commit,{code:'CANCELLED'});await client.dispose();finish(f.receipt);await Promise.all([cancelled,late]);assert.deepEqual(f.opened,[])
})
