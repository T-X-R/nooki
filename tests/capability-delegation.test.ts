import assert from 'node:assert/strict'
import test from 'node:test'
import {createDelegationClient,invalidateDelegations} from '../src/platform/capability-delegation.ts'
import {createDelegationReview} from '../src/platform/delegation-review.ts'
const input={item:{id:'task',revision:1}},options={idempotencyKey:'one'},tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(){
  const review=createDelegationReview(),calls:{command:string;args:any}[]=[],receipt={receiptId:'d'.repeat(64),taskId:'task',engine:'codex' as const}
  const config={id:'example.notes',name:'Notes',version:'1.0.0',permission:true,desktop:true,assertActive(){},onDispose(){},open:review.open,
    invoke:async(command:string,args:any):Promise<any>=>{calls.push({command,args});if(command==='capability_delegation_begin')return{status:'pending',handle:'a'.repeat(64),requestId:args.request.requestId,capabilityId:'example.notes',version:'1.0.0'};if(command==='capability_delegation_inspect')return{title:'Follow-up',description:'Retained notes',documents:[],deliveries:[]};if(command==='capability_delegation_commit')return receipt}}
  return{review,calls,receipt,config}
}
test('Host review precedes execution; dismissal does not commit and proposal is frozen',async()=>{
  const f=fixture(),client=createDelegationClient(f.config),mutable=structuredClone(input)
  const result=client.board.requestDelegation(mutable,options);mutable.item.id='other';await tick()
  assert.equal(f.calls[0].args.request.input.item.id,'task');assert.equal(f.review.getSnapshot()!.details.description,'Retained notes')
  assert.ok(!f.calls.some(c=>c.command==='capability_delegation_commit'));f.review.dismiss(f.review.getSnapshot()!)
  assert.deepEqual(await result,{status:'dismissed'});await client.dispose()
})
test('lost commit reply retries the same handle; replay returns receipt without another review',async()=>{
  const f=fixture();let attempt=0
  const client=createDelegationClient({...f.config,invoke:async(command,args)=>{if(command==='capability_delegation_commit'&&++attempt===1)throw new Error('Lost reply');return f.config.invoke(command,args)}})
  const result=client.board.requestDelegation(input,options);await tick();const shown=f.review.getSnapshot()!
  await assert.rejects(shown.confirm(),{code:'OUTCOME_UNKNOWN'});const receipt=await shown.confirm();f.review.complete(shown,{status:'delegated',receipt})
  assert.deepEqual(await result,{status:'delegated',receipt:f.receipt});await client.dispose()
  const replay=createDelegationClient({...f.config,invoke:async command=>command==='capability_delegation_begin'?{status:'committed',receipt}:undefined})
  assert.deepEqual(await replay.board.requestDelegation(input,options),{status:'delegated',receipt});assert.equal(f.review.getSnapshot(),null);await replay.dispose()
})
test('revocation closes review; no permissions or preview cannot request execution',async()=>{
  const f=fixture(),client=createDelegationClient(f.config)
  const result=client.board.requestDelegation(input,options),cancelled=assert.rejects(result,{code:'CANCELLED'});await tick();const shown=f.review.getSnapshot()!
  await invalidateDelegations('example.notes');await cancelled;await assert.rejects(shown.confirm(),{code:'CANCELLED'})
  for(const patch of [{permission:false},{desktop:false}]){const c=createDelegationClient({...f.config,...patch});await assert.rejects(c.board.requestDelegation(input,options));await c.dispose()}
  assert.ok(!f.calls.some(c=>c.command==='capability_delegation_commit'))
})
