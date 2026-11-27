// Synthetic acceptance fixture only. Never imported by the capability entry or packaged as a Host.
import {createPreviewHost} from '../../preview/host.ts'
import {capabilityId,readMeeting,summarize} from '../../meeting.ts'
import type {AgentRunSnapshot,CapabilityManifest,TaskRecord} from '../../contract/index.ts'
export function fixture(options:{autoComplete?:boolean;dismissAgent?:boolean;loseAttachmentReply?:boolean;invalidResult?:boolean;loseDelegationReply?:boolean;dismissDelegation?:boolean}={}){
 const manifest:CapabilityManifest={id:capabilityId,name:'Meeting',version:'1.0.0',minPlatformVersion:'0.15.0',entrypoints:['page','job'],permissions:['storage']}
 const {host,setEnvironment}=createPreviewHost(manifest)
 const calls={starts:0,publishes:0,creates:0,selections:0,attachments:0,handoffs:0,delegations:0,delegationInputs:[] as unknown[],todoInputs:[] as unknown[],opened:[] as unknown[],agentInputs:[] as unknown[],attachmentInputs:[] as unknown[]}
 const runByKey=new Map<string,AgentRunSnapshot>(),runs=new Map<string,AgentRunSnapshot>(),listeners=new Map<string,Set<(run:AgentRunSnapshot)=>void>>()
 const publications=new Map<string,unknown>(),todos=new Map<string,unknown>(),attachments=new Map<string,unknown>(),drafts=new Map<string,unknown>()
 const source={kind:'library-document' as const,documentId:'synthetic-transcript',title:'Synthetic project meeting',grantId:'synthetic-grant',revision:'v1'}
 const emitRun=(run:AgentRunSnapshot)=>{runs.set(run.id,run);for(const listener of listeners.get(run.id)??[])listener(run)}
 host.library.requestSelection=async()=>({status:'selected',grant:{id:'synthetic-grant',capabilityId,capabilityVersion:'1.0.0',createdAt:'2026-11-27',documents:[{reference:source,documentDate:'2026-11-27'}]}})
 host.agents.listAvailable=async()=>[{id:'codex',name:'Codex'}]
 host.agents.start=async(input,request)=>{
  if(options.dismissAgent)return{status:'dismissed'}
  const prior=runByKey.get(request.idempotencyKey);if(prior)return{status:'started',run:runs.get(prior.id)!}
  calls.starts++;calls.agentInputs.push(structuredClone({input,request}))
  const run:AgentRunSnapshot={id:String(calls.starts).padStart(64,'a'),agentId:'codex',status:'running',restored:false,cancellationRequested:false,result:null}
  runByKey.set(request.idempotencyKey,run);runs.set(run.id,run)
  const data={language:input.instructions.includes('Chinese')?'zh':'en',summary:'The prototype is ready.',decisions:['Ship the prototype.'],actions:[{task:'Share the draft',owner:'Alex',due:'Friday'}],openQuestions:['Budget not specified.']}
  if(options.autoComplete!==false)setTimeout(()=>emitRun(options.invalidResult?{...run,status:'failed',error:{code:'INVALID_RESULT',message:'Result does not match schema'}}:{...run,status:'completed',result:input.outputSchema?{text:JSON.stringify(data),data}:{text:'Meeting notes ready'}}),20)
  return{status:'started',run}
 }
 host.agents.get=async id=>runs.get(id)!
 host.agents.cancel=async id=>{const run={...runs.get(id)!,status:'cancelled' as const,cancellationRequested:true};emitRun(run);return run}
 host.agents.subscribe=(id,listener)=>{let group=listeners.get(id);if(!group){group=new Set();listeners.set(id,group)}group.add(listener);queueMicrotask(()=>{if(group!.has(listener))listener(runs.get(id)!)});return()=>{group!.delete(listener)}}
 host.documents.publish=async value=>{calls.publishes++;publications.set(value.key,structuredClone(value))}
 host.documents.open=reference=>{calls.opened.push(structuredClone(reference))}
 host.board.create=async(input,request)=>{let receipt=todos.get(request.idempotencyKey);if(!receipt){calls.creates++;calls.todoInputs.push(structuredClone(input));receipt={id:'synthetic-todo',revision:1};todos.set(request.idempotencyKey,receipt)}return receipt as {id:string;revision:number}}
 host.board.requestSelection=async()=>{calls.selections++;return{status:'selected',grant:{id:'synthetic-board-grant',capabilityId,capabilityVersion:'1.0.0',createdAt:'2026-11-27',purpose:'Attach notes',operations:['attachDelivery'],items:[{id:'synthetic-todo',revision:1,title:'Review meeting'}]}}}
 host.board.attachDelivery=async(input,request)=>{
  calls.attachmentInputs.push(structuredClone({input,request}));let receipt=attachments.get(request.idempotencyKey)
  if(!receipt){calls.attachments++;receipt={item:{id:input.item.id,revision:2},deliveryId:'synthetic-delivery'};attachments.set(request.idempotencyKey,receipt)}
  if(options.loseAttachmentReply){options.loseAttachmentReply=false;throw Object.assign(new Error('Synthetic lost reply'),{code:'OUTCOME_UNKNOWN'})}
  return receipt as {item:{id:string;revision:number};deliveryId:string}
 }
 const delegated=new Map<string,unknown>()
 host.board.requestDelegation=async(input,request)=>{
  calls.delegationInputs.push(structuredClone({input,request}));if(options.dismissDelegation)return{status:'dismissed'}
  let receipt=delegated.get(request.idempotencyKey)
  if(!receipt){calls.delegations++;receipt={receiptId:'d'.repeat(64),taskId:input.item.id,engine:'codex'};delegated.set(request.idempotencyKey,receipt)}
  if(options.loseDelegationReply){options.loseDelegationReply=false;throw Object.assign(new Error('Synthetic lost delegation reply'),{code:'OUTCOME_UNKNOWN'})}
  return{status:'delegated',receipt:receipt as {receiptId:string;taskId:string;engine:'codex'}}
 }
 host.conversations.handoff=async(input,request)=>{let receipt=drafts.get(request.idempotencyKey);if(!receipt){calls.handoffs++;receipt={draftId:'synthetic-chat-draft',target:{kind:'new'}};drafts.set(request.idempotencyKey,receipt)}return{status:'handedOff',receipt:receipt as {draftId:string;target:{kind:'new'}}}}
 let records:TaskRecord[]=[];const taskListeners=new Set<()=>void>(),controllers=new Map<string,AbortController>(),finished=new Map<string,Promise<void>>()
 const update=(record:TaskRecord)=>{records=records.some(r=>r.id===record.id)?records.map(r=>r.id===record.id?record:r):[record,...records];taskListeners.forEach(listener=>listener())}
 const execute=(initial:TaskRecord)=>{
  let record=initial;const controller=new AbortController();controllers.set(record.id,controller)
  const work=(async()=>{await Promise.resolve();try{
   const result=await summarize(record.input,{host,signal:controller.signal,async step(key,operation){if(key in record.checkpoints)return structuredClone(record.checkpoints[key]) as never;record={...record,stage:key};update(record);const value=await operation();controller.signal.throwIfAborted();record={...record,checkpoints:{...record.checkpoints,[key]:value}};update(record);return value}})
   controller.signal.throwIfAborted();record={...record,status:'completed',result};update(record)
  }catch(error){if(!controller.signal.aborted){record={...record,status:'failed',error:String(error)};update(record)}}})()
  finished.set(record.id,work)
 }
 host.tasks={getSnapshot:()=>records,subscribe:listener=>{taskListeners.add(listener);return()=>{taskListeners.delete(listener)}},
  start:async(job,input)=>{const record:TaskRecord={id:crypto.randomUUID(),capabilityId,capabilityVersion:'1.0.0',job,input,status:'running',stage:null,attempt:1,checkpoints:{},result:null,error:null,createdAt:'2026-11-27',updatedAt:'2026-11-27'};update(record);execute(record);return record.id},
  cancel:async id=>{const record=records.find(r=>r.id===id)!;controllers.get(id)?.abort();const meeting=await readMeeting(host,(record.input as {draftId:string}).draftId);if(meeting.runId)await host.agents.cancel(meeting.runId);update({...record,status:'cancelled'})},
  retry:async id=>{const record=records.find(r=>r.id===id)!;const next={...record,status:'running' as const,attempt:record.attempt+1,error:null};update(next);execute(next)},
 }
 return{host,setEnvironment,calls,publications,source,runs,emitRun,settled:async(id:string)=>finished.get(id)}
}
