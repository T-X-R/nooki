import type {AgentRunSnapshot,AgentStartInput,AgentStartResult,AvailableAgent,CapabilityHost,HostErrorCode,HostServiceError,IdempotencyOptions} from '../../packages/capability-contract/src/index.ts'
import type {AgentReviewRequest} from './agent-review.ts'
const error=(code:HostErrorCode,message:string):HostServiceError=>Object.assign(new Error(message),{code})
const codes:HostErrorCode[]=['INVALID_INPUT','PERMISSION_DENIED','UNSUPPORTED_SERVICE','CONFLICT','RESOURCE_LIMIT','RESOURCE_BUSY','RESOURCE_UNAVAILABLE','OUTCOME_UNKNOWN','CANCELLED']
const fields=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))
const bytes=(s:string)=>new TextEncoder().encode(s).length
const runId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)
const terminal=(run:AgentRunSnapshot)=>run.restored||['completed','failed','cancelled'].includes(run.status)
function normalize(cause:unknown,fallback:HostErrorCode):HostServiceError{
  if(cause&&typeof cause==='object'&&'code' in cause&&codes.includes(cause.code as HostErrorCode))return error(cause.code as HostErrorCode,'message' in cause&&typeof cause.message==='string'?cause.message:'Agent request failed')
  return error(fallback,fallback==='OUTCOME_UNKNOWN'?'Outcome unknown; observe this run or retry the same key and input':'Agent service unavailable')
}
function snapshot(value:unknown):AgentRunSnapshot{
  if(!fields(value,['id','agentId','status','restored','result'])||!runId(value.id)||value.agentId!=='codex'||typeof value.restored!=='boolean'||!['approved','running','unknown','completed','failed','cancelled'].includes(value.status as string))throw error('RESOURCE_UNAVAILABLE','Invalid Agent snapshot')
  if(value.status==='completed'){
    if(!fields(value.result,['text'])||typeof value.result.text!=='string'||!value.result.text.trim()||bytes(value.result.text)>1_000_000)throw error('RESOURCE_UNAVAILABLE','Invalid Agent result')
  }else if(value.result!==null)throw error('RESOURCE_UNAVAILABLE','Invalid Agent result')
  return Object.freeze({id:value.id,agentId:'codex',status:value.status as AgentRunSnapshot['status'],restored:value.restored,result:value.result===null?null:Object.freeze({text:(value.result as {text:string}).text})})
}
function proposal(input:AgentStartInput,options:IdempotencyOptions){
  try{
    if(!fields(input,['agentId','instructions','sources','outputSchema'])||!fields(options,['idempotencyKey']))throw 0
    const encoded=JSON.stringify({proposal:input,key:options.idempotencyKey});if(bytes(encoded)>63*1024)throw 0
    const copy=JSON.parse(encoded),p=copy.proposal,sources=p.sources??[]
    if(typeof copy.key!=='string'||!copy.key.trim()||bytes(copy.key)>128||/\p{Cc}/u.test(copy.key)||p.agentId!=='codex'||typeof p.instructions!=='string'||!p.instructions.trim()||[...p.instructions].length>20_000||p.instructions.includes('\0'))throw 0
    if(p.sources===null||!Array.isArray(sources)||sources.length>50||new Set(sources.map(r=>r?.documentId)).size!==sources.length||sources.some(r=>!fields(r,['kind','documentId','title','grantId','revision'])||r.kind!=='library-document'||typeof r.documentId!=='string'||!r.documentId||typeof r.title!=='string'||!r.title.trim()||[...r.title].length>120||/\p{Cc}/u.test(r.title)||typeof r.grantId!=='string'||!/^[a-z0-9-]{1,100}$/.test(r.grantId)||typeof r.revision!=='string'||!r.revision||bytes(r.revision)>256||/\p{Cc}/u.test(r.revision)))throw 0
    if(p.outputSchema!==undefined&&(!p.outputSchema||Array.isArray(p.outputSchema)||typeof p.outputSchema!=='object'||bytes(JSON.stringify(p.outputSchema))>16384))throw 0
    return{key:copy.key as string,proposal:{agentId:'codex' as const,instructions:p.instructions as string,sources,outputSchema:p.outputSchema??null}}
  }catch{throw error('INVALID_INPUT','Invalid Agent instructions, selected sources, schema or idempotency key')}
}
type Lifetime={id:string;closed:boolean;dispose():Promise<void>}
const clients=new Set<Lifetime>()
export async function invalidateAgentClients(id:string){await Promise.all([...clients].filter(c=>c.id===id).map(c=>c.dispose()))}
export function createAgentClient(config:{
  id:string;version:string;name:string;permission:boolean;desktop:boolean;assertActive():void;onDispose():void
  invoke(command:string,args:Record<string,unknown>):Promise<unknown>;open(request:AgentReviewRequest):Promise<AgentStartResult>
  captureFocus?():()=>void
}){
  let closed=false,reviewing=false,controller:AbortController|undefined
  const requests=new Set<string>(),subscriptions=new Set<()=>void>()
  const active=()=>{if(closed)throw error('CANCELLED','This Host invocation has ended');try{config.assertActive()}catch{throw error('PERMISSION_DENIED','Capability is no longer active at this version')}
    if(!config.permission)throw error('PERMISSION_DENIED','Capability requires agents.run');if(!config.desktop)throw error('UNSUPPORTED_SERVICE','Agent execution requires desktop Nooki')}
  const context={capabilityId:config.id,version:config.version}
  const release=async(requestId:string)=>{try{await config.invoke('capability_agent_dismiss',{request:{requestId}});requests.delete(requestId)}catch{console.warn('Agent review cleanup pending; will retry before the next review')}}
  const operation=async(op:string,id:string)=>{
    active();if(!runId(id))throw error('INVALID_INPUT','Invalid Agent run reference')
    try{const result=snapshot(await config.invoke(`capability_agent_${op}`,{request:{...context,runId:id}}));active();if(result.id!==id)throw error('RESOURCE_UNAVAILABLE','Agent run reference changed');return result}
    catch(cause){throw normalize(cause,op==='get'?'RESOURCE_UNAVAILABLE':'OUTCOME_UNKNOWN')}
  }
  const agents:CapabilityHost['agents']=Object.freeze({
    async listAvailable():Promise<readonly AvailableAgent[]>{
      active();try{const result=await config.invoke('capability_agent_available',{request:context});active()
        if(!Array.isArray(result)||result.length>1||result.some(item=>!fields(item,['id','name'])||item.id!=='codex'||item.name!=='Codex'))throw error('RESOURCE_UNAVAILABLE','Invalid available Agent list')
        return Object.freeze(result.map(()=>Object.freeze({id:'codex' as const,name:'Codex'})))
      }catch(cause){throw normalize(cause,'RESOURCE_UNAVAILABLE')}
    },
    async start(input:AgentStartInput,options:IdempotencyOptions):Promise<AgentStartResult>{
      active();const frozen=proposal(input,options);if(reviewing)throw error('RESOURCE_BUSY','This Host already has an Agent review')
      const restore=config.captureFocus?.();reviewing=true;controller=new AbortController();let requestId:string|undefined
      try{
        await Promise.all([...requests].map(release));active();requestId=crypto.randomUUID();requests.add(requestId)
        const begun=await config.invoke('capability_agent_begin',{request:{...context,requestId,...frozen}})
        active()
        if(fields(begun,['status','run'])&&begun.status==='existing'){
          const run=snapshot(begun.run)
          return{status:'started',run:run.status==='approved'&&!run.restored?await operation('start',run.id):run}
        }
        if(!fields(begun,['status','handle','requestId','capabilityId','version'])||begun.status!=='pending'||!runId(begun.handle)||begun.requestId!==requestId||begun.capabilityId!==config.id||begun.version!==config.version)throw error('RESOURCE_UNAVAILABLE','Invalid Agent review context')
        let approvedId:string|undefined,confirming=false
        // Render a separate copy: package mutation and Host presentation never alter native intent.
        const display=JSON.parse(JSON.stringify(frozen.proposal));if(display.outputSchema===null)delete display.outputSchema
        return await config.open({requestId,name:config.name,capabilityId:config.id,version:config.version,proposal:display,signal:controller.signal,
          confirm:async()=>{
            active();if(confirming)throw error('RESOURCE_BUSY','Agent confirmation is pending');confirming=true
            try{
              if(!approvedId){const approved=await config.invoke('capability_agent_approve',{request:{handle:begun.handle}});active()
                if(!fields(approved,['id'])||!runId(approved.id))throw error('OUTCOME_UNKNOWN','Agent approval outcome unknown; retry unchanged');approvedId=approved.id}
              return await operation('start',approvedId)
            }catch(cause){throw normalize(cause,'OUTCOME_UNKNOWN')}finally{confirming=false}
          }})
      }catch(cause){throw normalize(cause,'RESOURCE_UNAVAILABLE')}
      finally{if(requestId)await release(requestId);reviewing=false;controller=undefined;if(closed&&!requests.size)clients.delete(client);restore?.()}
    },
    get:(id:string)=>operation('get',id),cancel:(id:string)=>operation('cancel',id),
    subscribe(id:string,listener:(run:AgentRunSnapshot)=>void,onError:(error:HostServiceError)=>void){
      active();if(!runId(id)||typeof listener!=='function'||typeof onError!=='function')throw error('INVALID_INPUT','Invalid Agent subscription')
      let stopped=false,timer:ReturnType<typeof setTimeout>|undefined
      const stop=()=>{stopped=true;clearTimeout(timer);subscriptions.delete(stop)};subscriptions.add(stop)
      const read=async()=>{
        let result:AgentRunSnapshot
        try{result=await operation('get',id)}catch(cause){if(stopped)return
          const failure=normalize(cause,'RESOURCE_UNAVAILABLE');if(['PERMISSION_DENIED','CANCELLED','UNSUPPORTED_SERVICE'].includes(failure.code))stop()
          else timer=setTimeout(()=>void read(),1000)
          onError(failure);return
        }
        if(stopped)return
        if(terminal(result))stop();else timer=setTimeout(()=>void read(),1000)
        listener(result)
      }
      void read();return stop
    },
  })
  const client={id:config.id,get closed(){return closed},agents,async dispose(){closed=true;config.onDispose();controller?.abort();[...subscriptions].forEach(stop=>stop());await Promise.all([...requests].map(release));if(!reviewing&&!requests.size)clients.delete(client)}}
  clients.add(client);return client
}
