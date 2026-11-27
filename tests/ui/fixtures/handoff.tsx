import {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {invoke} from '@tauri-apps/api/core'
import {ConversationHandoffDialog} from '../../../src/features/conversation/ConversationHandoffDialog.tsx'
import {ConversationPage} from '../../../src/features/conversation/ConversationPage.tsx'
import {createHandoffClient,invalidateHandoffs} from '../../../src/platform/capability-handoff.ts'
import {handoffReview} from '../../../src/platform/handoff-review.ts'
import {captureLibraryFocus} from '../../../src/platform/library-focus.ts'
import '../../../src/app/global.css'
function Fixture(){
 const [language,setLanguage]=useState<'zh'|'en'>('zh'),[theme,setTheme]=useState('light'),[incoming,setIncoming]=useState<string|null>(null),[target,setTarget]=useState<string|null>(null),[busy,setBusy]=useState(false),[result,setResult]=useState('')
 const [mounted,setMounted]=useState(true)
 const [client]=useState(()=>createHandoffClient({id:'example.reader',version:'1.0.0',name:'Synthetic Reader',permission:true,desktop:true,assertActive(){if(!window.qa.enabled)throw new Error('disabled')},onDispose(){},invoke,open:handoffReview.open,captureFocus:captureLibraryFocus,onCommitted:setIncoming}))
 useEffect(()=>{document.documentElement.lang=language;document.documentElement.dataset.theme=theme},[language,theme])
 useEffect(()=>{window.qa.disable=()=>{window.qa.enabled=false;return invalidateHandoffs('example.reader')};return()=>{void client.dispose()}},[client])
 const begin=async(replay=false)=>{setBusy(true);setResult('');try{const value=await client.conversations.handoff({title:'Review notes',text:'Please review these retained notes.',sources:window.qa.sources},{idempotencyKey:replay?window.qa.key:`key-${++window.qa.sequence}`});window.qa.key=`key-${window.qa.sequence}`;setResult(JSON.stringify(value))}catch(error){setResult(error.code??String(error))}finally{setBusy(false)}}
 return <main style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)'}}>
  <nav style={{display:'flex',flexWrap:'wrap',gap:8,padding:8}}>
   <button disabled={busy} onClick={()=>void begin()}>Request handoff</button><button disabled={busy} onClick={()=>void begin(true)}>Replay handoff</button>
   <button onClick={()=>setTarget('new')}>New composer</button><button onClick={()=>setTarget('chat')}>Existing composer</button>
   <button onClick={()=>setLanguage(language==='zh'?'en':'zh')}>Language</button><button onClick={()=>setTheme(theme==='light'?'dark':'light')}>Theme</button>
   <button onClick={()=>setMounted(!mounted)}>Toggle chat</button><output data-testid="result">{result}</output>
  </nav>
  <ConversationHandoffDialog language={language}/>
  {mounted&&<ConversationPage language={language} selectedAgent="codex" onSelected={()=>{}} incomingSelection={{documentIds:[],folders:[]}} onConsumed={()=>{}} targetId={target} onTargetConsumed={()=>setTarget(null)} onDocument={()=>{}} onTask={()=>{}} incomingHandoffId={incoming} onHandoffConsumed={()=>setIncoming(null)}/>}
 </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
