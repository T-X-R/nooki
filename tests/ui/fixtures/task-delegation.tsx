import {createRoot} from 'react-dom/client'
import {TaskDelegationDialog} from '../../../src/features/task-board/TaskDelegationDialog.tsx'
import {delegationReview} from '../../../src/platform/delegation-review.ts'
import {createDelegationClient} from '../../../src/platform/capability-delegation.ts'
import '../../../src/app/global.css'
let commits=0,attempts=0
const client=createDelegationClient({id:'example.notes',name:'会议纪要',version:'1.3.0',permission:true,desktop:true,assertActive(){},onDispose(){},open:delegationReview.open,
 async invoke(command,args){const request=args.request as Record<string,unknown>
  if(command==='capability_delegation_begin')return{status:'pending',handle:'a'.repeat(64),requestId:request.requestId,capabilityId:'example.notes',version:'1.3.0'}
  if(command==='capability_delegation_inspect')return{title:'项目例会跟进',description:'整理跟进计划并保存 Markdown。',documents:[{reference:{title:'已批准的纪要'},content:'周五交付原型。'}],deliveries:[]}
  if(command==='capability_delegation_commit'){if(++attempts===1){commits++;throw new Error('Synthetic lost reply')}return{receiptId:'d'.repeat(64),taskId:'task',engine:'codex'}}
 }})
Object.assign(window,{qa:{get commits(){return commits},get attempts(){return attempts}}})
createRoot(document.getElementById('root')!).render(<main><p>Synthetic delegation — no model or task worker</p><button onClick={()=>void client.board.requestDelegation({item:{id:'task',revision:1}},{idempotencyKey:'one'})}>请求交接</button><TaskDelegationDialog language="zh"/></main>)
