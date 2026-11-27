import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AgentReviewDialog} from '../../../src/features/agents/AgentReviewDialog.tsx'
import {createAgentClient} from '../../../src/platform/capability-agents.ts'
import {agentReview} from '../../../src/platform/agent-review.ts'
import {captureLibraryFocus} from '../../../src/platform/library-focus.ts'
import '../../../src/app/global.css'
function Fixture(){
 const [result,setResult]=useState(''),[busy,setBusy]=useState(false)
 const [client]=useState(()=>createAgentClient({id:'example.meeting',version:'1.0.0',name:'Meeting notes',permission:true,desktop:true,assertActive(){},onDispose(){},open:agentReview.open,captureFocus:captureLibraryFocus,
  async invoke(command,args){window.qa.calls.push(command)
   if(command==='capability_agent_begin')return{status:'pending',handle:'a'.repeat(64),requestId:args.request.requestId,capabilityId:'example.meeting',version:'1.0.0'}
   if(command==='capability_agent_approve')return{id:'b'.repeat(64)}
   if(command==='capability_agent_start'){if(window.qa.loseReply){window.qa.loseReply=false;throw new Error('lost')}return{id:'b'.repeat(64),agentId:'codex',status:'completed',restored:false,cancellationRequested:false,result:{text:'Meeting notes ready'}}}
  }}))
 const start=async()=>{setBusy(true);setResult('');try{setResult(JSON.stringify(await client.agents.start({agentId:'codex',instructions:'Summarize the selected meeting transcript.',sources:[{kind:'library-document',documentId:'synthetic/notes',title:'Synthetic transcript',grantId:'test-grant',revision:'revision-one'}]},{idempotencyKey:'same-request'})))}catch(cause){setResult(String(cause))}finally{setBusy(false)}}
 return <main><button disabled={busy} onClick={()=>void start()}>Generate notes</button><output>{result}</output><AgentReviewDialog language="zh"/></main>
}
window.qa={calls:[],loseReply:false}
createRoot(document.getElementById('root')!).render(<Fixture/>);
