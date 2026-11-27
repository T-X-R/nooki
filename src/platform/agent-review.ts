import type {AgentStartInput,AgentStartResult,AgentRunSnapshot} from '../../packages/capability-contract/src/index.ts'
export type AgentReviewRequest={
  requestId:string;name:string;capabilityId:string;version:string;proposal:AgentStartInput;signal:AbortSignal
  confirm():Promise<AgentRunSnapshot>
}
export function createAgentReview(){
  let pending:AgentReviewRequest|null=null,settle:((result:AgentStartResult|Error)=>void)|undefined
  const listeners=new Set<()=>void>(),changed=()=>listeners.forEach(listener=>listener())
  return{
    getSnapshot:()=>pending,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    open(request:AgentReviewRequest):Promise<AgentStartResult>{
      if(pending)return Promise.reject(Object.assign(new Error('Another Agent review is open'),{code:'RESOURCE_BUSY'}))
      if(request.signal.aborted)return Promise.reject(Object.assign(new Error('Agent review cancelled'),{code:'CANCELLED'}))
      return new Promise((resolve,reject)=>{
        const abort=()=>settle?.(Object.assign(new Error('Agent review cancelled'),{code:'CANCELLED'}))
        settle=result=>{request.signal.removeEventListener('abort',abort);pending=null;settle=undefined;changed();if(result instanceof Error)reject(result);else resolve(result)}
        request.signal.addEventListener('abort',abort,{once:true});pending=request;changed()
      })
    },
    dismiss(request:AgentReviewRequest){if(pending===request)settle?.({status:'dismissed'})},
    complete(request:AgentReviewRequest,run:AgentRunSnapshot){if(pending===request)settle?.({status:'started',run})},
  }
}
export const agentReview=createAgentReview()
