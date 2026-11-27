import {useState,useSyncExternalStore} from 'react'
import {delegationReview,type DelegationReviewRequest} from '../../platform/delegation-review.ts'
import {LibraryDialog} from '../library/LibraryDialogs.tsx'
import '../library/library-selection.css'
import '../conversation/conversation-handoffs.css'
function Review({request,zh}:{request:DelegationReviewRequest;zh:boolean}){
  const [busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState('')
  const confirm=async()=>{setBusy(true);setAttempted(true);setError('');try{
    const receipt=await request.confirm();delegationReview.complete(request,{status:'delegated',receipt})
  }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}
  return <LibraryDialog title={zh?'交给 Codex 独立执行':'Delegate to Codex'} busy={busy} onClose={()=>delegationReview.dismiss(request)} className="library-selection-dialog">
    <div className="library-selection-recipient"><strong>{request.name}</strong><small>{request.capabilityId} · {request.version}</small></div>
    <h3>{request.details.title}</h3><pre className="handoff-text">{request.details.description}</pre>
    {request.details.documents.map((doc,index)=><details key={index}><summary>{doc.reference.title}</summary><pre className="handoff-text">{doc.content}</pre></details>)}
    {request.details.deliveries.map(delivery=><details key={delivery.id}><summary>{delivery.title}</summary>{delivery.documents.map((doc,index)=><pre key={index} className="handoff-text">{doc.content}</pre>)}</details>)}
    <p className="modal-copy">{zh?'确认后，这项任务和上面的资料副本会交给任务板中的 Codex 后台执行。关闭或卸载能力包不会停止它；请在任务板查看进度、回答问题或停止。':'Confirmation queues this task and the source copies shown above with Codex on your task board. Closing or removing the package will not stop it. Track progress, answer questions or stop it on the board.'}</p>
    <p className="modal-copy">{zh?'Codex 使用你的本机登录，在独立任务工作目录中运行，可联网并写入任务成果；需要额外权限时会请求你批准。':'Codex uses your local login, an independent task workspace, network access and a task output directory. It asks for approval when additional access is needed.'}</p>
    {error&&<p role="alert" className="library-error">{error}</p>}
    {attempted&&error&&<p className="modal-copy">{zh?'重试会确认同一次交接，不会新建第二项执行。':'Retry reconciles this same handoff without creating another execution.'}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={()=>delegationReview.dismiss(request)}>{zh?'取消':'Cancel'}</button><button className="primary-button" disabled={busy} onClick={()=>void confirm()}>{busy?(zh?'正在交接…':'Delegating…'):attempted?(zh?'重试交接':'Retry delegation'):(zh?'确认并交给 Codex':'Confirm and delegate')}</button></footer>
  </LibraryDialog>
}
export function TaskDelegationDialog({language}:{language:'zh'|'en'}){
  const request=useSyncExternalStore(delegationReview.subscribe,delegationReview.getSnapshot)
  return request?<Review key={request.requestId} request={request} zh={language==='zh'}/>:null
}
