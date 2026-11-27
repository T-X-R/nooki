import {createRoot} from 'react-dom/client'
import {AgentQuestions,agentQuestions,type PendingAgentQuestion} from '../../../src/features/agents/AgentQuestions.tsx'
import '../../../src/app/global.css'
const request:PendingAgentQuestion={runId:'r',capabilityId:'example.meeting-notes',version:'1.0.0',handle:'q',name:'Meeting notes',locales:{zh:{name:'会议纪要'}},answerPending:false,unsupported:false,questions:[{id:'title',title:'选择会议标题',options:['发布纪要','团队纪要'],secret:false}]}
let pending=[request]
const answers:string[][]=[]
agentQuestions.list=async()=>pending
agentQuestions.answer=async(_request,values)=>{answers.push(values);pending=[]}
agentQuestions.cancel=async()=>{pending=[]}
Object.assign(window,{qa:{answers}})
createRoot(document.getElementById('root')!).render(<main><p>Synthetic Host questions · No real model</p><AgentQuestions language="zh"/></main>)
