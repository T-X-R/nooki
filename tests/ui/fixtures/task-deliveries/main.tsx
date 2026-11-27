import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TaskDeliveries } from '../../../../src/features/task-board/TaskDeliveries'
import type { AttachedDelivery } from '../../../../src/features/task-board/task-board-store'
import '../../../../src/app/global.css'
import '../../../../src/features/task-board/task-board.css'

const deliveries: AttachedDelivery[] = [{
  id:'synthetic-delivery',title:'已保存的会议纪要 Retained meeting notes',createdAt:'2026-11-26T00:00:00Z',
  provenance:{type:'capability',capabilityId:'org.example.removed-producer',capabilityVersion:'1.0.0'},
  documents:[{reference:{kind:'library-document',documentId:'removed/original',title:'Original meeting notes 原始会议纪要'},documentDate:'2026-11-26',
    content:'# Original retained notes\n\nThe producer and original are unavailable. This text stays with the task.\n\n- [x] Reviewed\n- [ ] Follow up\n\n[Changed source](https://example.invalid/current)\n\n![Remote diagram](https://example.invalid/live.png)\n\n<script>alert(1)</script>\n\n| Owner | Action |\n| --- | --- |\n| 林 | Confirm next meeting |\n\n```text\n'+ 'long-retained-token'.repeat(25) +'\n```'},
    {reference:{kind:'library-document',documentId:'removed/empty',title:'Empty retained document'},documentDate:'2026-11-26',content:''}],
}]
function Harness() {
  const [zh,setZh]=useState(false),[empty,setEmpty]=useState(false)
  return <main style={{padding:24,overflow:'auto',height:'100%',background:'var(--bg)'}}>
    <h1>Retained delivery UI verification</h1><p>SIMULATED retained data. Native persistence is tested separately. Expanding text performs no source read or task mutation.</p>
    <label>Language <select onChange={event=>{setZh(event.target.value==='zh');document.documentElement.lang=event.target.value}}><option value="en">English</option><option value="zh">中文</option></select></label>{' '}
    <label>Theme <select onChange={event=>{document.documentElement.dataset.theme=event.target.value}}><option value="light">Light</option><option value="dark">Dark</option></select></label>{' '}
    <label><input type="checkbox" checked={empty} onChange={event=>setEmpty(event.target.checked)} /> No deliveries</label>
    <div className="task-board-panel-body"><TaskDeliveries deliveries={empty?[]:deliveries} zh={zh} /></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
