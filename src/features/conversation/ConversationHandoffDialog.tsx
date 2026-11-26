import {useState,useSyncExternalStore} from 'react'
import {handoffReview,type HandoffReviewRequest,type HandoffTargets} from '../../platform/handoff-review.ts'
import {LibraryDialog} from '../library/LibraryDialogs.tsx'
import '../library/library-selection.css'
import './conversation-handoffs.css'
function Review({request,zh}:{request:HandoffReviewRequest;zh:boolean}){
  const [mode,setMode]=useState<'new'|'conversation'>('new'),[selected,setSelected]=useState('')
  const [page,setPage]=useState<HandoffTargets>({data:[],nextCursor:null,partial:false}),[loaded,setLoaded]=useState(false)
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[approved,setApproved]=useState(false),[error,setError]=useState('')
  const [query,setQuery]=useState('')
  const load=async(cursor?:string)=>{
    setLoading(true);setError('')
    try{const next=await request.targets(cursor);if(request.signal.aborted)return
      if(cursor&&next.nextCursor===cursor)throw new Error(zh?'会话列表暂不可用，请重试。':'Conversation list unavailable. Please retry.')
      setPage(previous=>({data:[...new Map([...(cursor?previous.data:[]),...next.data].map(item=>[item.id,item])).values()],nextCursor:next.nextCursor,partial:next.partial}));setLoaded(true)
    }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:String(cause))}finally{setLoading(false)}
  }
  const confirm=async()=>{setApproved(true);setBusy(true);setError('');try{
    const receipt=await request.confirm(mode==='new'?{kind:'new'}:{kind:'conversation',id:selected})
    handoffReview.complete(request,{status:'handedOff',receipt})
  }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}
  return <LibraryDialog title={zh?'将草稿交给聊天':'Hand draft to chat'} busy={busy} onClose={()=>handoffReview.dismiss(request)} className="library-selection-dialog">
    <div className="library-selection-recipient"><strong>{request.name}</strong><small>{request.capabilityId} · {request.version}</small></div>
    <h3>{request.draft.title}</h3><pre className="handoff-text">{request.draft.text}</pre>
    {!!request.draft.sources?.length&&<div className="handoff-sources"><strong>{zh?'一并交接的资料':'Included sources'}</strong>{request.draft.sources.map(source=><p key={source.documentId}>{source.title}<small>{zh?'版本：':'Revision: '}{source.revision}</small></p>)}</div>}
    <p className="modal-copy">{zh?'确认后保存一份草稿及这些资料的当前授权版本。打开聊天不会覆盖未发送内容，也不会启动 Agent。':'Confirmation saves this draft and the approved source versions. Opening chat preserves unsent work and starts no Agent turn.'}</p>
    <fieldset className="handoff-targets" disabled={busy||approved}><legend>{zh?'交给哪个聊天':'Destination'}</legend>
      <label><input type="radio" name="handoff-mode" checked={mode==='new'} onChange={()=>setMode('new')}/>{zh?'新聊天':'New chat'}</label>
      <label><input type="radio" name="handoff-mode" checked={mode==='conversation'} onChange={()=>{setMode('conversation');if(!loaded&&!loading)void load()}}/>{zh?'已有聊天':'Existing chat'}</label>
    </fieldset>
    {mode==='conversation'&&<>
      <label className="library-selection-search library-field">{zh?'查找聊天':'Find a chat'}<input type="search" value={query} disabled={busy||approved} onChange={event=>setQuery(event.target.value)}/></label>
      {loading&&<p role="status">{zh?'正在读取聊天…':'Loading conversations…'}</p>}
      {page.partial&&<p role="status">{zh?'部分聊天暂不可用。可以选择已显示的聊天，或稍后重试。':'Some conversations are unavailable. Choose one shown here or retry later.'}</p>}
      <fieldset className="library-selection-list" disabled={busy||approved}><legend>{zh?'选择已有聊天':'Select a conversation'}</legend>
        {page.data.filter(item=>item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(item=><label key={item.id}><input type="radio" name="handoff-target" checked={selected===item.id} onChange={()=>setSelected(item.id)}/><span><strong>{item.title}</strong><small>{item.id}</small></span></label>)}
        {loaded&&!page.data.length&&!page.partial&&<p role="status">{zh?'还没有可选聊天。':'No conversations available.'}</p>}
      </fieldset>
      {!approved&&<button className="quiet-button" disabled={loading||busy} onClick={()=>void load(page.nextCursor??undefined)}>{page.nextCursor?(zh?'加载更多':'Load more'):(zh?'刷新聊天列表':'Refresh conversations')}</button>}
    </>}
    {error&&<p role="alert" className="library-error">{error}</p>}
    {approved&&error&&<p className="modal-copy">{zh?'重试使用同一草稿和目标。若要修改，请取消后重新发起。':'Retry keeps the same draft and destination. Cancel and start again to change them.'}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={()=>handoffReview.dismiss(request)}>{zh?'取消':'Cancel'}</button><button className="primary-button" disabled={busy||(mode==='conversation'&&!selected)} onClick={()=>void confirm()}>{busy?(zh?'正在保存…':'Saving…'):approved?(zh?'重试保存':'Retry save'):(zh?'保存并打开草稿':'Save and open draft')}</button></footer>
  </LibraryDialog>
}
export function ConversationHandoffDialog({language}:{language:'zh'|'en'}){
  const request=useSyncExternalStore(handoffReview.subscribe,handoffReview.getSnapshot)
  return request?<Review key={request.requestId} request={request} zh={language==='zh'}/>:null
}
