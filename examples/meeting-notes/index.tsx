import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import type {CapabilityManifest,CapabilityModule,CapabilityPageProps,DocumentReference,AgentRunSnapshot} from './contract'
import {CapabilityPage,PageHeader,Panel,Button,StateMessage} from './ui'
import {attachMeeting,createMeeting,createTodo,handoffMeeting,listMeetings,publishMeeting,refreshMeeting,summarize,type Meeting} from './meeting'
import manifestJson from './manifest.json'
import './style.css'
const manifest=manifestJson as CapabilityManifest
function Page({host}:CapabilityPageProps){
 const environment=useSyncExternalStore(host.environment.subscribe,host.environment.getSnapshot),zh=environment.language==='zh'
 const tasks=useSyncExternalStore(host.tasks.subscribe,host.tasks.getSnapshot)
 const [meetings,setMeetings]=useState<Meeting[]>([]),[selected,setSelected]=useState(''),[title,setTitle]=useState(''),[sources,setSources]=useState<DocumentReference[]>([])
 const [ready,setReady]=useState(false),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [progress,setProgress]=useState<AgentRunSnapshot['progress']>()
 const locked=useRef(false),mounted=useRef(true),loadEpoch=useRef(0)
 const load=async()=>{const epoch=++loadEpoch.current;const values=await listMeetings(host);if(mounted.current&&epoch===loadEpoch.current){setMeetings(values);setSelected(current=>current||values[0]?.id||'')}}
 useEffect(()=>{mounted.current=true;void Promise.all([load(),host.agents.listAvailable().then(agents=>{if(mounted.current)setAvailable(agents.some(a=>a.id==='codex'))})]).catch(e=>{if(mounted.current)setError(String(e))}).finally(()=>{if(mounted.current)setReady(true)});return()=>{mounted.current=false}},[host])
 useEffect(()=>{void load().catch(e=>{if(mounted.current)setError(String(e))})},[tasks,host])
 const meeting=meetings.find(item=>item.id===selected),job=tasks.find(item=>(item.input as {draftId?:string})?.draftId===selected)
 useEffect(()=>{setProgress(undefined);if(!meeting?.runId)return;return host.agents.subscribe(meeting.runId,run=>setProgress(run.progress),()=>setProgress(undefined))},[host,meeting?.runId])
 const running=tasks.some(item=>item.status==='running')
 const unresolved=meetings.some(item=>['requesting','running','unknown'].includes(item.phase))
 const perform=async(action:()=>Promise<unknown>)=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await action()}catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e))}finally{await load().catch(e=>{if(mounted.current)setError(String(e))});locked.current=false;if(mounted.current)setBusy(false)}}
 const choose=()=>perform(async()=>{const selection=await host.library.requestSelection({purpose:zh?'选择用于整理会议纪要的原始记录':'Select the transcript or notes to summarize',kinds:['document'],limit:10});if(selection.status==='selected')setSources(selection.grant.documents.map(document=>document.reference))})
 const generate=()=>perform(async()=>{const draft=await createMeeting(host,title,sources,environment.language);setSelected(draft.id);await host.tasks.start('summarize',{draftId:draft.id})})
 const labels=zh?{ready:'待生成',requesting:'等待执行确认',running:'Codex 正在整理',unknown:'结果待确认',completed:'纪要草稿已就绪',cancelled:'已取消',failed:'执行失败'}:{ready:'Ready',requesting:'Awaiting confirmation',running:'Codex is working',unknown:'Outcome pending',completed:'Draft ready',cancelled:'Cancelled',failed:'Failed'}
 return <CapabilityPage environment={environment} className="meeting-notes">
  <PageHeader title={zh?'会议纪要':'Meeting notes'} description={zh?'选择原始资料，由 Codex 整理；确认后保存到资料库。':'Choose source material, let Codex organize it, then save the notes to your Library.'}/>
  {!ready&&<StateMessage>{zh?'正在读取草稿…':'Loading drafts…'}</StateMessage>}
  {ready&&!available&&<StateMessage>{zh?'Codex 暂不可用。请确认 Nooki 已包含组件，并已在 Codex 登录；已有纪要仍可打开。':'Codex is unavailable. Check the Nooki component and your Codex login. Existing notes remain available.'}</StateMessage>}
  {error&&<StateMessage error>{error}</StateMessage>}
  <div className="meeting-layout"><div className="meeting-inputs"><Panel>
   <h2>{zh?'新建纪要':'New notes'}</h2><label htmlFor="meeting-title">{zh?'会议标题':'Meeting title'}</label>
   <input id="meeting-title" value={title} maxLength={100} onChange={event=>setTitle(event.target.value)} disabled={busy||running}/>
   <Button disabled={!ready||busy||running} onClick={()=>void choose()}>{zh?'选择资料':'Choose sources'}</Button>
   {sources.length?<ul>{sources.map(source=><li key={source.documentId}>{source.title}</li>)}</ul>:<p className="meeting-hint">{zh?'仅使用你在选择器中批准的资料快照。':'Only the source snapshots you approve will be used.'}</p>}
   <Button disabled={!ready||busy||!available||!title.trim()||!sources.length||running||unresolved} onClick={()=>void generate()}>{zh?'生成纪要':'Generate notes'}</Button>
   {unresolved&&<p className="meeting-hint">{zh?'先查看或恢复当前运行，再开始新的生成。':'Check or recover the current run before generating again.'}</p>}
  </Panel><Panel><h2>{zh?'最近的纪要':'Recent notes'}</h2>
   {!meetings.length&&<p className="meeting-hint">{zh?'完成的草稿会保留在这里。':'Your drafts will remain here.'}</p>}
   <div className="meeting-history">{meetings.map(item=><button key={item.id} className={item.id===selected?'selected':''} onClick={()=>setSelected(item.id)}><strong>{item.title}</strong><span>{item.date} · {labels[item.phase]}</span></button>)}</div>
  </Panel></div><Panel>{meeting?<>
   <div className="meeting-result-heading"><div><h2>{meeting.title}</h2><p role="status">{labels[meeting.phase]}</p></div>
   <div className="meeting-actions">{meeting.runId&&<Button disabled={busy||job?.status==='running'} onClick={()=>void perform(()=>refreshMeeting(host,meeting))}>{zh?'刷新结果':'Refresh result'}</Button>}
    {job?.status==='running'&&<Button disabled={busy} onClick={()=>void perform(()=>host.tasks.cancel(job.id))}>{zh?'停止生成':'Stop generation'}</Button>}
    {job&&['failed','interrupted','cancelled'].includes(job.status)&&!['completed','cancelled'].includes(meeting.phase)&&<Button disabled={busy||!available} onClick={()=>void perform(()=>host.tasks.retry(job.id))}>{zh?'恢复原请求':'Recover original request'}</Button>}
   </div></div>
   {progress?.text&&<p role="status" className="meeting-hint">{progress.text}</p>}
   {progress?.awaitingInput&&<StateMessage>{zh?'Codex 需要你的回答，请打开 Nooki 的问答提示。':'Codex needs your input. Open the question notice in Nooki.'}</StateMessage>}
   {job?.error&&<StateMessage error>{job.error}</StateMessage>}
   {meeting.text?<pre className="meeting-body">{meeting.text}</pre>:<p className="meeting-hint">{zh?'生成结束后，纪要会显示在这里。离开页面不会重复提交。':'The notes will appear here when ready. Leaving this page does not resubmit work.'}</p>}
   <div className="meeting-actions">
    <Button disabled={busy||meeting.phase!=='completed'||!!meeting.document||job?.status==='running'||job?.status==='cancelled'} onClick={()=>void perform(()=>publishMeeting(host,meeting))}>{meeting.document?(zh?'已保存到资料库':'Saved to Library'):(zh?'保存到资料库':'Save to Library')}</Button>
    {meeting.document&&<Button onClick={()=>host.documents.open(meeting.document!)}>{zh?'打开纪要':'Open notes'}</Button>}
   </div>
   {meeting.document&&<div className="meeting-delivery"><h3>{zh?'继续处理':'Continue from these notes'}</h3><div className="meeting-actions">
    <Button disabled={busy||!!meeting.todo} onClick={()=>void perform(()=>createTodo(host,meeting))}>{meeting.todo?(zh?'待办已创建':'Todo created'):(zh?'创建待办':'Create todo')}</Button>
    <Button disabled={busy||!!meeting.attachment} onClick={()=>void perform(()=>attachMeeting(host,meeting))}>{meeting.attachment?(zh?'已附加到任务':'Attached to task'):meeting.pendingAttachment?(zh?'重试原附件请求':'Retry attachment'):(zh?'附加到任务':'Attach to task')}</Button>
    <Button disabled={busy||!!meeting.handoff} onClick={()=>void perform(()=>handoffMeeting(host,meeting))}>{meeting.handoff?(zh?'已交接聊天草稿':'Chat draft handed off'):(zh?'交接到聊天':'Hand off to chat')}</Button>
   </div><p className="meeting-hint">{zh?'创建待办不会自动执行；聊天内容仍需你确认发送。保存的纪要不依赖此能力包继续存在。':'A todo does not execute automatically, and a chat draft still needs you to send it. Saved notes remain after removing this package.'}</p></div>}
  </>:<><h2>{zh?'从原始记录到可用纪要':'Turn source material into useful notes'}</h2><p className="meeting-hint">{zh?'生成草稿、查看结果、确认保存，然后按需交给任务板或聊天。':'Generate a draft, review it, save it, then pass it to your task board or chat.'}</p></>}</Panel></div>
 </CapabilityPage>
}
export default {manifest,Page,jobs:{summarize:{run:summarize}}} satisfies CapabilityModule
