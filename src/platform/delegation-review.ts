import type {BoardDelegationReceipt,BoardDelegationResult} from '../../packages/capability-contract/src/index.ts'
export type DelegationDetails={title:string;description:string;documents:{reference:{title:string};content:string}[];deliveries:{id:string;title:string;documents:{content:string}[]}[]}
export type DelegationReviewRequest={requestId:string;name:string;capabilityId:string;version:string;details:DelegationDetails;signal:AbortSignal;confirm():Promise<BoardDelegationReceipt>}
export function createDelegationReview(){
  let pending:DelegationReviewRequest|null=null,settle:((result:BoardDelegationResult|Error)=>void)|undefined
  const listeners=new Set<()=>void>(),changed=()=>listeners.forEach(listener=>listener())
  return{
    getSnapshot:()=>pending,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    open(request:DelegationReviewRequest):Promise<BoardDelegationResult>{
      if(pending)return Promise.reject(Object.assign(new Error('Another delegation review is open'),{code:'RESOURCE_BUSY'}))
      if(request.signal.aborted)return Promise.reject(Object.assign(new Error('Delegation cancelled'),{code:'CANCELLED'}))
      return new Promise((resolve,reject)=>{
        const abort=()=>settle?.(Object.assign(new Error('Delegation cancelled'),{code:'CANCELLED'}))
        settle=result=>{request.signal.removeEventListener('abort',abort);pending=null;settle=undefined;changed();if(result instanceof Error)reject(result);else resolve(result)}
        request.signal.addEventListener('abort',abort,{once:true});pending=request;changed()
      })
    },
    dismiss(request:DelegationReviewRequest){if(pending===request)settle?.({status:'dismissed'})},
    complete(request:DelegationReviewRequest,result:BoardDelegationResult){if(pending===request)settle?.(result)},
  }
}
export const delegationReview=createDelegationReview()
