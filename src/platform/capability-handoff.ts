import type {CapabilityHost,ConversationHandoffInput,ConversationHandoffReceipt,ConversationHandoffResult,ConversationHandoffTarget,HostErrorCode,IdempotencyOptions} from '../../packages/capability-contract/src/index.ts'
import type {HandoffReviewRequest,HandoffTargets} from './handoff-review.ts'
const error=(code:HostErrorCode,message:string)=>Object.assign(new Error(message),{code})
const codes:HostErrorCode[]=['INVALID_INPUT','PERMISSION_DENIED','UNSUPPORTED_SERVICE','CONFLICT','RESOURCE_LIMIT','RESOURCE_BUSY','RESOURCE_UNAVAILABLE','OUTCOME_UNKNOWN','CANCELLED']
function normalize(cause:unknown,fallback:HostErrorCode){
  if(cause&&typeof cause==='object'&&'code' in cause&&codes.includes(cause.code as HostErrorCode))return error(cause.code as HostErrorCode,'message' in cause&&typeof cause.message==='string'?cause.message:'Handoff failed')
  return error(fallback,fallback==='OUTCOME_UNKNOWN'?'Outcome unknown; retry the same key and draft':'Conversation handoff unavailable')
}
const fields=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))
const bytes=(s:string)=>new TextEncoder().encode(s).length
function snapshot(input:ConversationHandoffInput,options:IdempotencyOptions){
  try{
    if(!fields(input,['title','text','sources'])||!fields(options,['idempotencyKey']))throw 0
    const encoded=JSON.stringify({draft:input,key:options.idempotencyKey});if(bytes(encoded)>63*1024)throw 0
    const copy=JSON.parse(encoded),d=copy.draft
    if(typeof copy.key!=='string'||!copy.key||bytes(copy.key)>128||/\p{Cc}/u.test(copy.key)||typeof d.title!=='string'||!d.title.trim()||[...d.title].length>120||typeof d.text!=='string'||!d.text.trim()||[...d.text].length>20000||d.text.includes('\0'))throw 0
    const sources=d.sources===undefined?[]:d.sources
    if(!Array.isArray(sources)||sources.length>50||new Set(sources.map(r=>r?.documentId)).size!==sources.length||sources.some(r=>!fields(r,['kind','documentId','title','grantId','revision'])||r.kind!=='library-document'||typeof r.documentId!=='string'||!r.documentId||typeof r.title!=='string'||!r.title.trim()||[...r.title].length>120||typeof r.grantId!=='string'||!/^[a-z0-9-]{1,100}$/.test(r.grantId)||typeof r.revision!=='string'||!r.revision||bytes(r.revision)>256||/\p{Cc}/u.test(r.revision)))throw 0
    return {key:copy.key as string,draft:Object.freeze({...d,sources:Object.freeze(sources.map(r=>Object.freeze(r)))}) as ConversationHandoffInput}
  }catch{throw error('INVALID_INPUT','Invalid handoff draft, selected references or idempotency key')}
}
function target(value:unknown):ConversationHandoffTarget{
  if(fields(value,['kind'])&&value.kind==='new')return{kind:'new'}
  if(fields(value,['kind','id'])&&value.kind==='conversation'&&typeof value.id==='string'&&value.id&&bytes(value.id)<=256&&!/\p{Cc}/u.test(value.id))return{kind:'conversation',id:value.id}
  throw error('INVALID_INPUT','Invalid conversation target')
}
function receipt(value:unknown):ConversationHandoffReceipt{
  if(!fields(value,['draftId','target'])||typeof value.draftId!=='string'||!/^[a-f0-9]{64}$/.test(value.draftId))throw error('OUTCOME_UNKNOWN','Invalid native handoff receipt; retry unchanged')
  try{return{draftId:value.draftId,target:target(value.target)}}catch{throw error('OUTCOME_UNKNOWN','Invalid native handoff target; retry unchanged')}
}
type Lifetime={id:string;closed:boolean;dispose():Promise<void>}
const clients=new Set<Lifetime>()
export async function invalidateHandoffs(id:string){await Promise.all([...clients].filter(c=>c.id===id).map(c=>c.dispose()))}
export function createHandoffClient(config:{
  id:string;version:string;name:string;permission:boolean;desktop:boolean;assertActive():void;onDispose():void
  invoke(command:string,args:Record<string,unknown>):Promise<unknown>;open(request:HandoffReviewRequest):Promise<ConversationHandoffResult>
  onCommitted(id:string):void;captureFocus?():()=>void
}){
  let closed=false,running=false,controller:AbortController|undefined
  const requests=new Set<string>()
  const active=()=>{if(closed)throw error('CANCELLED','This Host invocation has ended');try{config.assertActive()}catch{throw error('PERMISSION_DENIED','Capability is no longer active at this version')}}
  const release=async(requestId:string)=>{try{await config.invoke('conversation_handoff_cancel',{request:{requestId}});requests.delete(requestId)}catch{console.warn('Handoff cleanup pending; will retry before the next review')}}
  const client={id:config.id,get closed(){return closed},conversations:Object.freeze({
    async handoff(input:ConversationHandoffInput,options:IdempotencyOptions):Promise<ConversationHandoffResult>{
      active();if(!config.desktop)throw error('UNSUPPORTED_SERVICE','Handoff requires desktop Nooki');if(!config.permission)throw error('PERMISSION_DENIED','Capability requires conversations.handoff')
      const proposal=snapshot(input,options);if(running)throw error('RESOURCE_BUSY','This Host already has an open handoff')
      const restore=config.captureFocus?.();running=true;controller=new AbortController()
      let requestId:string|undefined,result:ConversationHandoffResult,navigate=false
      try{
        await Promise.all([...requests].map(release));await Promise.all([...clients].filter(c=>c.id===config.id&&c.closed).map(c=>c.dispose()));active()
        requestId=crypto.randomUUID();requests.add(requestId)
        const begun=await config.invoke('conversation_handoff_begin',{request:{requestId,capabilityId:config.id,version:config.version,...proposal}}) as {status:string;handle:string;requestId:string;capabilityId:string;version:string;receipt:unknown}
        active()
        if(begun?.status==='committed')result={status:'handedOff',receipt:receipt(begun.receipt)}
        else{
          if(begun?.status!=='pending'||!/^[a-f0-9]{64}$/.test(begun.handle)||begun.requestId!==requestId||begun.capabilityId!==config.id||begun.version!==config.version)throw error('RESOURCE_UNAVAILABLE','Invalid native handoff context')
          const handle=begun.handle;let approved:string|undefined,committing=false
          result=await config.open({requestId,name:config.name,capabilityId:config.id,version:config.version,draft:proposal.draft,signal:controller.signal,
            targets:async(cursor)=>{active();try{const page=await config.invoke('conversation_handoff_targets',{request:{handle,...(cursor===undefined?{}:{cursor})}}) as HandoffTargets;active();return page}catch(cause){throw normalize(cause,'RESOURCE_UNAVAILABLE')}},
            confirm:async(value)=>{
              active();if(committing)throw error('RESOURCE_BUSY','Handoff commitment is pending')
              const frozen=JSON.stringify(target(value));if(approved!==undefined&&approved!==frozen)throw error('CONFLICT','Approved target changed; cancel and review again');approved=frozen;committing=true
              try{const saved=receipt(await config.invoke('conversation_handoff_commit',{request:{handle,target:JSON.parse(approved)}}));active();if(JSON.stringify(saved.target)!==approved)throw error('OUTCOME_UNKNOWN','Handoff receipt target differs; retry unchanged');return saved}
              catch(cause){throw normalize(cause,'OUTCOME_UNKNOWN')}finally{committing=false}
            }})
          navigate=result.status==='handedOff'
        }
      }catch(cause){throw normalize(cause,'RESOURCE_UNAVAILABLE')}
      finally{if(requestId)await release(requestId);running=false;controller=undefined;if(closed&&!requests.size)clients.delete(client);restore?.()}
      active();if(navigate&&result.status==='handedOff')config.onCommitted(result.receipt.draftId);return result
    },
  }) satisfies CapabilityHost['conversations'],async dispose(){closed=true;config.onDispose();controller?.abort();await Promise.all([...requests].map(release));if(!running&&!requests.size)clients.delete(client)}}
  clients.add(client);return client
}
