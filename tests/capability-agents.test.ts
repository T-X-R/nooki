import assert from 'node:assert/strict'
import test from 'node:test'
import {createAgentClient,invalidateAgentClients} from '../src/platform/capability-agents.ts'
import {createAgentReview} from '../src/platform/agent-review.ts'
import type {AgentRunSnapshot,AgentStartInput} from '../packages/capability-contract/src/index.ts'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const input:AgentStartInput={agentId:'codex',instructions:'Summarize selected meeting notes',sources:[]}
const options={idempotencyKey:'meeting-one'},id='b'.repeat(64)
function fixture(){
  const review=createAgentReview(),calls:{command:string;args:any}[]=[]
  const run:AgentRunSnapshot={id,agentId:'codex',status:'running',restored:false,result:null}
  const config={id:'example.meeting',version:'1.0.0',name:'Meeting',permission:true,desktop:true,assertActive(){},onDispose(){},open:review.open,
    invoke:async(command:string,args:any):Promise<any>=>{
      calls.push({command,args})
      if(command==='capability_agent_available')return[{id:'codex',name:'Codex'}]
      if(command==='capability_agent_begin')return{status:'pending',handle:'a'.repeat(64),requestId:args.request.requestId,capabilityId:'example.meeting',version:'1.0.0'}
      if(command==='capability_agent_approve')return{id}
      if(['capability_agent_start','capability_agent_get','capability_agent_cancel'].includes(command))return run
    }}
  return{review,calls,run,config}
}
test('review receives frozen intent; only confirmation approves and starts; dismissal has no effect',async()=>{
  const f=fixture(),client=createAgentClient(f.config),mutable=structuredClone(input)
  const pending=client.agents.start(mutable,options);mutable.instructions='Changed';await tick()
  const shown=f.review.getSnapshot()!;assert.equal(shown.proposal.instructions,input.instructions)
  assert.deepEqual(f.calls.map(c=>c.command),['capability_agent_begin'])
  f.review.dismiss(shown);assert.deepEqual(await pending,{status:'dismissed'})
  const next=client.agents.start(input,options);await tick();const approved=f.review.getSnapshot()!
  f.review.complete(approved,await approved.confirm());assert.deepEqual(await next,{status:'started',run:f.run})
  assert.deepEqual(f.calls.slice(-3).map(c=>c.command),['capability_agent_approve','capability_agent_start','capability_agent_dismiss'])
  await client.dispose()
})
test('uncertain dispatch retry uses one approval and original run; existing run needs no review or dispatch',async()=>{
  const f=fixture();let attempts=0
  const client=createAgentClient({...f.config,invoke:async(command,args)=>{if(command==='capability_agent_start'&&++attempts===1)throw new Error('lost reply');return f.config.invoke(command,args)}})
  const pending=client.agents.start(input,options);await tick();const shown=f.review.getSnapshot()!
  await assert.rejects(shown.confirm(),{code:'OUTCOME_UNKNOWN'})
  const run=await shown.confirm();f.review.complete(shown,run);await pending
  assert.equal(f.calls.filter(c=>c.command==='capability_agent_approve').length,1)
  assert.equal(f.calls.find(c=>c.command==='capability_agent_start')!.args.request.runId,id)
  await client.dispose()
  const replay=createAgentClient({...f.config,open:async()=>{throw new Error('must not review')},invoke:async(command)=>{if(command==='capability_agent_dismiss')return;assert.equal(command,'capability_agent_begin');return{status:'existing',run:f.run}}})
  assert.deepEqual(await replay.agents.start(input,options),{status:'started',run:f.run});await replay.dispose()
})
test('missing authority and package-selected private fields are rejected before native work',async()=>{
  const f=fixture(),client=createAgentClient(f.config)
  for(const proposal of [{...input,policyDigest:'private'},{...input,instructions:''},{...input,sources:null},{...input,sources:[{kind:'library-document',documentId:'doc',title:'Notes'}]},{...input,outputSchema:[]}])await assert.rejects(client.agents.start(proposal as never,options),{code:'INVALID_INPUT'})
  const denied=createAgentClient({...f.config,permission:false}),preview=createAgentClient({...f.config,desktop:false})
  await assert.rejects(denied.agents.start(input,options),{code:'PERMISSION_DENIED'});await assert.rejects(preview.agents.start(input,options),{code:'UNSUPPORTED_SERVICE'})
  assert.deepEqual(f.calls,[]);await Promise.all([client.dispose(),denied.dispose(),preview.dispose()])
})
test('subscriptions use fresh snapshots, terminal read stops, unsubscribe discards late data without cancellation',async()=>{
  const f=fixture(),complete={...f.run,status:'completed' as const,result:{text:'Meeting notes'}}
  const client=createAgentClient({...f.config,invoke:async(command)=>{assert.equal(command,'capability_agent_get');return complete}})
  const snapshots:AgentRunSnapshot[]=[];client.agents.subscribe(id,run=>snapshots.push(run),cause=>assert.fail(cause.message));await tick()
  assert.deepEqual(snapshots,[complete]);assert.ok(Object.isFrozen(snapshots[0].result));await client.dispose()
  let finish!:(value:unknown)=>void;const calls:string[]=[]
  const late=createAgentClient({...f.config,invoke:async(command)=>{calls.push(command);return new Promise(resolve=>{finish=resolve})}})
  const stop=late.agents.subscribe(id,()=>assert.fail('late callback'),()=>assert.fail('late error'));stop();finish(f.run);await tick();await late.dispose()
  assert.deepEqual(calls,['capability_agent_get'])
})
test('cancel reports observed running status; invalidation stops reviews and late confirmations',async()=>{
  const f=fixture(),client=createAgentClient(f.config)
  assert.equal((await client.agents.cancel(id)).status,'running')
  const pending=client.agents.start(input,options),cancelled=assert.rejects(pending,{code:'CANCELLED'});await tick();const shown=f.review.getSnapshot()!
  await invalidateAgentClients('example.meeting');await cancelled
  await assert.rejects(shown.confirm(),{code:'CANCELLED'});assert.equal(f.calls.filter(c=>c.command==='capability_agent_approve').length,0)
})
