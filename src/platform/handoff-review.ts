import type {ConversationHandoffInput,ConversationHandoffTarget,ConversationHandoffReceipt,ConversationHandoffResult} from '../../packages/capability-contract/src/index.ts'
export type HandoffTargets={data:{id:string;title:string}[];nextCursor:string|null;partial:boolean}
export type HandoffReviewRequest={
  requestId:string;name:string;capabilityId:string;version:string;draft:ConversationHandoffInput;signal:AbortSignal
  targets(cursor?:string):Promise<HandoffTargets>
  confirm(target:ConversationHandoffTarget):Promise<ConversationHandoffReceipt>
}
export function createHandoffReview(){
  let pending:HandoffReviewRequest|null=null,settle:((result:ConversationHandoffResult|Error)=>void)|undefined
  const listeners=new Set<()=>void>(),changed=()=>listeners.forEach(listener=>listener())
  return{
    getSnapshot:()=>pending,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    open(request:HandoffReviewRequest):Promise<ConversationHandoffResult>{
      if(pending)return Promise.reject(Object.assign(new Error('Another handoff review is open'),{code:'RESOURCE_BUSY'}))
      if(request.signal.aborted)return Promise.reject(Object.assign(new Error('Handoff cancelled'),{code:'CANCELLED'}))
      return new Promise((resolve,reject)=>{
        const abort=()=>settle?.(Object.assign(new Error('Handoff cancelled'),{code:'CANCELLED'}))
        settle=result=>{request.signal.removeEventListener('abort',abort);pending=null;settle=undefined;changed();if(result instanceof Error)reject(result);else resolve(result)}
        request.signal.addEventListener('abort',abort,{once:true});pending=request;changed()
      })
    },
    dismiss(request:HandoffReviewRequest){if(pending===request)settle?.({status:'dismissed'})},
    complete(request:HandoffReviewRequest,result:ConversationHandoffResult){if(pending===request)settle?.(result)},
  }
}
export const handoffReview=createHandoffReview()
