import {useRef,useState,useSyncExternalStore} from 'react'
import {agentReview,type AgentReviewRequest} from '../../platform/agent-review.ts'
import {LibraryDialog} from '../library/LibraryDialogs.tsx'
import '../library/library-selection.css'
import './agent-review.css'
function Review({request,zh}:{request:AgentReviewRequest;zh:boolean}){
  const [busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState('')
  const confirming=useRef(false)
  const confirm=async()=>{
    if(confirming.current)return;confirming.current=true;setBusy(true);setAttempted(true);setError('')
    try{const run=await request.confirm();agentReview.complete(request,run)}
    catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:String(cause))}
    finally{confirming.current=false;setBusy(false)}
  }
  return <LibraryDialog title={zh?'交给 Codex 执行':'Run with Codex'} busy={busy} onClose={()=>agentReview.dismiss(request)} className="library-selection-dialog">
    <div className="library-selection-recipient"><strong>{request.name}</strong><small>{request.capabilityId} · {request.version}</small></div>
    <h3>{zh?'执行内容':'Instructions'}</h3><pre className="agent-review-text">{request.proposal.instructions}</pre>
    {!!request.proposal.sources?.length&&<section><h3>{zh?'使用已选资料':'Selected sources'}</h3>{request.proposal.sources.map(source=><p key={source.documentId}>{source.title}<small className="agent-review-revision">{zh?'版本：':'Revision: '}{source.revision}</small></p>)}</section>}
    {request.proposal.outputSchema&&<details><summary>{zh?'结果格式':'Result format'}</summary><pre className="agent-review-text">{JSON.stringify(request.proposal.outputSchema,null,2)}</pre></details>}
    <p className="modal-copy">{zh?'确认后，Codex 将按以上指令处理所选资料。运行结果会保留，可以返回能力包查看和保存。':'Confirm to let Codex process the selected sources using these instructions. The retained result can be viewed and saved from the package.'}</p>
    {error&&<p role="alert" className="library-error">{error}</p>}
    {attempted&&error&&<p className="modal-copy">{zh?'重试会核对同一个请求，不会重新创建运行。关闭此窗口不会停止可能已经开始的工作。':'Retry reconciles this same request without creating another run. Closing this window does not stop work that may already have started.'}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={()=>agentReview.dismiss(request)}>{attempted?(zh?'关闭':'Close'):(zh?'取消':'Cancel')}</button><button className="primary-button" disabled={busy} onClick={()=>void confirm()}>{busy?(zh?'正在启动…':'Starting…'):attempted?(zh?'重试原请求':'Retry same request'):(zh?'确认执行':'Confirm and run')}</button></footer>
  </LibraryDialog>
}
export function AgentReviewDialog({language}:{language:'zh'|'en'}){
  const request=useSyncExternalStore(agentReview.subscribe,agentReview.getSnapshot)
  return request?<Review key={request.requestId} request={request} zh={language==='zh'}/>:null
}
