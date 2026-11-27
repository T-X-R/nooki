import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {LibraryDialog} from '../library/LibraryDialogs.tsx'
import './agent-review.css'
type Question={id:string;title:string;options:string[];secret:boolean}
export type PendingAgentQuestion={runId:string;capabilityId:string;version:string;handle:string;name:string;locales:Record<string,{name:string}>;answerPending:boolean;questions:Question[]|null;unsupported:boolean}
export const agentQuestions={
 list:()=>window.__TAURI_INTERNALS__?invoke<PendingAgentQuestion[]>('capability_agent_questions'):Promise.resolve([]),
 answer:(request:PendingAgentQuestion,answers:string[])=>invoke('capability_agent_answer',{request:{runId:request.runId,capabilityId:request.capabilityId,version:request.version,handle:request.handle,answers}}),
 cancel:(request:PendingAgentQuestion)=>invoke('capability_agent_cancel',{request:{runId:request.runId,capabilityId:request.capabilityId,version:request.version}}),
}
function QuestionDialog({request,zh,onClose,onChanged}:{request:PendingAgentQuestion;zh:boolean;onClose():void;onChanged():void}){
 const [answers,setAnswers]=useState<string[]>(()=>request.questions?.map(()=>'')??[]),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const locked=useRef(false)
 const act=async(cancel=false)=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');try{
  if(cancel)await agentQuestions.cancel(request);else await agentQuestions.answer(request,answers)
  onChanged();onClose()
 }catch(cause){setError(cause&&typeof cause==='object'&&'message' in cause?String(cause.message):String(cause));onChanged()}finally{locked.current=false;setBusy(false)}}
 return <LibraryDialog title={zh?'Codex 需要你的回答':'Codex needs your input'} busy={busy} onClose={onClose}>
  <p className="modal-copy">{request.locales[zh?'zh':'en']?.name||request.name}</p>
  {request.answerPending&&<p role="status">{zh?'回答已尝试发送，正在等待 Codex 确认。':'The answer was submitted; waiting for Codex confirmation.'}</p>}
  {request.unsupported?<p role="alert">{zh?'此请求超出了本次已批准的执行范围。请停止运行后重新发起合适的任务。':'This request is outside the approved execution scope. Stop the run and start an appropriate task.'}</p>:<form id="agent-question-form" onSubmit={e=>{e.preventDefault();void act()}}>
   {request.questions?.map((q,index)=><fieldset className="agent-question" key={q.id} disabled={busy||request.answerPending}><legend>{q.title}</legend>
    {q.options.map(option=><label key={option}><input type="radio" name={q.id} checked={answers[index]===option} onChange={()=>setAnswers(values=>values.map((v,i)=>i===index?option:v))}/>{option}</label>)}
    <label>{zh?'你的回答':'Your answer'}<input type={q.secret?'password':'text'} autoComplete="off" maxLength={2500} value={answers[index]} onChange={e=>setAnswers(values=>values.map((v,i)=>i===index?e.target.value:v))}/></label>
   </fieldset>)}
  </form>}
  {error&&<p role="alert" className="library-error">{error}</p>}
  <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={()=>void act(true)}>{zh?'停止运行':'Stop run'}</button><button className="secondary-button" disabled={busy} onClick={onClose}>{zh?'稍后回答':'Answer later'}</button>
   {!request.unsupported&&<button className="primary-button" form="agent-question-form" type="submit" disabled={busy||request.answerPending||answers.some(a=>!a.trim())}>{busy?(zh?'发送中…':'Sending…'):(zh?'发送回答':'Send answer')}</button>}
  </footer>
 </LibraryDialog>
}
export function AgentQuestions({language}:{language:'zh'|'en'}){
 const [pending,setPending]=useState<PendingAgentQuestion[]>([]),[opened,setOpened]=useState(''),[epoch,setEpoch]=useState(0)
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>;const load=async()=>{
  try{const result=await agentQuestions.list();if(!stopped)setPending(result)}catch{if(!stopped)setPending([])}
  if(!stopped)timer=setTimeout(()=>void load(),1000)
 };void load();return()=>{stopped=true;clearTimeout(timer)}},[epoch])
 const request=pending.find(p=>p.handle===opened),zh=language==='zh'
 return <>{pending.length>0&&<button className="agent-question-notice" onClick={()=>setOpened(pending[0].handle)}>{zh?`Codex 有 ${pending.length} 项需要你处理`:`Codex needs your input (${pending.length})`}</button>}
  {request&&<QuestionDialog key={request.handle} request={request} zh={zh} onClose={()=>setOpened('')} onChanged={()=>setEpoch(value=>value+1)}/>}
 </>
}
