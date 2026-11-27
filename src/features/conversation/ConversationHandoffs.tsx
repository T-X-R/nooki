import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {Cross2Icon,FileTextIcon} from '@radix-ui/react-icons'
import type {ConversationHandoffTarget,SelectedDocument} from '../../../packages/capability-contract/src/index.ts'
import {LibraryDialog} from '../library/LibraryDialogs.tsx'
import {conversationClient} from './conversation-client.ts'
import './conversation-handoffs.css'
export type HandoffDraft={id:string;title:string;text:string;target:ConversationHandoffTarget;documents:SelectedDocument[];capabilityId:string;capabilityVersion:string;createdAt:string}
type Summary=Omit<HandoffDraft,'text'|'documents'>
const message=(cause:unknown)=>cause&&typeof cause==='object'&&'message' in cause?String(cause.message):String(cause)
export function ConversationHandoffs({zh,incomingId,onConsumed,onOpen}:{zh:boolean;incomingId?:string|null;onConsumed?():void;onOpen(draft:HandoffDraft):void}){
  const [open,setOpen]=useState(false),[items,setItems]=useState<Summary[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0),callbacks=useRef({onOpen,onConsumed});callbacks.current={onOpen,onConsumed}
  useEffect(()=>()=>{generation.current++},[])
  const load=async()=>{const current=++generation.current;setOpen(true);setBusy(true);setError('');try{
    const result=await invoke<Summary[]>('conversation_handoff_drafts',{request:{}});if(current===generation.current)setItems(result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
  }catch(cause){if(current===generation.current)setError(message(cause))}finally{if(current===generation.current)setBusy(false)}}
  const choose=async(id:string)=>{const current=++generation.current;setBusy(true);setError('');try{
    const draft=await invoke<HandoffDraft>('conversation_handoff_read',{request:{id}})
    if(current!==generation.current)return
    if(draft.target.kind==='conversation'){
      const target=await conversationClient.read(draft.target.id)
      if(target.archived||target.taskId||target.task||target.id!==draft.target.id)throw new Error(zh?'此聊天已不可用，请保留草稿并选择其他操作。':'This conversation is unavailable. The draft is retained.')
    }
    if(current===generation.current){callbacks.current.onOpen(draft);setOpen(false)}
  }catch(cause){if(current===generation.current){setOpen(true);setError(message(cause))}}finally{if(current===generation.current){setBusy(false);callbacks.current.onConsumed?.()}}}
  useEffect(()=>{if(incomingId)void choose(incomingId)},[incomingId])
  return <><button className="quiet-button" disabled={busy} onClick={()=>void load()}><FileTextIcon/>{zh?'能力包草稿':'Capability drafts'}</button>
    {busy&&!open&&<span role="status">{zh?'正在打开草稿…':'Opening draft…'}</span>}
    {open&&<LibraryDialog title={zh?'能力包草稿':'Capability drafts'} busy={busy} onClose={()=>setOpen(false)}>
      <p className="modal-copy">{zh?'已确认的草稿保留在这里，卸载能力包后仍可打开。打开不会发送消息。':'Approved drafts remain here after their capability is removed. Opening sends no message.'}</p>
      {busy&&<p role="status">{zh?'正在读取…':'Loading…'}</p>}{error&&<p className="library-error" role="alert">{error}</p>}
      {!busy&&!error&&!items.length&&<p role="status">{zh?'还没有交接的草稿。':'No handed-off drafts yet.'}</p>}
      <div className="handoff-inbox-list">{items.map(item=><button className="secondary-button" disabled={busy} key={item.id} onClick={()=>void choose(item.id)}><strong>{item.title}</strong><small>{item.capabilityId} · {item.capabilityVersion} · {item.target.kind==='new'?(zh?'新聊天':'New chat'):item.target.id}</small></button>)}</div>
      <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={()=>void load()}>{zh?'刷新草稿':'Refresh drafts'}</button><button className="primary-button" disabled={busy} onClick={()=>setOpen(false)}>{zh?'关闭':'Close'}</button></footer>
    </LibraryDialog>}
  </>
}
export function HandoffOffer({draft,zh,disabled,adopted,onAdopt,onClose}:{draft:HandoffDraft;zh:boolean;disabled:boolean;adopted:boolean;onAdopt():void;onClose():void}){
  const region=useRef<HTMLElement>(null)
  useEffect(()=>{region.current?.focus()},[draft.id])
  return <section ref={region} tabIndex={-1} className="handoff-offer" aria-label={zh?'待采用的草稿':'Draft offer'}>
    <header><strong>{draft.title}</strong><button className="icon-button" aria-label={zh?'收起草稿预览':'Close draft preview'} onClick={onClose}><Cross2Icon/></button></header>
    <p>{draft.capabilityId} · {draft.capabilityVersion}</p><pre className="handoff-text">{draft.text}</pre>
    {!!draft.documents.length&&<details><summary>{zh?`${draft.documents.length} 篇保留资料`:`${draft.documents.length} retained sources`}</summary><div className="handoff-sources">{draft.documents.map(doc=><details key={doc.reference.documentId}><summary>{doc.reference.title}</summary><small>{doc.reference.revision}</small><pre className="handoff-text">{doc.content}</pre></details>)}</div></details>}
    <p>{adopted?(zh?'已加入输入框。请检查后自行发送。':'Added to the composer. Review it before sending.'):disabled?(zh?'请先移除已附加的其他草稿资料或重复引用，或等待当前操作结束。':'Remove the other draft sources or duplicate references, or wait for the current action.'): (zh?'采用会追加文字并附上保留资料，原有输入会保留。':'Adopt appends the text and retained sources, preserving your current input.')}</p>
    <footer><button className="secondary-button" disabled={disabled||adopted} onClick={onAdopt}>{zh?'加入输入框':'Add to composer'}</button></footer>
  </section>
}
