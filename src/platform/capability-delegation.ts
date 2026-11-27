import type {BoardDelegationInput,BoardDelegationReceipt,BoardDelegationResult,CapabilityHost,HostErrorCode,IdempotencyOptions} from '../../packages/capability-contract/src/index.ts'
import type {DelegationDetails,DelegationReviewRequest} from './delegation-review.ts'
const error=(code:HostErrorCode,message:string)=>Object.assign(new Error(message),{code})
const codes:HostErrorCode[]=['INVALID_INPUT','PERMISSION_DENIED','CONFLICT','RESOURCE_LIMIT','RESOURCE_BUSY','RESOURCE_UNAVAILABLE','OUTCOME_UNKNOWN','CANCELLED','UNSUPPORTED_SERVICE']
function normalize(cause:unknown,fallback:HostErrorCode){
  if(cause&&typeof cause==='object'&&'code' in cause&&codes.includes(cause.code as HostErrorCode))return error(cause.code as HostErrorCode,'message' in cause&&typeof cause.message==='string'?cause.message:'Delegation failed')
  return error(fallback,fallback==='OUTCOME_UNKNOWN'?'Outcome unknown; retry the same task and key':'Task delegation unavailable')
}
const fields=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))
function proposal(input:BoardDelegationInput,options:IdempotencyOptions){
  if(!fields(input,['item','grantId','sourceRunId'])||!fields(input.item,['id','revision'])||!fields(options,['idempotencyKey'])
    ||typeof input.item.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(input.item.id)||!Number.isSafeInteger(input.item.revision)||Number(input.item.revision)<1
    ||[input.grantId,input.sourceRunId].some(v=>v!==undefined&&(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))
    ||typeof options.idempotencyKey!=='string'||!options.idempotencyKey||new TextEncoder().encode(options.idempotencyKey).length>128||/\p{Cc}/u.test(options.idempotencyKey))throw error('INVALID_INPUT','Invalid delegation task or key')
  return JSON.parse(JSON.stringify({input,key:options.idempotencyKey})) as {input:BoardDelegationInput;key:string}
}
function receipt(value:unknown):BoardDelegationReceipt {
  if(!fields(value,['receiptId','taskId','engine'])||typeof value.receiptId!=='string'||!/^[a-f0-9]{64}$/.test(value.receiptId)||typeof value.taskId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(value.taskId)||value.engine!=='codex')throw error('OUTCOME_UNKNOWN','Invalid delegation receipt; retry unchanged')
  return Object.freeze({receiptId:value.receiptId,taskId:value.taskId,engine:'codex'})
}
type Lifetime={id:string;dispose():Promise<void>}
const clients=new Set<Lifetime>()
export async function invalidateDelegations(id:string){await Promise.all([...clients].filter(c=>c.id===id).map(c=>c.dispose()))}
export function createDelegationClient(config:{id:string;version:string;name:string;permission:boolean;desktop:boolean;assertActive():void;onDispose():void;captureFocus?():()=>void;invoke(command:string,args:Record<string,unknown>):Promise<unknown>;open(request:DelegationReviewRequest):Promise<BoardDelegationResult>}){
  let closed=false,running=false,controller:AbortController|undefined
  const requests=new Set<string>()
  const active=()=>{if(closed)throw error('CANCELLED','This Host invocation has ended');try{config.assertActive()}catch{throw error('PERMISSION_DENIED','Capability is no longer active')}}
  const release=async(requestId:string)=>{try{await config.invoke('capability_delegation_cancel',{request:{requestId}});requests.delete(requestId)}catch{console.warn('Delegation review cleanup pending')}}
  const client={id:config.id,board:Object.freeze({
    async requestDelegation(input:BoardDelegationInput,options:IdempotencyOptions):Promise<BoardDelegationResult>{
      active();if(!config.desktop)throw error('UNSUPPORTED_SERVICE','Delegation requires desktop Nooki');if(!config.permission)throw error('PERMISSION_DENIED','Capability requires board.request-delegation')
      const frozen=proposal(input,options);if(running)throw error('RESOURCE_BUSY','A delegation review is already open')
      running=true;controller=new AbortController();const restore=config.captureFocus?.();let requestId:string|undefined
      try{
        await Promise.all([...requests].map(release));active();requestId=crypto.randomUUID();requests.add(requestId)
        const begun=await config.invoke('capability_delegation_begin',{request:{requestId,capabilityId:config.id,version:config.version,...frozen}}) as {status:string;receipt:unknown;handle:string;requestId:string;capabilityId:string;version:string}
        active()
        const checked=(value:unknown)=>{const saved=receipt(value);if(saved.taskId!==frozen.input.item.id)throw error('OUTCOME_UNKNOWN','Delegation receipt differs; retry unchanged');return saved}
        if(begun?.status==='committed')return{status:'delegated',receipt:checked(begun.receipt)}
        if(begun?.status!=='pending'||typeof begun.handle!=='string'||!/^[a-f0-9]{64}$/.test(begun.handle)||begun.requestId!==requestId||begun.capabilityId!==config.id||begun.version!==config.version)throw error('RESOURCE_UNAVAILABLE','Invalid delegation review')
        const handle=begun.handle
        const details=await config.invoke('capability_delegation_inspect',{request:{handle}}) as DelegationDetails;active()
        let committing=false
        return await config.open({requestId,name:config.name,capabilityId:config.id,version:config.version,details,signal:controller.signal,confirm:async()=>{
          active();if(committing)throw error('RESOURCE_BUSY','Delegation confirmation is pending');committing=true
          try{const saved=checked(await config.invoke('capability_delegation_commit',{request:{handle}}));active();return saved}
          catch(cause){throw normalize(cause,'OUTCOME_UNKNOWN')}finally{committing=false}
        }})
      }catch(cause){throw normalize(cause,'RESOURCE_UNAVAILABLE')}
      finally{if(requestId)await release(requestId);running=false;controller=undefined;if(closed&&!requests.size)clients.delete(client);restore?.()}
    },
  }) satisfies Pick<CapabilityHost['board'],'requestDelegation'>,
  async dispose(){closed=true;config.onDispose();controller?.abort();await Promise.all([...requests].map(release));if(!running&&!requests.size)clients.delete(client)}}
  clients.add(client);return client
}
